# Task comments

Design for the comment thread. Tests in `src/tests/task-comments.test.ts` are the API contract. The route, schema, and `Comment` model implement that contract. The task dialog lists the thread and lets admins and members post.

## Behavior

A comment is a permanent note on one task. The thread is the engagement record, so a comment is inserted once and then left as it was posted.

Each comment shows:

- author name and email
- body
- when it was posted (`createdAt`)

The list is chronological, oldest first.

| Action | admin | member | viewer | not a member | signed out |
| --- | --- | --- | --- | --- | --- |
| Read the thread | yes | yes | yes | no | no |
| Post a comment | yes | yes | no | no | no |
| Edit or delete | no | no | no | no | no |

Posting uses the existing `canEditTasks` rule: admin and member may write, viewer may not. Reading requires any membership on the task's project. The signed-in user is always the author. A client-supplied `authorId` is ignored.

## API

Handlers live at `src/app/api/tasks/[id]/comments/route.ts`.

- `GET /api/tasks/:id/comments` returns `{ comments }` ordered by `createdAt` ascending.
- `POST /api/tasks/:id/comments` accepts `{ body }` and returns `{ comment }` with status 201.

There is no `PATCH`, `PUT`, or `DELETE` handler. A missing handler is the append-only guarantee: the thread cannot be rewritten through this API.

Body rules, enforced by a Zod schema before insert:

- trim whitespace
- required, at least 1 character after trim
- at most 5000 characters

Status codes match the other task routes:

- `401` when the request has no user
- `404` with `task not found` when the task id does not exist
- `403` with `you are not a member of this project` when the caller has no membership
- `403` with `viewers cannot post comments` when a viewer posts
- `400` with `invalid input` when the body fails validation

The task is loaded first, because membership is checked against `task.projectId`. An unknown id is 404. A known id outside the caller's projects is 403.

## Data

```prisma
model Comment {
  id        String   @id @default(cuid())
  taskId    String   @map("task_id")
  authorId  String   @map("author_id")
  body      String
  createdAt DateTime @default(now()) @map("created_at")

  task   Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  author User @relation(fields: [authorId], references: [id])

  @@index([taskId, createdAt])
  @@map("comments")
}
```

No `updatedAt`. Nothing in the model invites an edit.

The author relation is loaded with `select: { id, name, email }`. `passwordHash` stays out of the thread response.

## Board

`TaskDetail` loads `GET /api/tasks/:id/comments` and renders author, email, body, and time, oldest first. The composer is shown for `admin` and `member` only. There are no edit or delete controls.

Pagination and notifications are still out of scope.
