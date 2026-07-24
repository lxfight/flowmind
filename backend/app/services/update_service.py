import asyncio
import hashlib
import hmac
import json
import re
import time
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

import httpx

from app.core.config import get_settings
from app.core.version import APP_VERSION, version_info

_SEMVER = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$")


def normalize_version(value: str) -> str:
    match = _SEMVER.fullmatch(value.strip())
    if not match:
        raise ValueError("版本号必须符合 SemVer，例如 1.2.3")
    suffix = f"-{match.group(4)}" if match.group(4) else ""
    return f"{match.group(1)}.{match.group(2)}.{match.group(3)}{suffix}"


def version_is_newer(candidate: str, current: str) -> bool:
    candidate_match = _SEMVER.fullmatch(candidate)
    current_match = _SEMVER.fullmatch(current)
    if not candidate_match or not current_match:
        return candidate != current
    candidate_core = tuple(int(candidate_match.group(i)) for i in range(1, 4))
    current_core = tuple(int(current_match.group(i)) for i in range(1, 4))
    if candidate_core != current_core:
        return candidate_core > current_core
    candidate_pre = candidate_match.group(4)
    current_pre = current_match.group(4)
    if current_pre and not candidate_pre:
        return True
    if candidate_pre and not current_pre:
        return False
    return bool(candidate_pre and current_pre and candidate_pre > current_pre)


class ReleaseService:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._cached: dict[str, Any] | None = None
        self._cached_at = 0.0

    async def check(self, *, force: bool = False) -> dict[str, Any]:
        settings = get_settings()
        now = time.monotonic()
        if (
            not force
            and self._cached is not None
            and now - self._cached_at < settings.update_check_ttl_seconds
        ):
            return self._cached

        async with self._lock:
            now = time.monotonic()
            if (
                not force
                and self._cached is not None
                and now - self._cached_at < settings.update_check_ttl_seconds
            ):
                return self._cached

            checked_at = datetime.now(UTC).isoformat()
            url = f"https://api.github.com/repos/{settings.release_repository}/releases/latest"
            try:
                async with httpx.AsyncClient(timeout=12.0) as client:
                    headers = {
                        "Accept": "application/vnd.github+json",
                        "User-Agent": f"FlowMind/{APP_VERSION}",
                        "X-GitHub-Api-Version": "2022-11-28",
                    }
                    if settings.github_token:
                        headers["Authorization"] = f"Bearer {settings.github_token}"
                    response = await client.get(
                        url,
                        headers=headers,
                    )
                if response.status_code == 404:
                    result = {"latest": None, "checked_at": checked_at, "error": None}
                else:
                    response.raise_for_status()
                    payload = response.json()
                    version = normalize_version(payload.get("tag_name", ""))
                    result = {
                        "latest": {
                            "version": version,
                            "tag_name": payload.get("tag_name", f"v{version}"),
                            "name": payload.get("name") or f"FlowMind {version}",
                            "body": payload.get("body") or "",
                            "published_at": payload.get("published_at"),
                            "html_url": payload.get("html_url"),
                            "prerelease": bool(payload.get("prerelease")),
                        },
                        "checked_at": checked_at,
                        "error": None,
                    }
            except (httpx.HTTPError, ValueError, TypeError, json.JSONDecodeError) as exc:
                try:
                    result = await self._fallback_check(settings.release_repository, checked_at)
                except (httpx.HTTPError, ValueError) as fallback_exc:
                    result = {
                        "latest": self._cached.get("latest") if self._cached else None,
                        "checked_at": checked_at,
                        "error": f"检查更新失败: {str(exc or fallback_exc)[:300]}",
                    }

            self._cached = result
            self._cached_at = now
            return result

    async def _fallback_check(self, repository: str, checked_at: str) -> dict[str, Any]:
        latest_url = f"https://github.com/{repository}/releases/latest"
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=False) as client:
            response = await client.get(
                latest_url,
                headers={"User-Agent": f"FlowMind/{APP_VERSION}"},
            )
        if response.status_code == 404:
            return {"latest": None, "checked_at": checked_at, "error": None}
        if response.status_code not in {301, 302, 303, 307, 308}:
            response.raise_for_status()
            raise ValueError("GitHub latest release did not redirect to a version tag")
        location = response.headers.get("location", "")
        location_path = urlparse(location).path.rstrip("/")
        if location_path.endswith("/releases"):
            return {"latest": None, "checked_at": checked_at, "error": None}
        tag_name = location_path.split("/")[-1]
        version = normalize_version(tag_name)
        html_url = location if location.startswith("http") else f"https://github.com{location}"
        return {
            "latest": {
                "version": version,
                "tag_name": tag_name,
                "name": f"FlowMind {version}",
                "body": "",
                "published_at": None,
                "html_url": html_url,
                "prerelease": False,
            },
            "checked_at": checked_at,
            "error": None,
        }


class UpdaterClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    @property
    def configured(self) -> bool:
        return bool(self.settings.updater_url and self.settings.updater_token)

    def _headers(self, method: str, path: str, body: bytes) -> dict[str, str]:
        timestamp = str(int(time.time()))
        signed = b"\n".join([timestamp.encode(), method.upper().encode(), path.encode(), body])
        signature = hmac.new(
            self.settings.updater_token.encode(), signed, hashlib.sha256
        ).hexdigest()
        return {
            "Content-Type": "application/json",
            "X-FlowMind-Timestamp": timestamp,
            "X-FlowMind-Signature": signature,
        }

    async def request(
        self, method: str, path: str, payload: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        if not self.configured:
            raise RuntimeError("updater 未配置")
        body = json.dumps(payload or {}, ensure_ascii=True, separators=(",", ":")).encode()
        headers = self._headers(method, path, body)
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.request(
                method,
                f"{self.settings.updater_url.rstrip('/')}{path}",
                content=body,
                headers=headers,
            )
        response.raise_for_status()
        return response.json()

    async def status(self) -> dict[str, Any]:
        try:
            payload = await self.request("GET", "/status")
            return {"available": True, **payload}
        except (RuntimeError, httpx.HTTPError, ValueError) as exc:
            return {
                "available": False,
                "status": "unavailable",
                "message": str(exc)[:300],
            }


release_service = ReleaseService()
updater_client = UpdaterClient()


async def update_overview(*, force: bool = False) -> dict[str, Any]:
    release, updater = await asyncio.gather(
        release_service.check(force=force), updater_client.status()
    )
    latest = release.get("latest")
    return {
        "current": version_info(),
        "latest": latest,
        "update_available": bool(
            latest and version_is_newer(latest["version"], APP_VERSION)
        ),
        "checked_at": release.get("checked_at"),
        "check_error": release.get("error"),
        "updater": updater,
    }
