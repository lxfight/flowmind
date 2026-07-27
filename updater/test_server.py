import json
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import server


class GitArgsTests(unittest.TestCase):
    def test_marks_the_mounted_project_as_safe(self) -> None:
        with patch.object(server, "PROJECT_DIR", Path("/srv/flowmind")):
            self.assertEqual(
                server.git_args("status", "--short"),
                ["git", "-c", "safe.directory=/srv/flowmind", "status", "--short"],
            )

    def test_default_accelerators_use_https_prefixes(self) -> None:
        self.assertEqual(server.github_accelerators(""), server.DEFAULT_GITHUB_ACCELERATORS)
        self.assertEqual(server.github_accelerators("off"), ())
        self.assertEqual(
            server.github_accelerators("https://one.example/,http://unsafe.example"),
            ("https://one.example",),
        )

    def test_fetch_sources_prefix_the_github_repository_url(self) -> None:
        with (
            patch.object(server, "RELEASE_REPOSITORY", "lxfight/flowmind"),
            patch.object(server, "github_accelerators", return_value=("https://proxy.example",)),
        ):
            self.assertEqual(
                server.git_fetch_sources(),
                (
                    ("GitHub", "origin"),
                    (
                        "proxy.example",
                        "https://proxy.example/https://github.com/lxfight/flowmind.git",
                    ),
                ),
            )

    def test_official_fetch_success_stops_fallback(self) -> None:
        state = {"logs": []}
        with (
            patch.object(
                server,
                "git_fetch_sources",
                return_value=(("GitHub", "origin"), ("proxy.example", "https://proxy.example/repo")),
            ),
            patch.object(server, "git_fetch_timeout", return_value=30),
            patch.object(server, "command", return_value="") as run_command,
            patch.object(server, "add_log"),
        ):
            server.fetch_tags(state)

        run_command.assert_called_once()
        self.assertEqual(run_command.call_args.args[1][-3:], ["fetch", "--tags", "origin"])

    def test_fetch_falls_back_to_accelerator(self) -> None:
        state = {"logs": []}
        with (
            patch.object(
                server,
                "git_fetch_sources",
                return_value=(("GitHub", "origin"), ("proxy.example", "https://proxy.example/repo")),
            ),
            patch.object(server, "git_fetch_timeout", return_value=30),
            patch.object(server, "command", side_effect=(RuntimeError("offline"), "")) as run_command,
            patch.object(server, "add_log"),
        ):
            server.fetch_tags(state)

        self.assertEqual(run_command.call_count, 2)
        self.assertEqual(run_command.call_args_list[0].args[1][-3:], ["fetch", "--tags", "origin"])
        self.assertEqual(
            run_command.call_args_list[1].args[1][-3:],
            ["fetch", "--tags", "https://proxy.example/repo"],
        )

    def test_fetch_reports_all_source_failures(self) -> None:
        state = {"logs": []}
        with (
            patch.object(
                server,
                "git_fetch_sources",
                return_value=(("GitHub", "origin"), ("proxy.example", "https://proxy.example/repo")),
            ),
            patch.object(server, "git_fetch_timeout", return_value=30),
            patch.object(server, "command", side_effect=(RuntimeError("offline"), RuntimeError("bad gateway"))),
            patch.object(server, "add_log"),
        ):
            with self.assertRaisesRegex(RuntimeError, "GitHub: offline.*proxy.example: bad gateway"):
                server.fetch_tags(state)


class OperationAdmissionTests(unittest.TestCase):
    def test_starts_one_queued_operation(self) -> None:
        idle = {"status": "idle", "request_id": None}
        thread = MagicMock()
        lock_handle = MagicMock()
        with (
            patch.object(server, "load_state", side_effect=[idle, idle]),
            patch.object(server, "initial_state", return_value={"logs": []}),
            patch.object(server, "current_version", return_value="1.0.0"),
            patch.object(server, "acquire_operation_lock", return_value=lock_handle),
            patch.object(server, "save_state") as save_state,
            patch.object(server.threading, "Thread", return_value=thread) as make_thread,
        ):
            queued = server.start_operation("update", "1.1.0", "request-123")

        self.assertEqual(queued["status"], "queued")
        self.assertEqual(queued["target_version"], "1.1.0")
        save_state.assert_called_once_with(queued)
        make_thread.assert_called_once_with(
            target=server.run_operation,
            args=("update", "1.1.0", "request-123", lock_handle),
            daemon=True,
        )
        thread.start.assert_called_once_with()

    def test_rejects_a_second_active_operation(self) -> None:
        active = {"status": "deploying", "request_id": "request-123"}
        with patch.object(server, "load_state", return_value=active):
            with self.assertRaisesRegex(RuntimeError, "another update"):
                server.start_operation("update", "1.2.0", "request-456")

    def test_releases_file_lock_when_state_changes_before_queueing(self) -> None:
        idle = {"status": "idle", "request_id": None}
        active = {"status": "deploying", "request_id": "request-123"}
        lock_handle = MagicMock()
        with (
            patch.object(server, "load_state", side_effect=[idle, active]),
            patch.object(server, "acquire_operation_lock", return_value=lock_handle),
            patch.object(server, "release_operation_lock") as release_lock,
        ):
            with self.assertRaisesRegex(RuntimeError, "another update"):
                server.start_operation("update", "1.2.0", "request-456")

        release_lock.assert_called_once_with(lock_handle)

    def test_rejects_request_id_reuse_for_another_operation(self) -> None:
        current = {
            "status": "succeeded",
            "operation": "update",
            "request_id": "request-123",
            "target_version": "1.1.0",
        }
        with patch.object(server, "load_state", return_value=current):
            with self.assertRaisesRegex(RuntimeError, "request id"):
                server.start_operation("rollback", "1.1.0", "request-123")

    def test_returns_matching_idempotent_operation(self) -> None:
        current = {
            "status": "succeeded",
            "operation": "update",
            "request_id": "request-123",
            "target_version": "1.1.0",
        }
        with patch.object(server, "load_state", return_value=current):
            replay = server.start_operation("update", "1.1.0", "request-123")

        self.assertIs(replay, current)


class RecoveryTests(unittest.TestCase):
    def test_interrupted_deployment_restores_previous_version(self) -> None:
        state = {
            "deployment_started": True,
            "previous_sha": "abc123",
            "previous_version": "1.0.0",
            "logs": [],
        }
        with (
            patch.object(server, "add_log"),
            patch.object(server, "rollback_deployment") as rollback,
            patch.object(server, "update_state") as update_state,
        ):
            server.recover_interrupted_operation(state)

        rollback.assert_called_once_with(state, "abc123", "1.0.0")
        self.assertEqual(update_state.call_args.kwargs["status"], "rolled_back")
        self.assertFalse(update_state.call_args.kwargs["deployment_started"])

    def test_interrupted_deployment_reports_recovery_failure(self) -> None:
        state = {
            "deployment_started": True,
            "previous_sha": "abc123",
            "previous_version": "1.0.0",
            "logs": [],
        }
        with (
            patch.object(server, "add_log"),
            patch.object(server, "rollback_deployment", side_effect=RuntimeError("docker offline")),
            patch.object(server, "update_state") as update_state,
        ):
            server.recover_interrupted_operation(state)

        self.assertEqual(update_state.call_args.kwargs["status"], "failed")
        self.assertIn("docker offline", update_state.call_args.kwargs["error"])


class HealthCheckTests(unittest.TestCase):
    @staticmethod
    def response(version: str):
        response = MagicMock()
        response.status = 200
        response.read.return_value = json.dumps({"version": version}).encode()
        response.__enter__.return_value = response
        return response

    def test_waits_until_backend_reports_expected_version(self) -> None:
        state = {"logs": []}
        with (
            patch.object(
                server.urllib.request,
                "urlopen",
                side_effect=[self.response("1.0.0"), self.response("1.1.0")],
            ) as urlopen,
            patch.object(server.time, "monotonic", side_effect=[0, 0, 0]),
            patch.object(server.time, "sleep"),
            patch.object(server, "add_log") as add_log,
        ):
            server.wait_for_url(
                state,
                "http://backend/api/health",
                "backend",
                timeout=10,
                expected_version="1.1.0",
            )

        self.assertEqual(urlopen.call_count, 2)
        add_log.assert_called_once_with(state, "backend 健康检查通过")


if __name__ == "__main__":
    unittest.main()
