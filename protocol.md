# Work Status — HTTP Communication Protocol

This document describes all HTTP endpoints exposed by the PHP server,
including request format, response format, and error handling.
It is the authoritative reference for implementing the server scripts,
client applications, and integration tests.

---

## Base URL

All endpoints are relative to the server root, e.g. `http://server/`.

## Frontend project structure

Both web applications are built from a single frontend project:

- One shared `package.json`.
- Two entry points:
  - Status display app (phone UI)
  - Control panel app (desktop/admin UI)
- One build output directory (flat static output).

The server serves both entry points from the same static directory.

---

## Authentication model

The system uses two separate credentials:

| Credential | Stored in | Used by |
|---|---|---|
| `$uid` | `uid.php` (server-side, not web-accessible) | Python lock-screen script (`msg_send.php`), Control Panel (`status.php` POST) |
| `$token` | `token.php` (server-side, not web-accessible) | Status app (`msg_read.php`, `status.php` POST) |

`token.php` format (must not be web-accessible):
```
<?php $token = 'AAAAAAAAAAAAAAAA';
```

Only one status application session is valid at a time. Obtaining a new token
invalidates the previous one (the file is overwritten).

---

## Endpoints

### 1. `login.php` — Obtain a session token

Used by the **Web Status Application** on startup to register itself as the
active session.

#### Request

```
GET /login.php?uid=<uid>
```

| Parameter | Location | Type | Description |
|---|---|---|---|
| `uid` | query string | string | Secret UID matching `$uid` in `uid.php` |

#### Response — success (`200 OK`)

```
Content-Type: text/plain

<token>
```

`<token>` is a newly generated random 16-character alphanumeric string.
The token is saved to `token.php` and invalidates any previously issued token.

#### Response — failure (`403 Forbidden`)

Returned when `uid` is missing or does not match `$uid`.

```
Content-Type: text/plain

Forbidden
```

---

### 2. `msg_send.php` — Send a message to the server queue

Used by the **Python lock-screen script** to push `locked`/`unlocked` events,
and by any other component that needs to post a message.

#### Request

```
POST /msg_send.php
Content-Type: application/x-www-form-urlencoded

uid=<uid>&message=<message>
```

| Parameter | Location | Type | Description |
|---|---|---|---|
| `uid` | POST body | string | Secret UID matching `$uid` in `uid.php` |
| `message` | POST body | string | Arbitrary UTF-8 text payload |

#### Message format (convention)

Messages are free-form text. The following values are used by the system:

| Message text | Meaning |
|---|---|
| `locked` | Screen has been locked |
| `unlocked` | Screen has been unlocked |

The Python script also sends the current state (`locked` or `unlocked`) once per minute as a keep-alive, repeating the last known state.

#### Response — success (`200 OK`)

```
Content-Type: text/plain

OK
```

#### Response — failure (`403 Forbidden`)

Returned when `uid` is missing or does not match `$uid`.

```
Content-Type: text/plain

Forbidden
```

#### Server-side storage

Messages are appended to `message.txt` using exclusive file lock, separated by:

```
\n--------\nSePaRator\n--------\n
```

---

### 3. `msg_read.php` — Read and consume all queued messages

Used by the **Web Status Application** to poll for incoming messages
(e.g. lock/unlock events from the Python script).

#### Request

```
POST /msg_read.php
Content-Type: application/x-www-form-urlencoded

token=<token>
```

| Parameter | Location | Type | Description |
|---|---|---|---|
| `token` | POST body | string | Session token obtained from `login.php` |

#### Behavior

- Acquires exclusive lock on `message.txt`.
- Reads and truncates the file atomically.
- Releases lock.
- If the file is empty or does not exist, waits 1 second and retries.
- After 20 seconds of empty file, returns an empty response.

#### Response — success, messages available (`200 OK`)

```
Content-Type: text/plain

<message1>
--------
SePaRator
--------
<message2>
--------
SePaRator
--------
```

Individual messages are separated by `\n--------\nSePaRator\n--------\n`.
The client splits on this separator to obtain individual messages.

#### Response — success, no messages after 20 s (`200 OK`)

```
Content-Type: text/plain

(empty body)
```

#### Response — failure (`403 Forbidden`)

Returned when `token` is missing or does not match `$token`.

```
Content-Type: text/plain

Forbidden
```

---

### 4. `status.php` — Read or update task list

Used by both the **Web Status Application** (to persist and restore state,
report time spent) and the **Web Control Panel** (to manage tasks).

#### 4a. Read status (no changes)

```
GET /status.php
```

or

```
GET /status.php?active=1
```

| Parameter | Location | Type | Description |
|---|---|---|---|
| `active` | query string | any | Optional. If present, only active tasks are returned. |

No authentication is required for read-only access (server may add it later).

**Note:** A POST request with an empty task array is equivalent to a GET — it
returns the current status without modifications.

#### Response (`200 OK`)

```json
{
  "tasks": {
    "<id>": {
      "id": "string",
      "name": "string",
      "comment": "string",
      "plannedTime": 0,
      "timeSpent": 0,
      "timeAdjust": 0,
      "active": true,
      "order": 0
    }
  }
}
```

`tasks` is a JSON object whose keys are task IDs. This allows O(1) lookup by ID
on both client and server.

When `?active=1` is set, only tasks with `"active": true` are included.
Special day-tracking tasks are included unless filtered.

#### 4b. Update status

```
POST /status.php
Content-Type: application/json

{
  "token": "<token>",
  "uid": "<uid>",
  "tasks": {
    "<id>": { <task fields> },
    "<id>": { <task fields> }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `token` | string | Optional. Session token obtained from `login.php` |
| `uid` | string | Optional. Secret UID matching `$uid` in `uid.php` |
| `tasks` | object | Object keyed by task ID. Values are task objects (may be partial — only changed fields required). The `id` field inside each value is optional and ignored; the key is authoritative. |

For POST authentication, at least one credential must be valid:

- `token` matches `$token`, or
- `uid` matches `$uid`.

##### Merge rules (server-side)

1. Iterate over each key (task ID) in the received `tasks` object.
2. If the key exists in the stored object: merge received fields over existing fields (received fields win).
3. If the key does not exist: add it as a new task, setting `id` to the key.
4. If the received task has `"deleted": true`: remove that key from the stored object entirely.
5. Keys not present in the received object are left unchanged.

##### Task object (full)

```json
{
  "tasks": {
    "task-id-here": {
      "id": "task-id-here",
      "name": "string",
      "comment": "string",
      "plannedTime": 3600,
      "timeSpent": 1800,
      "timeAdjust": 0,
      "active": true,
      "order": 0,
      "deleted": false
    }
  }
}
```

`deleted` is a transient write-only flag — it is never stored or returned.
`id` inside the value object must match its key; the key is authoritative.
`order` is an integer used by the Control Panel to persist task ordering.
Clients sort tasks by `order` ascending when displaying them.

##### Special task IDs

| ID pattern | Purpose |
|---|---|
| `-day-YYYY-MM-DD` | Total work time for a given day |
| `-admin-YYYY-MM-DD` | Administration time for a given day |

These are regular tasks from the server's perspective; the client gives them
special meaning.

#### Response — success (`200 OK`)

Returns the full merged task store (same format as GET response).
If `?active=1` is present, only tasks with `"active": true` are included.

```json
{
  "tasks": {
    "<id>": { ... },
    "<id>": { ... }
  }
}
```

#### Response — failure (`403 Forbidden`)

Returned when both `token` and `uid` are missing or invalid (POST only).

```json
{
  "error": "Forbidden"
}
```

---

## Client polling strategy

| Client | Endpoint | Interval |
|---|---|---|
| Web Status App | `msg_read.php` | Long-poll (blocks up to 20 s, then immediately retries) |
| Web Status App | `status.php` (POST `?active=1`) | Every 60 s — persists current time counters and refreshes task list |
| Python script | `msg_send.php` | On lock/unlock event + once per minute (repeats current `locked`/`unlocked` state) |
| Control Panel | `status.php` (GET) | On load and after each mutation |
| Control Panel | `status.php` (POST) | On each user edit/add/delete/reorder |

---

## Error handling summary

| HTTP status | Meaning |
|---|---|
| `200 OK` | Request processed successfully |
| `403 Forbidden` | Authentication failed (bad uid or token) |

All other HTTP error codes (e.g. `500`, `404`) indicate a server or
configuration problem and should be treated as transient errors by clients —
retry with exponential back-off.

---

## File layout on the server

```
/                          <- web root
├── msg_send.php
├── msg_read.php
├── status.php
├── login.php
├── uid.php                <- NOT web-accessible (contains $uid)
├── token.php              <- NOT web-accessible (contains $token, overwritten on login)
├── message.txt            <- message queue (created automatically)
├── status.json            <- persistent task store (created automatically)
├── index.html             <- status app entry point
├── control.html           <- control panel entry point
└── ...                    <- other resources (e.g. CSS, JS) for the web applications
```

The static assets are produced by one frontend build (single `package.json`) and
both entry points are deployed together in this same flat directory.

`uid.php` and `token.php` must be placed outside the web root or protected
by the web server so they cannot be downloaded directly.
