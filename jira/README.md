# Jira Sprint Synchronization

Run from the repository root using the existing virtual environment. No extra
packages are required (Python standard library only).

## Jira Cloud

Use your Jira account email and an API token. Provide secrets through environment
variables to avoid putting them in command arguments or shell history:

```bash
read -rsp 'Work-status UID: ' WORK_STATUS_UID
printf '\n'
read -rsp 'Jira API token: ' JIRA_TOKEN
printf '\n'
export WORK_STATUS_UID JIRA_TOKEN
export JIRA_EMAIL='you@example.com'

.venv/bin/python jira/sync_jira.py \
  --work-status-url https://status.example.com \
  --jira-url https://company.atlassian.net \
  --dry-run
```

Inspect the plan, then run the same command **without `--dry-run`** to apply it.
Logs go to standard error with timestamps. The script logs every discovered task,
issue, decision, planned change, HTTP request method/path, and confirmed update.
It does not log authentication headers or request bodies containing credentials.
Issue summaries and task names are included, so treat log files as private.

The equivalent credential flags are `--work-status-uid`, `--jira-token`, and
`--jira-email`. Both base URLs must include any deployment subdirectory, not an
endpoint path such as `status.php`. Use HTTPS for both services.

## Jira Server / Data Center

For a personal access token, use Bearer authentication and REST API version 2:

```bash
.venv/bin/python jira/sync_jira.py \
  --work-status-url https://status.example.com \
  --jira-url https://jira.example.com/jira \
  --jira-auth bearer \
  --jira-api-version 2 \
  --dry-run
```

This uses `WORK_STATUS_UID` and `JIRA_TOKEN` from the environment. No email is
needed for Bearer authentication. For installations using Basic authentication,
use `--jira-auth basic` and `--jira-email` with the appropriate username.
The default configuration is Basic authentication with API version 3 for Cloud
(email plus API token, using the enhanced `/rest/api/3/search/jql` endpoint).

## Synchronization Rules

The authenticated Jira user defines "me". Selection uses:

```text
assignee = currentUser() AND sprint in openSprints() ORDER BY key ASC
```

All active sprints visible to that user are included, across boards/projects.
There is no board-specific selection or completed-status filter. An empty sprint
selection still deactivates confirmed Jira tasks outside the selection.

Tasks are matched by Jira issue key, case-insensitively:

- Missing selected issue: create a task named after its Jira summary, make it
  active, and append it after the existing task order.
- Inactive selected issue: activate it, preserving its name and order.
- Already active selected issue: leave it unchanged.
- Active task outside the selection: look up its key directly in Jira, not just
  within the sprint/project. If Jira confirms it exists, deactivate it.
- Non-Jira task ID, or a Jira lookup returning 403/404: preserve it. Jira can hide
  issues without browse permission, so missing and inaccessible are not reliably
  distinguishable. Such tasks are logged with a warning.
- Inactive task outside the selection: leave it unchanged.

The original request's final rule is interpreted as "active tasks that do **not**
exist in Jira are left untouched"; otherwise it conflicts with the preceding
deactivation rule. Tasks assigned to someone else are outside the selection even
when they are in an active sprint.

Only GET requests are made to Jira; no Jira update API is used. Provision the
credential with read-only permissions/scopes for current user, issue search, and
issue lookup, and grant the user browse access to the relevant projects.

Work-status is read through `GET /status.php`. After all Jira pages and lookups
succeed, changes are submitted in one UID-authenticated `POST /status.php`,
containing only affected tasks/fields. Tracking data, unrelated tasks, existing
names, and existing ordering are not rewritten. A dry run makes no work-status
POST requests. No session token is requested or invalidated.

Network failures, authentication failures, rate limits, malformed responses, and
incomplete pagination stop the run before applying its plan. Missing/inaccessible
individual issues (403/404) are preserved as described above. Requests time out
after 30 seconds; override with `--timeout`. Redirects are rejected to prevent
credential forwarding: supply each service's final canonical base URL.

Successful runs exit with status 0; failures exit with 1. Updates are checked
against the server response. If the update request times out, it may already have
been applied: inspect with another dry run before retrying. Do not edit tasks
concurrently with a synchronization run; this API has no concurrency/version
check. Existing names deliberately are not synchronized after task creation.

## Tests

```bash
.venv/bin/python -m unittest discover -s jira -p 'test_*.py' -v
```

Tests mock remote services and do not require or contact live credentials.