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


if __name__ == "__main__":
    unittest.main()
