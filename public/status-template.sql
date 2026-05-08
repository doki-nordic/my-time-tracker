-- Text encoding used: UTF-8

CREATE TABLE conf (
    -- The configuration key.
    key   TEXT PRIMARY KEY
               NOT NULL,
    -- The configuration value.
    value ANY
);

CREATE TABLE tasks (
    -- Task ID, e.g. "NCSDK-38278".
    id     TEXT PRIMARY KEY
                NOT NULL,
    -- Task Name (description).
    name   TEXT NOT NULL,
    -- 0 or 1, whether the task is active or not.
    active INTEGER  NOT NULL,
    -- The number describing the order at which the task should be displayed in the UI.
    [order] INTEGER NOT NULL
);

CREATE TABLE track (
    -- The track entry ID for the track entry identification.
    id         INTEGER PRIMARY KEY AUTOINCREMENT
               NOT NULL,
    -- The day of the track entry, in BCD format, e.g. 20260506 for May 6, 2026.
    -- The day ends at 4:00 AM the next day, so from 0:00 to 4:00 (exclusive) use previous day.
    day        INTEGER NOT NULL,
    -- The start time of the track entry, in seconds since 0:00 AM of the current day
    -- The day starts at 4:00 AM, so the value starts at 14400 (4 hours * 3600 seconds/hour) and can be greater than 86400 (24 hours * 3600 seconds/hour).
    start_time INTEGER NOT NULL,
    -- The end time of the track entry, in seconds since 0:00 AM of the current day
    -- The day starts at 4:00 AM, so the value starts at 14400 (4 hours * 3600 seconds/hour) and can be greater than 86400 (24 hours * 3600 seconds/hour).
    -- This can be lower than start_time if the track entry was added manually to indicate negative time spent on the task.
    end_time   INTEGER NOT NULL,
    -- The task ID of the track entry.
    task       TEXT    NOT NULL,
    -- 0 or 1, whether the track entry was created manually.
    manual     INTEGER NOT NULL
);

CREATE INDEX tasks_active ON tasks (
    active
);

CREATE INDEX track_day ON track (
    day
);

CREATE INDEX track_task ON track (
    task
);

INSERT INTO tasks (
                      id,
                      name,
                      active,
                      [order]
                  )
                  VALUES (
                      'admin',
                      'Meetings, administrative, messages, e.t.c.',
                      0,
-                     1
                  );

INSERT INTO tasks (
                      id,
                      name,
                      active,
                      [order]
                  )
                  VALUES (
                      'prv',
                      'Private time',
                      0,
-                     1
                  );

INSERT INTO tasks (
                      id,
                      name,
                      active,
                      [order]
                  )
                  VALUES (
                      'org-3',
                      'Reviews',
                      1,
                      0
                  );

INSERT INTO tasks (
                      id,
                      name,
                      active,
                      [order]
                  )
                  VALUES (
                      'org-2',
                      'Mails, messages',
                      1,
                      0
                  );

INSERT INTO tasks (
                      id,
                      name,
                      active,
                      [order]
                  )
                  VALUES (
                      'org-1',
                      'Timesheet, KUP, e.t.c.',
                      1,
                      0
                  );
