import unittest
from pathlib import Path
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
