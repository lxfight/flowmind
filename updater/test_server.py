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

    def test_detects_optional_notifier_service(self) -> None:
        state = {"logs": []}
        with patch.object(
            server,
            "command",
            return_value="postgres\nbackend\nnotifier\nfrontend\nupdater\n",
        ):
            self.assertEqual(
                server.configured_application_services(state),
                ("backend", "frontend", "notifier", "updater"),
            )

    def test_supports_rollback_to_compose_without_notifier(self) -> None:
        state = {"logs": []}
        with patch.object(
            server,
            "command",
            return_value="postgres\nbackend\nfrontend\nupdater\n",
        ):
            self.assertEqual(
                server.configured_application_services(state),
                ("backend", "frontend", "updater"),
            )

    def test_requires_backend_and_frontend_services(self) -> None:
        state = {"logs": []}
        with patch.object(server, "command", return_value="postgres\nbackend\n"):
            with self.assertRaisesRegex(RuntimeError, "frontend"):
                server.configured_application_services(state)

    def test_reads_service_image_from_rendered_compose_config(self) -> None:
        state = {"logs": []}
        rendered = json.dumps(
            {
                "services": {
                    "updater": {
                        "image": "mirror.example/ghcr.io/lxfight/flowmind-updater:1.1.0"
                    }
                }
            }
        )
        with patch.object(server, "command", return_value=rendered) as run_command:
            image = server.configured_service_image(state, "updater")

        self.assertEqual(
            image,
            "mirror.example/ghcr.io/lxfight/flowmind-updater:1.1.0",
        )
        run_command.assert_called_once_with(
            state,
            server.compose_args("config", "--format", "json"),
            timeout=60,
        )

    def test_rejects_compose_service_without_image(self) -> None:
        state = {"logs": []}
        with patch.object(
            server,
            "command",
            return_value=json.dumps({"services": {"updater": {}}}),
        ):
            with self.assertRaisesRegex(RuntimeError, "updater"):
                server.configured_service_image(state, "updater")

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


class UpdaterRecreateTests(unittest.TestCase):
    def test_reloader_uses_the_image_resolved_by_compose(self) -> None:
        state = {
            "request_id": "request-123",
            "target_version": "1.1.0",
            "logs": [],
        }
        mirror_image = "mirror.example/ghcr.io/lxfight/flowmind-updater:1.1.0"
        with (
            patch.object(server, "PROJECT_DIR", Path("/srv/flowmind")),
            patch.object(server, "COMPOSE_PROJECT", "flowmind"),
            patch.object(
                server,
                "configured_service_image",
                return_value=mirror_image,
            ) as resolve_image,
            patch.object(server, "command") as run_command,
        ):
            server.schedule_updater_recreate(state)

        resolve_image.assert_called_once_with(state, "updater")
        command = run_command.call_args.args[1]
        self.assertIn(mirror_image, command)
        self.assertNotIn("ghcr.io/lxfight/flowmind-updater:1.1.0", command)


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

    def test_pull_images_retries_on_transient_failures(self) -> None:
        state = {"logs": []}
        with (
            patch.object(server, "command", side_effect=(RuntimeError("dial tcp timeout"), "")) as run,
            patch.object(server.time, "sleep") as sleep,
            patch.object(server, "add_log"),
        ):
            server.pull_images_with_retry(state, ("backend", "frontend"))

        # First attempt failed, second succeeded.
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args_list[0].args[1][:3], ["docker", "compose", "-p"])
        sleep.assert_called_once()

    def test_pull_images_gives_up_after_all_attempts(self) -> None:
        state = {"logs": []}
        with (
            patch.object(server, "command", side_effect=RuntimeError("registry down")),
            patch.object(server.time, "sleep"),
            patch.object(server, "add_log"),
        ):
            with self.assertRaisesRegex(RuntimeError, "多次失败"):
                server.pull_images_with_retry(state, ("backend",))
            self.assertEqual(server.command.call_count, 3)

    def test_fetch_tags_uses_gentle_low_speed_threshold(self) -> None:
        state = {"logs": []}
        with (
            patch.object(server, "git_fetch_sources", return_value=(("GitHub", "origin"),)),
            patch.object(server, "git_fetch_timeout", return_value=45),
            patch.object(server, "command", return_value="") as run,
            patch.object(server, "add_log"),
        ):
            server.fetch_tags(state)

        fetch = run.call_args.args[1]
        self.assertIn("-c", fetch)
        self.assertIn("http.lowSpeedLimit=100", fetch)
        self.assertIn("http.lowSpeedTime=30", fetch)

    def test_pull_falls_back_to_image_registry_mirror(self) -> None:
        state = {"logs": []}
        with (
            patch.object(server, "image_registry_mirrors", return_value=("mirror.example",)),
            patch.object(
                server,
                "configured_service_image",
                return_value="ghcr.io/lxfight/flowmind-backend:1.2.0",
            ),
            # 3 failed compose pulls (retries) then docker pull + docker tag via mirror.
            patch.object(
                server, "command", side_effect=[RuntimeError, RuntimeError, RuntimeError, "", ""]
            ) as run,
            patch.object(server.time, "sleep"),
            patch.object(server, "add_log"),
        ):
            server.pull_images_with_retry(state, ("backend",))

        # compose pull failed thrice (retries), then docker pull + tag from mirror.
        calls = [c.args[1] for c in run.call_args_list]
        self.assertTrue(any(c[0:3] == ["docker", "compose", "-p"] for c in calls))
        self.assertTrue(
            any("mirror.example/lxfight/flowmind-backend:1.2.0" in c for c in calls)
        )
        self.assertTrue(
            any(
                c
                == [
                    "docker",
                    "tag",
                    "mirror.example/lxfight/flowmind-backend:1.2.0",
                    "ghcr.io/lxfight/flowmind-backend:1.2.0",
                ]
                for c in calls
            )
        )

    def test_pull_reports_failure_when_mirror_also_unavailable(self) -> None:
        state = {"logs": []}
        with (
            patch.object(server, "image_registry_mirrors", return_value=("mirror.example",)),
            patch.object(
                server,
                "configured_service_image",
                return_value="ghcr.io/lxfight/flowmind-backend:1.2.0",
            ),
            patch.object(server, "command", side_effect=RuntimeError("all down")),
            patch.object(server, "add_log"),
        ):
            with self.assertRaisesRegex(RuntimeError, "多次失败"):
                server.pull_images_with_retry(state, ("backend",))

    def test_pull_mirror_keeps_full_ghcr_prefix_source(self) -> None:
        """A mirror that already includes /ghcr.io must keep the registry path
        (source = mirror/lxfight/flowmind-backend), not double the owner."""
        state = {"logs": []}
        with (
            patch.object(server, "image_registry_mirrors", return_value=("https://ghproxy.example/https://ghcr.io",)),
            patch.object(
                server,
                "configured_service_image",
                return_value="ghcr.io/lxfight/flowmind-backend:1.2.0",
            ),
            patch.object(server, "command", return_value="") as run,
            patch.object(server, "add_log"),
        ):
            assert server.pull_image_via_mirror(state, "ghcr.io/lxfight/flowmind-backend:1.2.0")

        pull = run.call_args_list[0].args[1]
        self.assertEqual(
            pull,
            ["docker", "pull", "https://ghproxy.example/https://ghcr.io/lxfight/flowmind-backend:1.2.0"],
        )
        tag = run.call_args_list[1].args[1]
        self.assertEqual(
            tag,
            ["docker", "tag", "https://ghproxy.example/https://ghcr.io/lxfight/flowmind-backend:1.2.0", "ghcr.io/lxfight/flowmind-backend:1.2.0"],
        )

    def test_pull_mirror_without_ghcr_prefix_uses_owner_path(self) -> None:
        """A plain registry proxy mirrors <mirror>/<owner>/<image>."""
        state = {"logs": []}
        with (
            patch.object(server, "image_registry_mirrors", return_value=("https://docker.m.daocloud.io",)),
            patch.object(server, "command", return_value="") as run,
            patch.object(server, "add_log"),
        ):
            assert server.pull_image_via_mirror(state, "ghcr.io/lxfight/flowmind-backend:1.2.0")

        pull = run.call_args_list[0].args[1]
        self.assertEqual(
            pull,
            ["docker", "pull", "https://docker.m.daocloud.io/lxfight/flowmind-backend:1.2.0"],
        )

    def test_preflight_stashes_tracked_changes_when_allowed(self) -> None:
        state = {"logs": []}
        with (
            patch.object(server, "PROJECT_DIR", Path("/srv/flowmind")),
            # docker info, compose version, git status (dirty), stash push,
            # rev-parse HEAD, git fetch, rev-parse --verify, cat-file.
            patch.object(server, "command", side_effect=["", "", " M docker-compose.yml", "", "abc123", "", "", ""]) as run,
            patch.object(server, "add_log"),
            patch.object(server, "atomic_json"),
            patch.object(server, "read_json", return_value={}),
            patch.object(server, "git_fetch_sources", return_value=(("GitHub", "origin"),)),
            patch.dict(server.os.environ, {"FLOWMIND_ALLOW_DIRTY_UPDATE": "1"}, clear=False),
        ):
            with patch.object(Path, "is_file", return_value=True):
                with patch.object(server.shutil, "disk_usage", return_value=MagicMock(free=10**12)):
                    server.preflight(state, "1.2.0")

        calls = [c.args[1] for c in run.call_args_list]
        self.assertTrue(any("stash" in c and "push" in c for c in calls))
        self.assertTrue(state.get("dirty_stashed"))

    def test_preflight_rejects_dirty_tree_by_default(self) -> None:
        state = {"logs": []}
        project = Path("/srv/flowmind")
        with (
            patch.object(server, "PROJECT_DIR", project),
            patch.object(Path, "is_file", return_value=True),
            patch.object(server.shutil, "disk_usage", return_value=MagicMock(free=10**12)),
            patch.object(server, "command", return_value=" M docker-compose.yml"),
            patch.object(server, "add_log"),
            patch.object(server, "atomic_json"),
            patch.object(server, "read_json", return_value={}),
            patch.object(server, "git_fetch_sources", return_value=()),
            patch.dict(server.os.environ, {}, clear=False),
        ):
            with self.assertRaisesRegex(RuntimeError, "working tree has tracked changes"):
                server.preflight(state, "1.2.0")
        self.assertFalse(state.get("dirty_stashed"))

    def test_restore_stashed_changes_pops_stash(self) -> None:
        state = {"logs": [], "dirty_stashed": True}
        with (
            patch.object(server, "command", return_value="") as run,
            patch.object(server, "add_log"),
        ):
            server.restore_stashed_changes(state)
        self.assertTrue(any("stash" in c.args[1] and "pop" in c.args[1] for c in run.call_args_list))
        self.assertFalse(state.get("dirty_stashed"))

    def test_restore_stashed_changes_keeps_stash_on_conflict(self) -> None:
        state = {"logs": [], "dirty_stashed": True}
        with (
            patch.object(server, "command", side_effect=RuntimeError("conflict")),
            patch.object(server, "add_log"),
        ):
            server.restore_stashed_changes(state)
        self.assertTrue(state.get("dirty_stashed"))


if __name__ == "__main__":
    unittest.main()
