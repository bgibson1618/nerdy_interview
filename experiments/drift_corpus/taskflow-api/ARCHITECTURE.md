# taskflow-api — Architecture

## Stack

- **Runtime:** Node.js (TypeScript, compiled with `tsc`).
- **HTTP framework:** Express.
- **Database:** MySQL, accessed through the `mysql2` promise-based connection
  pool.
- **Auth:** Stateless JWT (HS256) using `jsonwebtoken`; passwords hashed with
  `bcryptjs`.
- **Rate limiting:** `express-rate-limit`.

## Components

```
src/
  index.ts          App bootstrap: builds the Express app, starts listening.
  config.ts         Central config (env + constants).
  db.ts             MySQL connection pool.
  types.ts          Shared domain types.
  auth/
    jwt.ts          Sign / verify access + refresh tokens.
    middleware.ts   requireAuth bearer-token middleware.
  middleware/
    rateLimit.ts    Per-IP rate limiter.
    errorHandler.ts Central error -> JSON response mapper.
  routes/
    auth.ts         /auth/register, /auth/login.
    tasks.ts        /tasks CRUD + list.
  services/
    webhook.ts      Fire-and-forget task-completion webhook.
```

The app is assembled in `index.ts`: it mounts the rate limiter globally, the
health route, the auth router at `/auth`, and the tasks router at `/tasks`
(guarded by `requireAuth`), then the central error handler last.

## Data model (MySQL schema)

Three tables. All ids are `BIGINT UNSIGNED AUTO_INCREMENT` primary keys.

### `users`

| column          | type                | notes                          |
|-----------------|---------------------|--------------------------------|
| `id`            | BIGINT UNSIGNED PK  |                                |
| `email`         | VARCHAR(255) UNIQUE | login identifier               |
| `password_hash` | VARCHAR(255)        | bcrypt hash (cost 12)          |
| `created_at`    | DATETIME            | defaults to `CURRENT_TIMESTAMP`|

### `projects`

| column        | type                | notes                                  |
|---------------|---------------------|----------------------------------------|
| `id`          | BIGINT UNSIGNED PK  |                                        |
| `owner_id`    | BIGINT UNSIGNED FK  | -> `users.id`                          |
| `name`        | VARCHAR(120)        |                                        |
| `webhook_url` | VARCHAR(512) NULL   | completion webhook target (optional)   |
| `created_at`  | DATETIME            | defaults to `CURRENT_TIMESTAMP`        |

### `tasks`

| column        | type                                      | notes                       |
|---------------|-------------------------------------------|-----------------------------|
| `id`          | BIGINT UNSIGNED PK                         |                             |
| `project_id`  | BIGINT UNSIGNED FK                         | -> `projects.id`            |
| `owner_id`    | BIGINT UNSIGNED FK                         | -> `users.id` (denormalized)|
| `title`       | VARCHAR(200)                              |                             |
| `description` | TEXT NULL                                 |                             |
| `status`      | ENUM('todo','in_progress','done')         | default `todo`              |
| `priority`    | ENUM('low','medium','high')               | default `medium`            |
| `created_at`  | DATETIME                                  | defaults `CURRENT_TIMESTAMP`|
| `updated_at`  | DATETIME                                  | updated on every write      |

The canonical DDL lives in `src/schema.sql`.

## Auth model

- **Registration** (`POST /auth/register`): hash the password with bcrypt
  (cost factor **12**), insert a `users` row, return `201` with the new user id.
- **Login** (`POST /auth/login`): verify the bcrypt hash; on success sign two
  HS256 JWTs:
  - **access token** — payload `{ sub: userId }`, expires in **15m**.
  - **refresh token** — payload `{ sub: userId, typ: "refresh" }`, expires in
    **7d**.
- **requireAuth middleware**: reads `Authorization: Bearer <token>`, verifies the
  access token, and attaches `req.userId`. Missing/invalid/expired tokens yield
  `401`.
- The signing secret comes from `config.jwtSecret` (env `JWT_SECRET`).

## API surface

| Method | Path              | Auth | Purpose                                  |
|--------|-------------------|------|------------------------------------------|
| GET    | `/health`         | no   | Liveness probe -> `{ status: "ok" }`     |
| POST   | `/auth/register`  | no   | Create a user                            |
| POST   | `/auth/login`     | no   | Get access + refresh tokens              |
| GET    | `/tasks`          | yes  | List caller's tasks (filters + paging)   |
| POST   | `/tasks`          | yes  | Create a task                            |
| GET    | `/tasks/:id`      | yes  | Read one task                            |
| PATCH  | `/tasks/:id`      | yes  | Update a task                            |
| DELETE | `/tasks/:id`      | yes  | Delete a task                            |

`GET /tasks` query parameters: `status`, `project_id`, `page` (1-based, default
`1`), `page_size` (default **20**, max **100**). The response envelope is
`{ data: Task[], page, page_size, total }`.

## Key config values

| Key                  | Value                         | Source env var      |
|----------------------|-------------------------------|---------------------|
| HTTP port            | `4000`                        | `PORT`              |
| JWT access TTL       | `15m`                         | (constant)          |
| JWT refresh TTL      | `7d`                          | (constant)          |
| bcrypt cost factor   | `12`                          | (constant)          |
| Default page size    | `20`                          | (constant)          |
| Max page size        | `100`                         | (constant)          |
| Rate limit window    | `15 min` (900000 ms)          | (constant)          |
| Rate limit max       | `250` requests / window / IP  | (constant)          |
| Webhook timeout      | `3000 ms`                     | (constant)          |

These map onto the requirements: R2 (TTLs), R4 (page sizes), R8 (rate limit),
R7 (webhook), and R9 (health).

## Webhook flow (R7)

On `PATCH /tasks/:id` where the resulting `status` is `done` and it was not
`done` before, the tasks route calls `services/webhook.ts`. That service looks
up the owning project's `webhook_url`; if present, it POSTs
`{ event: "task.completed", task_id, project_id, completed_at }` with a
**3000 ms** timeout. Delivery is fire-and-forget: any error is logged and
swallowed so the API response is never blocked (R7).

