import io
import json
import unittest
from unittest.mock import Mock
from urllib.error import HTTPError

from sync_jira import (
    ApiError, Jira, JsonApi, NoRedirects, SyncError, main, parse_args,
    plan_changes, synchronize,
)


def task(active=True, name="Existing name", order=4):
    return {"name": name, "active": active, "order": order}


def issue(key):
    return {"key": key, "fields": {"summary": "Summary " + key}}


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.jira = Mock()
        self.jira.current_sprint_issues.return_value = {
            "APP-1": "New task", "APP-2": "Reactivate", "APP-3": "Already active",
        }
        self.tasks = {
            "APP-2": task(False), "APP-3": task(), "APP-4": task(),
            "APP-5": task(), "local": task(), "APP-6": task(False),
        }
        self.jira.issue_exists.side_effect = lambda key: key == "APP-4"
        self.work = Mock()
        self.work.request.return_value = {"tasks": self.tasks}

    def test_all_sync_rules_and_dry_run(self):
        changes = synchronize(self.jira, self.work, "secret", True)
        self.assertEqual(changes, {
            "APP-1": {"name": "New task", "active": True, "order": 5},
            "APP-2": {"active": True}, "APP-4": {"active": False},
        })
        self.work.request.assert_called_once_with("GET", "/status.php")
        self.assertEqual([call.args[0] for call in self.jira.issue_exists.call_args_list],
                         ["APP-4", "APP-5"])

    def test_apply_sends_only_changed_fields_and_uid(self):
        updated = {key: dict(value) for key, value in self.tasks.items()}
        updated["APP-1"] = task(True, "New task", 5)
        updated["APP-2"]["active"] = True
        updated["APP-4"]["active"] = False
        self.work.request.side_effect = [{"tasks": self.tasks}, {"tasks": updated}]
        changes = synchronize(self.jira, self.work, "secret", False)
        self.work.request.assert_called_with(
            "POST", "/status.php", payload={"uid": "secret", "tasks": changes},
        )
        self.assertNotIn("name", changes["APP-2"])

    def test_lookup_failure_aborts_before_any_write(self):
        self.jira.issue_exists.side_effect = ApiError("Jira", 500)
        with self.assertRaises(SyncError):
            synchronize(self.jira, self.work, "secret", False)
        self.work.request.assert_called_once_with("GET", "/status.php")

    def test_empty_sprint_still_checks_active_jira_tasks(self):
        changes = plan_changes(self.jira, {}, self.tasks)
        self.assertEqual(changes, {"APP-4": {"active": False}})

    def test_existing_lowercase_key_is_reused(self):
        changes = plan_changes(self.jira, {"APP-2": "Summary"}, {"app-2": task(False)})
        self.assertEqual(changes, {"app-2": {"active": True}})

    def test_ambiguous_keys_abort(self):
        with self.assertRaises(SyncError):
            plan_changes(self.jira, {}, {"app-2": task(), "APP-2": task()})

    def test_noop_does_not_post(self):
        self.jira.current_sprint_issues.return_value = {"APP-3": "Summary"}
        self.work.request.return_value = {"tasks": {"APP-3": task()}}
        self.assertEqual(synchronize(self.jira, self.work, "secret", False), {})
        self.work.request.assert_called_once_with("GET", "/status.php")

    def test_server_must_confirm_updates(self):
        with self.assertRaisesRegex(SyncError, "did not confirm"):
            synchronize(self.jira, self.work, "secret", False)


class TransportTests(unittest.TestCase):
    def test_uid_is_sent_in_json_body_and_subdirectory_is_preserved(self):
        api = JsonApi("https://example.test/work-status", "work-status")
        response = Mock()
        response.__enter__ = Mock(return_value=io.StringIO('{"tasks": {}}'))
        response.__exit__ = Mock(return_value=False)
        api.opener = Mock()
        api.opener.open.return_value = response
        self.assertEqual(api.request("POST", "/status.php", payload={
            "uid": "secret", "tasks": {"APP-1": {"active": True}},
        }), {"tasks": {}})
        request = api.opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://example.test/work-status/status.php")
        self.assertEqual(request.method, "POST")
        self.assertEqual(json.loads(request.data)["uid"], "secret")
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.assertIsNone(request.get_header("Authorization"))

    def test_get_query_authentication_and_timeout(self):
        api = JsonApi("https://example.test", "Jira", {"Authorization": "Bearer token"}, 12)
        response = Mock()
        response.__enter__ = Mock(return_value=io.StringIO('{"issues": []}'))
        response.__exit__ = Mock(return_value=False)
        api.opener = Mock()
        api.opener.open.return_value = response
        api.request("GET", "/search", query={"jql": "assignee = currentUser()"})
        request = api.opener.open.call_args.args[0]
        self.assertIn("jql=assignee+%3D+currentUser%28%29", request.full_url)
        self.assertEqual(request.get_header("Authorization"), "Bearer token")
        self.assertEqual(api.opener.open.call_args.kwargs["timeout"], 12)
        self.assertIsNone(request.data)

    def test_http_errors_do_not_log_sensitive_body_or_url(self):
        api = JsonApi("https://example.test", "Jira")
        api.opener = Mock()
        api.opener.open.side_effect = HTTPError(
            "https://example.test/?secret", 401, "secret", {}, io.BytesIO(b"secret"),
        )
        with self.assertRaises(ApiError) as caught:
            api.request("GET", "/myself")
        self.assertEqual(str(caught.exception), "Jira returned HTTP 401")

    def test_redirects_are_not_followed(self):
        self.assertIsNone(NoRedirects().redirect_request(
            None, None, 302, "Found", {}, "https://other.test",
        ))

    def test_cli_cloud_and_data_center_modes(self):
        args = parse_args([
            "--work-status-url", "https://status.test/sub/", "--work-status-uid", "uid",
            "--jira-url", "https://jira.test/", "--jira-token", "token",
            "--jira-email", "me@example.test", "--dry-run",
        ])
        self.assertTrue(args.dry_run)
        self.assertEqual(args.work_status_url, "https://status.test/sub")
        self.assertEqual(args.jira_api_version, "3")
        args = parse_args([
            "--work-status-url", "https://status.test", "--work-status-uid", "uid",
            "--jira-url", "https://jira.test", "--jira-token", "token",
            "--jira-auth", "bearer", "--jira-api-version", "2",
        ])
        self.assertEqual(args.jira_auth, "bearer")
        self.assertFalse(args.dry_run)


class JiraTests(unittest.TestCase):
    def test_cloud_pagination_is_read_only(self):
        api = Mock()
        api.request.side_effect = [
            {"accountId": "me", "displayName": "Test User"},
            {"issues": [issue("APP-1")], "isLast": False, "nextPageToken": "next"},
            {"issues": [issue("APP-2")], "isLast": True},
        ]
        self.assertEqual(Jira(api, "3").current_sprint_issues(), {
            "APP-1": "Summary APP-1", "APP-2": "Summary APP-2",
        })
        for call in api.request.call_args_list:
            self.assertEqual(call.args[0], "GET")
        self.assertEqual(api.request.call_args.kwargs["query"]["nextPageToken"], "next")

    def test_data_center_pagination(self):
        api = Mock()
        api.request.side_effect = [
            {"name": "me"},
            {"issues": [issue("APP-1")], "startAt": 0, "total": 2},
            {"issues": [issue("APP-2")], "startAt": 1, "total": 2},
        ]
        self.assertEqual(len(Jira(api, "2").current_sprint_issues()), 2)
        self.assertEqual(api.request.call_args.kwargs["query"]["startAt"], 1)

    def test_incomplete_cloud_results_abort(self):
        api = Mock()
        api.request.side_effect = [{"accountId": "me"}, {"issues": []}]
        with self.assertRaisesRegex(SyncError, "pagination"):
            Jira(api, "3").current_sprint_issues()

    def test_repeated_cloud_token_aborts(self):
        api = Mock()
        api.request.side_effect = [
            {"accountId": "me"},
            {"issues": [], "nextPageToken": "same"},
            {"issues": [], "nextPageToken": "same"},
        ]
        with self.assertRaisesRegex(SyncError, "pagination"):
            Jira(api, "3").current_sprint_issues()

    def test_truncated_data_center_results_abort(self):
        api = Mock()
        api.request.side_effect = [
            {"name": "me"}, {"issues": [], "startAt": 0, "total": 2},
        ]
        with self.assertRaises(SyncError):
            Jira(api, "2").current_sprint_issues()

    def test_absent_or_inaccessible_issues_are_preserved(self):
        for status in (403, 404):
            with self.subTest(status=status):
                api = Mock()
                api.request.side_effect = ApiError("Jira", status)
                self.assertFalse(Jira(api, "3").issue_exists("APP-1"))

    def test_other_lookup_errors_abort(self):
        for status in (401, 429, 500):
            with self.subTest(status=status):
                api = Mock()
                api.request.side_effect = ApiError("Jira", status)
                with self.assertRaises(SyncError):
                    Jira(api, "3").issue_exists("APP-1")


if __name__ == "__main__":
    unittest.main()