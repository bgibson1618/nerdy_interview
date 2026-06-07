# taskflow-api

A small REST API for task tracking — users, projects, and tasks — built with
Node, TypeScript, Express, and MySQL, secured with JWT.

## Requirements

- Node.js 18+
- MySQL 8+

## Setup

```bash
npm install
```

Create the database schema:

```bash
mysql -u root -p taskflow < src/schema.sql
```

Set environment variables (defaults shown):

| Var           | Default       | Description                  |
|---------------|---------------|------------------------------|
| `PORT`        | `4000`        | HTTP port                    |
| `DB_HOST`     | `127.0.0.1`   | MySQL host                   |
| `DB_PORT`     | `3306`        | MySQL port                   |
| `DB_USER`     | `root`        | MySQL user                   |
| `DB_PASSWORD` | `''`          | MySQL password               |
| `DB_NAME`     | `taskflow`    | MySQL database name          |
| `JWT_SECRET`  | `FAKE_DEMO_SECRET` | JWT signing secret      |

```bash
export JWT_SECRET=FAKE_DEMO_SECRET
npm run build
npm start
```

The server listens on **http://localhost:4000**.

## Auth

Obtain tokens, then send `Authorization: Bearer <access_token>` on every
`/tasks` request. The access token expires after **30 minutes**; the refresh
token after **7 days**.

```bash
# Register
curl -X POST localhost:4000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"a@b.com","password":"hunter2"}'

# Login -> { access_token, refresh_token }
curl -X POST localhost:4000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"a@b.com","password":"hunter2"}'
```

## API

| Method | Path             | Auth | Description                       |
|--------|------------------|------|-----------------------------------|
| GET    | `/health`        | no   | Liveness probe                    |
| POST   | `/auth/register` | no   | Create a user                     |
| POST   | `/auth/login`    | no   | Get access + refresh tokens       |
| GET    | `/tasks`         | yes  | List your tasks (filters + paging)|
| POST   | `/tasks`         | yes  | Create a task                     |
| GET    | `/tasks/:id`     | yes  | Read one task                     |
| PATCH  | `/tasks/:id`     | yes  | Update a task                     |
| DELETE | `/tasks/:id`     | yes  | Delete a task                     |

### Listing tasks

`GET /tasks` accepts these query parameters:

- `status` — filter by `todo`, `in_progress`, or `done`.
- `project_id` — filter by owning project.
- `page` — 1-based page number (default `1`).
- `page_size` — items per page (default `20`, max `100`).

Response:

```json
{ "data": [ /* Task[] */ ], "page": 1, "page_size": 20, "total": 0 }
```

### Creating a task

```bash
curl -X POST localhost:4000/tasks \
  -H "authorization: Bearer $ACCESS" \
  -H 'content-type: application/json' \
  -d '{"project_id":1,"title":"Write docs","priority":"high"}'
```

A new task defaults to `status: "todo"` and `priority: "medium"` unless
overridden. Valid statuses are `todo`, `in_progress`, `done`; valid priorities
are `low`, `medium`, `high`.

### Task-completion webhook

If the task's project has a `webhook_url` set, updating a task to
`status: "done"` POSTs the following payload to that URL (fire-and-forget,
3-second timeout):

```json
{ "event": "task.completed", "task_id": 1, "project_id": 1, "completed_at": "2026-01-01T00:00:00.000Z" }
```

## Rate limiting

Each client IP is limited to **100 requests per 15 minutes**. Exceeding the
limit returns HTTP `429`.

## Scripts

- `npm run build` — compile TypeScript to `dist/`.
- `npm start` — run the compiled server.
- `npm run dev` — run with `ts-node` for development.

