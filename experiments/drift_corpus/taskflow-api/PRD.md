# taskflow-api — Product Requirements

## Overview

taskflow-api is a lightweight REST API for personal and small-team task tracking.
Users authenticate, group work into **projects**, and manage **tasks** inside
those projects. The service is backend-only (JSON over HTTP); any client (web,
CLI, mobile) can consume it.

## Goals

- Provide a secure, stateless JSON API for managing tasks and projects.
- Keep the surface small and predictable: a handful of REST endpoints.
- Support automation by emitting a webhook when a task is completed.

## Non-goals

- No web UI (a separate client project owns that).
- No real-time / websocket delivery.
- No file attachments or comments in v1.

## Requirements

Each requirement is numbered and independently checkable.

**R1 — User registration and login.**
The API MUST expose `POST /auth/register` and `POST /auth/login`. Registration
takes `email` and `password`; login takes the same and returns a JWT access
token plus a refresh token. Passwords MUST be stored as bcrypt hashes, never in
plaintext.

**R2 — JWT-based stateless auth.**
All non-auth endpoints MUST require a valid bearer access token. The access
token MUST expire after **15 minutes**; the refresh token MUST expire after
**7 days**. Refreshing is out of scope for v1 endpoints but the refresh token
is issued at login for future use.

**R3 — Create and read tasks.**
The API MUST expose `POST /tasks` to create a task and `GET /tasks/:id` to read
a single task. A task has a `title`, an optional `description`, a `status`, a
`priority`, and belongs to exactly one project owned by the caller.

**R4 — List tasks with filters and pagination.**
The API MUST expose `GET /tasks` returning only the caller's tasks. It MUST
support filtering by `status` and by `project_id` via query parameters, and MUST
paginate results with `page` and `page_size` query parameters. The default page
size MUST be **20** and the maximum allowed page size MUST be **100**.

**R5 — Update and delete tasks.**
The API MUST expose `PATCH /tasks/:id` to update a task's mutable fields
(`title`, `description`, `status`, `priority`) and `DELETE /tasks/:id` to remove
a task. Both MUST reject access to tasks the caller does not own.

**R6 — Task status lifecycle.**
A task's `status` MUST be one of `todo`, `in_progress`, or `done`. New tasks
default to `todo`. A task's `priority` MUST be one of `low`, `medium`, or
`high`, defaulting to `medium`.

**R7 — Completion webhook (optional automation).**
When a task transitions to `done`, the API MUST POST a JSON payload to the
webhook URL configured on the task's owning project (`projects.webhook_url`), if
and only if one is set. Webhook delivery MUST NOT block or fail the API
response.

**R8 — Rate limiting.**
The API MUST rate-limit requests per client IP to **100 requests per 15-minute
window**. Exceeding the limit MUST return HTTP `429`.

**R9 — Health check.**
The API MUST expose an unauthenticated `GET /health` endpoint returning
`{ "status": "ok" }` for liveness probes.

