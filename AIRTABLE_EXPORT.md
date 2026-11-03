# Airtable task export

Implemented by `src/lib/airtable-export.ts`, `src/lib/airtable.ts`, and `POST /api/projects/:id/airtable-export`.

A project admin or member can push every task in that project to the Airtable table named by `AIRTABLE_TABLE_NAME`. Running the export again updates the same Airtable rows. A viewer cannot start it. The browser never sees the API key.

## What the user sees

The project page gets an **Export to Airtable** button next to the project title.

- `admin` and `member` see the button.
- `viewer` does not. The server rejects a viewer even if the button is forced.
- While the request runs, the button shows that the export is in progress.
- On success, the page shows how many rows were created, how many were updated, and which tasks failed.
- A partial failure is still a finished export. One bad task does not hide the rows that landed.

The call is synchronous. A project of about 1,000 tasks stays inside one HTTP request. Airtable accepts 10 records per write, so 1,000 tasks is about 100 writes, plus one paged read of existing rows.

## Authorization

`POST /api/projects/:id/airtable-export`

Same gate as creating a task: the caller is signed in, has a membership on this project, and `canEditTasks` is true (`admin` or `member`).

| Caller | Result |
| --- | --- |
| signed out | 401 |
| not a member | 403 `you are not a member of this project` |
| viewer | 403 `viewers cannot export tasks` |
| admin or member | 200 with the export summary |

The handler loads tasks with Prisma. Only then does it talk to Airtable.

## Idempotent writes

Airtable assigns its own record ids (`rec…`). The TaskBoard task id cannot be that id. The official `airtable` package at 0.12.2 has `select`, `create`, and `update`. It has no upsert. The export builds upsert itself:

1. Read the project's tasks, including assignee name.
2. List existing rows in the table and index them by the `Task ID:` line in Notes.
3. If a row already has this task's id, `update` that Airtable record.
4. If none does, `create` a row with that Task ID.

A second export of an unchanged project creates nothing new. The row count in Airtable stays the same, and the fields are written again.

If two Airtable rows somehow share one Task ID, the export updates the first and reports the duplicate. It does not create a third.

Deleting a task in TaskBoard does not delete its Airtable row. Re-export only creates and updates.

## Fields written to the Tasks table

The Status column is a select with three options: `Todo`, `In progress`, and `Done`. TaskBoard's four statuses fold into those three. `review` is still unfinished, so it is sent as `In progress`.

| Airtable field | TaskBoard value |
| --- | --- |
| Name | `task.title` |
| Status | `todo` → `Todo`, `in_progress` and `review` → `In progress`, `done` → `Done` |
| Notes | Task id, description, the same status label, assignee name, and project name |

The first line of Notes is `Task ID: <task id>`. That line is the merge key. The base and table come from `AIRTABLE_BASE_ID` and `AIRTABLE_TABLE_NAME`. The key comes from `AIRTABLE_API_KEY` and is read only on the server.

## Errors and retries

The official client already retries HTTP 429 inside `base.makeRequest`, and that loop has no attempt cap. This export turns that off (`noRetryIfRateLimited: true`) and applies one policy in our code so tests can see it.

Each create or update is one record. A batch of 10 is only an optimization; if a batch fails, those records are retried one at a time so a bad row cannot sink its neighbors.

| Failure | Examples | Action |
| --- | --- | --- |
| Transient | 429, 500, 502, 503, connection error, timeout | Retry that record up to 3 more times. Wait 200ms, then 400ms, then 800ms. For 429, wait at least the `Retry-After` value. |
| Permanent | 400, 401, 403, 404, 413, 422 | Do not retry that record. |

One permanent record error is recorded as `{ taskId, message }` and the export continues.

These abort the whole export, because every later call would fail the same way:

- `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, or `AIRTABLE_TABLE_NAME` is missing
- Airtable returns 401 or 403
- The table or base returns 404

That response is 502 `{ error: "airtable export failed", message }`. No summary of created or updated rows is returned, because the run did not finish.

A finished run, including one where some records failed permanently, is 200:

```json
{
  "export": {
    "created": 4,
    "updated": 8,
    "failed": [{ "taskId": "task_9", "message": "Unknown field name: Title" }]
  }
}
```

An empty project is 200 with all zeros and no Airtable writes.

## Code shape, when we build it

- `src/lib/airtable.ts` wraps the official `airtable` package: list, create, update. This is the only file that imports `airtable`.
- `src/lib/airtable-export.ts` loads nothing from the network. It takes tasks plus a client with `list`, `create`, and `update`, and returns the summary. Retries and the Task ID merge live here.
- `src/app/api/projects/[id]/airtable-export/route.ts` checks auth, loads the project and tasks, calls the exporter with the real client.
- The project page button calls that route. It does not import the Airtable client.

`src/lib/airtable-mock.ts` stays a test double. Production does not import it. The mock's `create({ id })` shortcut, which pretends the task id is an Airtable record id, is not how the real API works, so the exporter will not use that shortcut. Tests seed the mock by creating a row whose fields include `Task ID`, then run the export again and expect `update` and a stable record count.

Retry tests need a deterministic client: fail twice with a 429 or 500, then succeed; fail once with 422 and never be called again; fail one task and still write the next. The mock's random `failureRate` cannot express that, so those cases use a small fake with the same three methods. The happy-path and second-run cases can use `AirtableMockClient`.

## Test plan

Write these before the route, against the exporter and the handler with the client mocked.

- A member export creates one Airtable row per task, with Task ID, title, description, status, assignee, and project.
- Running it again updates those rows and does not increase the record count.
- A 500 on the first attempt is retried, and the row is written after the later success.
- A 422 is not retried. The next task is still written. The summary lists the failed task id.
- A 401 from Airtable fails the export.
- Viewer and non-member receive 403 and the client is not called.
- A signed-out request receives 401.

## Out of scope

Deleting Airtable rows when a task is deleted, webhooks, background jobs, and exporting comments.
