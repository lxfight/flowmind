"""Shared filesystem path helpers.

Centralizes upload-directory resolution so that file writes (e.g. avatar
uploads) and the StaticFiles mount always point at the same directory:
``<backend>/uploads`` when ``settings.upload_dir`` is relative.
"""

from pathlib import Path

from app.core.config import get_settings

# backend/ directory (this file lives at backend/app/core/paths.py)
BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent


def get_upload_dir() -> Path:
    """Return the absolute upload directory, resolving relative to backend/."""
    upload_dir = Path(get_settings().upload_dir)
    if not upload_dir.is_absolute():
        upload_dir = BACKEND_ROOT / upload_dir
    return upload_dir


def get_avatars_dir() -> Path:
    """Return the avatars subdirectory, creating it if necessary."""
    avatars_dir = get_upload_dir() / "avatars"
    avatars_dir.mkdir(parents=True, exist_ok=True)
    return avatars_dir
