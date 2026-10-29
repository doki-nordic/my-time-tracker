#!/usr/bin/env python3
"""Synchronize current-user active-sprint Jira issues into work-status."""

import argparse
import base64
from http.client import HTTPException
import json
import logging
import os
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


LOG = logging.getLogger("sync_jira")
ISSUE_KEY = re.compile(r"[A-Z][A-Z0-9_]*-[0-9]+", re.IGNORECASE)
SPRINT_JQL = "assignee = currentUser() AND sprint in openSprints() ORDER BY key ASC"


class SyncError(Exception):
	"""An error that must stop synchronization."""


class ApiError(SyncError):
	def __init__(self, service, status):
		self.status = status
		super().__init__(f"{service} returned HTTP {status}")


class NoRedirects(HTTPRedirectHandler):
	def redirect_request(self, request, response, code, message, headers, new_url):
		return None


def base_url(value):
	parsed = urlsplit(value)
	if (
		parsed.scheme not in ("http", "https")
		or not parsed.netloc
		or parsed.username is not None
		or parsed.password is not None
		or parsed.query
		or parsed.fragment
	):
		raise argparse.ArgumentTypeError(
			"Use an http(s) base URL without credentials, query, or fragment"
		)
	return value.rstrip("/")


class JsonApi:
	def __init__(self, url, service, headers=None, timeout=30):
		self.url = url
		self.service = service
		self.headers = {"Accept": "application/json", **(headers or {})}
		self.timeout = timeout
		self.opener = build_opener(NoRedirects())

	def request(self, method, path, query=None, payload=None):
		url = self.url + path
		if query:
			url += "?" + urlencode(query)
		headers = dict(self.headers)
		data = None
		if payload is not None:
			headers["Content-Type"] = "application/json"
			data = json.dumps(payload).encode("utf-8")
		LOG.info("%s: %s %s", self.service, method, path)
		request = Request(url, data=data, headers=headers, method=method)
		try:
			with self.opener.open(request, timeout=self.timeout) as response:
				result = json.load(response)
		except HTTPError as error:
			error.close()
			raise ApiError(self.service, error.code) from None
		except (URLError, OSError, ValueError, HTTPException) as error:
			raise SyncError(
				f"{self.service}: request failed ({type(error).__name__}); "
				"check connectivity, TLS, and the base URL"
			) from None
		if not isinstance(result, dict):
			raise SyncError(f"{self.service}: expected a JSON object")
		return result


class Jira:
	def __init__(self, api, version):
		self.api = api
		self.version = version
		self.root = f"/rest/api/{version}"

	def current_sprint_issues(self):
		identity = self.api.request("GET", self.root + "/myself")
		if not identity.get("accountId") and not identity.get("name"):
			raise SyncError("Jira: current user response has no identity")
		LOG.info("Jira authenticated user: %s", identity.get("displayName", "(unnamed)"))
		LOG.info("Jira selection JQL: %s", SPRINT_JQL)
		LOG.info("All active sprints visible to this user are included")
		issues = {}
		start = 0
		token = None
		seen_tokens = set()
		while True:
			query = {"jql": SPRINT_JQL, "fields": "summary", "maxResults": 100}
			if self.version == "3":
				path = self.root + "/search/jql"
				if token:
					query["nextPageToken"] = token
			else:
				path = self.root + "/search"
				query["startAt"] = start
			page = self.api.request("GET", path, query=query)
			batch = page.get("issues")
			if not isinstance(batch, list):
				raise SyncError("Jira: search response has no issues array")
			LOG.info("Jira search page: %d issue(s)", len(batch))
			for issue in batch:
				if not isinstance(issue, dict):
					raise SyncError("Jira: invalid issue in search response")
				key = issue.get("key")
				fields = issue.get("fields")
				if (
					not isinstance(key, str)
					or not ISSUE_KEY.fullmatch(key)
					or not isinstance(fields, dict)
					or not isinstance(fields.get("summary"), str)
				):
					raise SyncError("Jira: issue is missing a valid key or summary")
				issues[key.upper()] = fields["summary"]
				LOG.info("FOUND sprint issue %s: %s", key, fields["summary"])
			if self.version == "3":
				token = page.get("nextPageToken")
				if page.get("isLast") is True:
					break
				if not isinstance(token, str) or not token or token in seen_tokens:
					raise SyncError("Jira: incomplete or repeated search pagination")
				seen_tokens.add(token)
			else:
				total = page.get("total")
				if type(total) is not int or total < 0 or page.get("startAt") != start:
					raise SyncError("Jira: invalid search pagination")
				start += len(batch)
				if start >= total:
					break
				if not batch:
					raise SyncError("Jira: search ended before all issues were read")
		LOG.info("Jira sprint selection complete: %d unique issue(s)", len(issues))
		return issues

	def issue_exists(self, key):
		try:
			issue = self.api.request(
				"GET", self.root + "/issue/" + quote(key, safe=""),
				query={"fields": "summary"},
			)
		except ApiError as error:
			if error.status in (403, 404):
				LOG.warning(
					"KEEP %s: Jira HTTP %d; absent or inaccessible, existence "
					"cannot be confirmed. Jira permissions limit visibility.",
					key, error.status,
				)
				return False
			raise
		if not isinstance(issue.get("key"), str):
			raise SyncError(f"Jira: issue lookup for {key} returned no key")
		LOG.info("FOUND %s in Jira (current key %s), outside selection", key, issue["key"])
		return True


def read_tasks(response):
	tasks = response.get("tasks")
	if not isinstance(tasks, dict):
		raise SyncError("work-status: response has no tasks object")
	for key, task in tasks.items():
		if (
			not isinstance(task, dict)
			or not isinstance(task.get("name"), str)
			or type(task.get("active")) is not bool
			or type(task.get("order")) is not int
		):
			raise SyncError(f"work-status: invalid task {key}")
	return tasks


def plan_changes(jira, issues, tasks):
	changes = {}
	next_order = max((task["order"] for task in tasks.values()), default=-1) + 1
	normalized = {}
	for key, task in tasks.items():
		LOG.info("FOUND work-status task %s: active=%s order=%d name=%s",
				 key, task["active"], task["order"], task["name"])
		if ISSUE_KEY.fullmatch(key):
			canonical = key.upper()
			if canonical in normalized:
				raise SyncError(f"work-status: ambiguous case-insensitive task ID {key}")
			normalized[canonical] = key
	for key, summary in sorted(issues.items()):
		existing_key = normalized.get(key)
		if existing_key is None:
			changes[key] = {"name": summary, "active": True, "order": next_order}
			next_order += 1
			LOG.info("PLAN CREATE %s: active=true order=%d name=%s",
					 key, changes[key]["order"], summary)
		elif not tasks[existing_key]["active"]:
			changes[existing_key] = {"active": True}
			LOG.info("PLAN ACTIVATE %s: assigned to me in an active sprint", existing_key)
		else:
			LOG.info("KEEP %s: already active in current sprint selection", existing_key)
	for key, task in sorted(tasks.items()):
		if key.upper() in issues:
			continue
		if not task["active"]:
			LOG.info("KEEP %s: already inactive, outside selection", key)
		elif not ISSUE_KEY.fullmatch(key):
			LOG.info("KEEP %s: not a Jira issue key", key)
		elif jira.issue_exists(key):
			changes[key] = {"active": False}
			LOG.info("PLAN DEACTIVATE %s: exists in Jira, outside my active-sprint selection", key)
	return changes


def synchronize(jira, work_status, uid, dry_run):
	LOG.info("Mode: %s; Jira is read-only in all modes", "DRY RUN" if dry_run else "APPLY")
	issues = jira.current_sprint_issues()
	tasks = read_tasks(work_status.request("GET", "/status.php"))
	changes = plan_changes(jira, issues, tasks)
	LOG.info("Plan complete: %d change(s), %d task(s) currently in work-status",
			 len(changes), len(tasks))
	if dry_run:
		LOG.info("DRY RUN: no work-status writes sent")
		return changes
	if not changes:
		LOG.info("No updates needed")
		return changes
	LOG.info("Applying %d task change(s) to work-status", len(changes))
	updated = read_tasks(work_status.request(
		"POST", "/status.php", payload={"uid": uid, "tasks": changes},
	))
	for key, fields in changes.items():
		if key not in updated or any(updated[key].get(field) != value
									 for field, value in fields.items()):
			raise SyncError(f"work-status did not confirm the requested update for {key}")
		LOG.info("UPDATED %s: %s", key, json.dumps(fields, ensure_ascii=True))
	LOG.info("Synchronization complete: %d confirmed update(s)", len(changes))
	return changes


def parse_args(argv=None):
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--work-status-url", required=True, type=base_url,
						help="Server base URL, including deployment subdirectory if needed")
	parser.add_argument("--work-status-uid", default=os.environ.get("WORK_STATUS_UID"),
						help="Server UID (or WORK_STATUS_UID environment variable)")
	parser.add_argument("--jira-url", required=True, type=base_url,
						help="Jira base URL, e.g. https://company.atlassian.net")
	parser.add_argument("--jira-token", default=os.environ.get("JIRA_TOKEN"),
						help="API token / personal access token (or JIRA_TOKEN)")
	parser.add_argument("--jira-email", default=os.environ.get("JIRA_EMAIL"),
						help="Cloud email / username for Basic auth (or JIRA_EMAIL)")
	parser.add_argument("--jira-auth", choices=("basic", "bearer"), default="basic",
						help="Cloud API token: basic; Data Center PAT: bearer (default: basic)")
	parser.add_argument("--jira-api-version", choices=("2", "3"), default="3",
						help="Cloud: 3 (enhanced search); Server / Data Center: 2")
	parser.add_argument("--timeout", type=float, default=30,
						help="Timeout in seconds for each HTTP request (default: 30)")
	parser.add_argument("--dry-run", action="store_true", help="Log plan without updating work-status")
	args = parser.parse_args(argv)
	if not args.work_status_uid or not args.jira_token:
		parser.error("Provide work-status UID and Jira token via flags or environment variables")
	if args.jira_auth == "basic" and not args.jira_email:
		parser.error("Basic authentication requires --jira-email or JIRA_EMAIL")
	if not 0 < args.timeout < float("inf"):
		parser.error("--timeout must be a positive finite number")
	return args


def main(argv=None):
	logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
	args = parse_args(argv)
	if args.jira_auth == "basic":
		credential = base64.b64encode(
			f"{args.jira_email}:{args.jira_token}".encode("utf-8")
		).decode("ascii")
		authorization = "Basic " + credential
	else:
		authorization = "Bearer " + args.jira_token
	for service, url in (("Jira", args.jira_url), ("work-status", args.work_status_url)):
		if urlsplit(url).scheme != "https":
			LOG.warning("%s uses HTTP: credentials and data are not encrypted", service)
	jira = Jira(JsonApi(args.jira_url, "Jira", {"Authorization": authorization},
						args.timeout), args.jira_api_version)
	work_status = JsonApi(args.work_status_url, "work-status", timeout=args.timeout)
	try:
		synchronize(jira, work_status, args.work_status_uid, args.dry_run)
	except SyncError as error:
		LOG.error("Synchronization stopped: %s", error)
		LOG.error("No further writes will be attempted. If an update was sent, "
				  "it may have applied; re-run with --dry-run to inspect state.")
		return 1
	except KeyboardInterrupt:
		LOG.warning("Interrupted; re-run with --dry-run to inspect state")
		return 130
	return 0


if __name__ == "__main__":
	sys.exit(main())
