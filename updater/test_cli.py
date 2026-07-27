import io
import json
import sys
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

import cli


class CliTests(unittest.TestCase):
    def run_cli(self, state: dict, *arguments: str) -> dict:
        output = io.StringIO()
        with (
            patch.object(sys, "argv", ["cli.py", *arguments]),
            patch.object(cli, "run_operation"),
            patch.object(cli, "load_state", return_value=state),
            redirect_stdout(output),
        ):
            cli.main()
        return json.loads(output.getvalue())

    def test_update_prints_successful_final_state(self) -> None:
        state = {"request_id": "request-123", "status": "succeeded"}

        output = self.run_cli(state, "1.1.0", "--request-id", "request-123")

        self.assertEqual(output, state)

    def test_update_returns_failure_after_automatic_rollback(self) -> None:
        state = {"request_id": "request-123", "status": "rolled_back"}
        with self.assertRaises(SystemExit) as raised:
            self.run_cli(state, "1.1.0", "--request-id", "request-123")

        self.assertEqual(raised.exception.code, 1)

    def test_rollback_accepts_rolled_back_status(self) -> None:
        state = {"request_id": "request-123", "status": "rolled_back"}

        output = self.run_cli(
            state,
            "1.0.0",
            "--rollback",
            "--request-id",
            "request-123",
        )

        self.assertEqual(output, state)

    def test_request_mismatch_returns_failure(self) -> None:
        state = {"request_id": "another-request", "status": "succeeded"}
        with self.assertRaises(SystemExit) as raised:
            self.run_cli(state, "1.1.0", "--request-id", "request-123")

        self.assertEqual(raised.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
