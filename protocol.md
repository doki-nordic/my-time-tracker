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

## Database model

The server stores application state in SQLite instead of JSON files.

Database files:

- `status-template.sqlite` — template database file deployed with the scripts.
- `status.sqlite` — runtime database file used by all PHP endpoints.

Initialization rule:

- If `status.sqlite` does not exist, the server script handling the request must
  copy `status-template.sqlite` to `status.sqlite` before opening the database.

Schema source of truth: `src/status.sql`.

Tables:

- `conf`
  - `key` (`TEXT PRIMARY KEY NOT NULL`) — configuration key.
  - `value` (`ANY`) — configuration value.
- `tasks`
  - `id` (`TEXT PRIMARY KEY NOT NULL`) — task ID, e.g. `NCSDK-38278`.
  - `name` (`TEXT NOT NULL`) — task name (description).
  - `active` (`INTEGER NOT NULL`) — `0` or `1`, whether task is active.
  - `order` (`INTEGER NOT NULL`) — display order used by UI.
- `track`
  - `id` (`INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL`) — track entry ID.
  - `day` (`INTEGER NOT NULL`) — day in BCD format, e.g. `20260506`. The day
    ends at 4:00 AM next day; from `0:00` to `4:00` (exclusive), use previous day.
  - `start_time` (`INTEGER NOT NULL`) — start time in seconds since `0:00`.
    The tracking day starts at 4:00 AM, so values start at `14400` and may be
    greater than `86400`.
  - `end_time` (`INTEGER NOT NULL`) — end time in seconds since `0:00` with the
    same day boundary rules as `start_time`. Can be lower than `start_time` for
    manual entries indicating negative time.
  - `task` (`TEXT NOT NULL`) — task ID.
  - `manual` (`INTEGER NOT NULL`) — `0` or `1`, whether entry is manual.

Indexes:

- `tasks_active` on `tasks(active)`
- `track_day` on `track(day)`
- `track_task` on `track(task)`

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

Used by both the **Web Status Application** and the **Web Control Panel**.
The endpoint reads/writes rows in the `tasks` table in `status.sqlite`.

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
      "active": true,
      "order": 0
    }
  }
}
```

`tasks` is a JSON object whose keys are task IDs. This allows O(1) lookup by ID
on both client and server.

When `?active=1` is set, only tasks with `"active": true` are included.

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
| `tasks` | object | Object keyed by task ID. Values are task objects containing fields from `tasks` table. The `id` field inside each value is optional and ignored; the key is authoritative. |

For POST authentication, at least one credential must be valid:

- `token` matches `$token`, or
- `uid` matches `$uid`.

##### Write rules (server-side)

1. Iterate over each key (task ID) in the received `tasks` object.
2. If the key exists in `tasks` table: write only columns provided by the client (`name`, `active`, `order`) and leave all other columns unchanged.
3. If the key does not exist: insert a new row with `id` set to the key and all required columns provided by the client.
4. If the received task has `"deleted": true`: delete the row from `tasks` table.
5. Keys not present in the received object are left unchanged.

There is no object merge behavior. The server writes exactly the task fields that
are present in each received task object.

##### Task object (full)

```json
{
  "tasks": {
    "task-id-here": {
      "id": "task-id-here",
      "name": "string",
      "active": true,
      "order": 10,
      "deleted": false
    }
  }
}
```

`deleted` is a transient write-only flag — it is never stored or returned.
`id` inside the value object must match its key; the key is authoritative.
`order` is an integer used by the Control Panel to persist task ordering.
Clients sort tasks by `order` ascending when displaying them.

The protocol no longer uses special day-tracking task IDs.

#### Response — success (`200 OK`)

Returns the full current task store (same format as GET response).
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

### 5. `track.php` — Time tracking endpoint

Used by the **Web Status Application**.
Used to periodically report current activity.

```
POST /track.php
Content-Type: application/json

{
  "token": "<token>",
  "uid": "<uid>",
  "entries":
    [
      {
        "day": "<day>",
        "time": "<time>",
        "task": "<task_id>"
      },
      ...
    ]
}
```

`token` is the session token obtained from `login.php`.
`uid` is the secret UID matching `$uid` in `uid.php`.
Just like in `status.php`, for authentication at least one credential must be valid.

`task_id` is the ID of the currently active task.

`day` and `time` are the current local (browser) date and time.

`day` is the day of the track entry, in BCD format, e.g. 20260506 for May 6, 2026.
The day ends at 4:00 AM the next day, so from 0:00 to 4:00 (exclusive) use previous day.

`time` is the start time of the track entry, in seconds since 0:00 AM of the current day
The day starts at 4:00 AM, so the value starts at 14400 (4 hours * 3600 seconds/hour) and can be greater than 86400 (24 hours * 3600 seconds/hour).

The day and time format and content is managed by the client in a browser, it is up to the client what time to report
and what timezone to use. The server just stores the received values as-is and does not perform any validation
or modification on them.

If token is correct, this call will update the `track` table in database.

First, the script finds the row with the highest `end_time` for the given day where `manual` is 0. If that row has the same task id and its `end_time` is higher than request time minus 60 seconds, update its end time to the request time.
Otherwise, insert a new row with start time and end time set to the request time.

Note: In case of connection issues, the client may accumulate multiple entries locally and send them in a batch when the connection is restored. Normally the POST data contains only one entry, but the server should be able to handle multiple entries in a single request.
Additionally, if user switches tasks, the client app will send two entries in a batch: one with the previous task and one with the new task, both with the same time value.

Warning: The read-and-update logic should be enclosed in a transaction.

As a response, the server returns JSON containing all rows from `track` table that have the same day value as the request.

The returned track row shape is:

```json
{
  "track": [
    {
      "id": 1,
      "day": 20260506,
      "start_time": 32400,
      "end_time": 32700,
      "task": "NCSDK-38278",
      "manual": 0
    }
  ]
}
```

### 6. `conf.php` — Configuration access endpoint

Used by clients that need to read or update configuration values stored in the
`conf` table.

The endpoint supports reading and writing multiple keys in a single request.

#### Request

```
POST /conf.php
Content-Type: application/json

{
  "token": "<token>",
  "uid": "<uid>",
  "write": {
    "<key>": <value>,
    "<key>": <value>
  },
  "read": ["<key>", "<key>"]
}
```

| Field | Type | Description |
|---|---|---|
| `token` | string | Optional. Session token obtained from `login.php` |
| `uid` | string | Optional. Secret UID matching `$uid` in `uid.php` |
| `write` | object | Optional. Object of key-value pairs to write into `conf` table. |
| `read` | array of strings | Optional. List of keys to read from `conf` table. |

At least one of `write` or `read` must be present.

For authentication, at least one credential must be valid:

- `token` matches `$token`, or
- `uid` matches `$uid`.

Supported value types for `write` values:

- `null`
- number
- string

There is no delete operation. To clear a value, write `null`.

When both `write` and `read` are provided in the same request, the server must
perform writes first, then reads.

If specified keys in `read` do not exist in the `conf` table, the server returns
them with `null` values.

#### Response — success (`200 OK`)

```json
{
  "conf": {
    "<key>": <value>,
    "<key>": <value-or-null>
  }
}
```

The response contains values for keys requested in `read`.
If `read` is omitted, the server returns an empty `conf` object.

#### Response — failure (`403 Forbidden`)

Returned when both `token` and `uid` are missing or invalid.

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
| Web Status App | `status.php` (POST `?active=1`) | Every 60 s — refreshes and persists task list changes |
| Python script | `msg_send.php` | On lock/unlock event + once per minute (repeats current `locked`/`unlocked` state) |
| Control Panel | `status.php` (GET) | On load and after each mutation |
| Control Panel | `status.php` (POST) | On each user edit/add/delete/reorder/activate change |

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
├── track.php
├── conf.php
├── login.php
├── uid.php                <- NOT web-accessible (contains $uid)
├── token.php              <- NOT web-accessible (contains $token, overwritten on login)
├── message.txt            <- message queue (created automatically)
├── status-template.sqlite <- DB template file (deployed with application)
├── status.sqlite          <- runtime SQLite DB (copied from template if missing)
├── index.html             <- status app entry point
├── control.html           <- control panel entry point
└── ...                    <- other resources (e.g. CSS, JS) for the web applications
```

The static assets are produced by one frontend build (single `package.json`) and
both entry points are deployed together in this same flat directory.

`uid.php` and `token.php` must be placed outside the web root or protected
by the web server so they cannot be downloaded directly.
