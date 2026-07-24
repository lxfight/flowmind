import os
from pathlib import Path


def _development_version() -> str:
    version_file = Path(__file__).resolve().parents[3] / "VERSION"
    try:
        return version_file.read_text(encoding="utf-8").strip() or "0.2.0"
    except OSError:
        return "0.2.0"


APP_VERSION = os.getenv("APP_VERSION") or _development_version()
GIT_SHA = os.getenv("GIT_SHA", "development")
BUILD_TIME = os.getenv("BUILD_TIME", "")


def version_info() -> dict[str, str]:
    return {
        "version": APP_VERSION,
        "git_sha": GIT_SHA,
        "build_time": BUILD_TIME,
    }
