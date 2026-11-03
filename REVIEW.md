

## Top issues

Ordered by business impact. Severity is Critical, High, Medium, or Low.

### 1. Task search is SQL injection

- **File:** `src/app/api/projects/[id]/tasks/route.ts:27-34`
- **Category:** Security
- **Severity:** Critical

`GET /api/projects/:id/tasks?q=` builds SQL by interpolating `projectId` and the raw `q` query string, then runs it with `prisma.$queryRawUnsafe`. Any project member can break out of the `ILIKE` predicate and read or modify other projects' rows, including `users.password_hash`. The app connects as the Docker Postgres user (`docker-compose.yml:5-6`, `docker-compose.yml:24`), which is a superuser, so a successful injection owns the database rather than a single tenant.

### 2. Project detail returns password hashes

- **File:** `src/app/api/projects/[id]/route.ts:24-35`
- **Category:** Security
- **Severity:** Critical

`GET /api/projects/:id` is the board's load path, and it is allowed for every member, including viewers. `owner: true`, `memberships.user: true`, `assignee: true`, and `createdBy: true` select the full `User` row, so each response includes `passwordHash`. The client type already admits this (`src/types/index.ts:27`, `src/types/index.ts:35`). Hashes then sit in the browser, in proxies, and in any client log, and a cracked hash is a full account takeover — including projects the viewer was never invited to.

### 3. Task update skips membership and role checks

- **File:** `src/app/api/tasks/[id]/route.ts:16-37`
- **Category:** Security
- **Severity:** High

`PATCH /api/tasks/:id` authenticates the caller, loads the task by id, and writes `title`, `description`, `status`, `assigneeId`, and `position` with no project membership check and no call to `canEditTasks`. The delete handler in the same file does both (`src/app/api/tasks/[id]/route.ts:49-53`), and the board UI offers edit and save to every role (`src/components/TaskDetail.tsx:47-54`, `src/app/projects/[id]/page.tsx:171-178`). A viewer can change work items they were only meant to see, and any logged-in user who learns a task id can rewrite it without belonging to the project. Assignee is also not required to be a member of that project.



// CURL before fix

postman request PATCH 'http://localhost:3000/api/tasks/cmw0alum3000zpp7a4ev1fr7s' \
  --header 'Accept: */*' \
  --header 'Accept-Language: en-US,en;q=0.9,te;q=0.8,it;q=0.7,nl;q=0.6' \
  --header 'Connection: keep-alive' \
  --header 'DNT: 1' \
  --header 'Origin: http://localhost:3000' \
  --header 'Referer: http://localhost:3000/projects/cmw0alulx0006pp7alm1qv79w' \
  --header 'Sec-Fetch-Dest: empty' \
  --header 'Sec-Fetch-Mode: cors' \
  --header 'Sec-Fetch-Site: same-origin' \
  --header 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36' \
  --header 'authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjbXcwYWx1bHQwMDAwcHA3YWQ3NHF5c21rIiwiZW1haWwiOiJtZWVyYUB0YXNrYm9hcmQuZGV2IiwiaWF0IjoxNzkzNzAyMDM4LCJleHAiOjE3OTYyOTQwMzh9.SyXWEC1SEkumypGMCWce0kicF8aNn1LIYXGWvqXwW_0' \
  --header 'content-type: application/json' \
  --header 'sec-ch-ua: "Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"' \
  --header 'sec-ch-ua-mobile: ?0' \
  --header 'sec-ch-ua-platform: "macOS"' \
  --header 'Cookie: __next_hmr_refresh_hash__=40' \
  --body '{"title":"QA the new signup flow end-to-en","description":"Detail for: QA the new signup flow end-to-end","status":"todo","assigneeId":"cmw0hhavu0002pp44qxrtp172"}'

// CURL after fix


postman request PATCH 'http://localhost:3000/api/tasks/cmw0alum3000zpp7a4ev1fr7s' \
  --header 'Accept: */*' \
  --header 'Accept-Language: en-US,en;q=0.9,te;q=0.8,it;q=0.7,nl;q=0.6' \
  --header 'Connection: keep-alive' \
  --header 'DNT: 1' \
  --header 'Origin: http://localhost:3000' \
  --header 'Referer: http://localhost:3000/projects/cmw0alulx0006pp7alm1qv79w' \
  --header 'Sec-Fetch-Dest: empty' \
  --header 'Sec-Fetch-Mode: cors' \
  --header 'Sec-Fetch-Site: same-origin' \
  --header 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36' \
  --header 'authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjbXcwYWx1bHQwMDAwcHA3YWQ3NHF5c21rIiwiZW1haWwiOiJtZWVyYUB0YXNrYm9hcmQuZGV2IiwiaWF0IjoxNzkzNzAyMDM4LCJleHAiOjE3OTYyOTQwMzh9.SyXWEC1SEkumypGMCWce0kicF8aNn1LIYXGWvqXwW_0' \
  --header 'content-type: application/json' \
  --header 'sec-ch-ua: "Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"' \
  --header 'sec-ch-ua-mobile: ?0' \
  --header 'sec-ch-ua-platform: "macOS"' \
  --header 'Cookie: __next_hmr_refresh_hash__=40' \
  --body '{"title":"QA the new signup flow end-to-end","description":"Detail for: QA the new signup flow end-to-end","status":"todo","assigneeId":"cmw0hhavu0002pp44qxrtp172"}'

  // response  {
    "error": "assignee does not have access to this project"
}

### 4. Email is not a unique account identity

- **File:** `prisma/schema.prisma:25`; `prisma/migrations/20260101000000_init/migration.sql:8-17`; `src/app/api/auth/register/route.ts:17-24`; `src/app/api/auth/login/route.ts:16`
- **Category:** Data Integrity
- **Severity:** High

`users.email` has no unique index, and registration never normalizes case. The register handler does a `findFirst` and then `create`, so two concurrent signups with the same address both succeed, and `User@x.com` and `user@x.com` are stored as different people. Login resolves the address with `findFirst` and checks the password on whichever row comes back, so one of the duplicate accounts can be signed into the wrong user id — splitting memberships, task authorship, and audit history across two records for a single email.
