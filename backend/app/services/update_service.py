import asyncio
import hashlib
import hmac
import json
import re
import time
from datetime import UTC, datetime
from html.parser import HTMLParser
from typing import Any
from xml.etree import ElementTree

import httpx

from app.core.config import get_settings
from app.core.version import APP_VERSION, version_info

_SEMVER = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$")


class _ReleaseHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.links: list[tuple[str | None, int]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"h1", "h2", "h3"}:
            self.parts.append(f"\n{'#' * int(tag[1])} ")
        elif tag in {"p", "br", "ul", "ol"}:
            self.parts.append("\n")
        elif tag == "li":
            self.parts.append("\n- ")
        elif tag == "a":
            self.links.append((dict(attrs).get("href"), len(self.parts)))

    def handle_endtag(self, tag: str) -> None:
        if tag == "a":
            href, start = self.links.pop() if self.links else (None, len(self.parts))
            link_text = "".join(self.parts[start:]).strip()
            if href and link_text:
                del self.parts[start:]
                self.parts.append(f"[{link_text}]({href})")
        elif tag in {"h1", "h2", "h3", "p", "li"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def markdown(self) -> str:
        lines = [re.sub(r"\s+", " ", line).strip() for line in "".join(self.parts).splitlines()]
        return "\n".join(line for line in lines if line).strip()


def release_html_to_markdown(value: str) -> str:
    parser = _ReleaseHTMLParser()
    parser.feed(value)
    return parser.markdown()


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
        self._releases: list[dict[str, Any]] = []
        self._cached_at = 0.0
        self._checked_at: str | None = None
        self._etag: str | None = None
        self._error: str | None = None

    def _result(self, limit: int) -> dict[str, Any]:
        return {
            "items": self._releases[:limit],
            "checked_at": self._checked_at,
            "error": self._error,
        }

    @staticmethod
    def _release_from_payload(payload: dict[str, Any]) -> dict[str, Any] | None:
        if payload.get("draft") or payload.get("prerelease"):
            return None
        try:
            version = normalize_version(str(payload.get("tag_name", "")))
        except ValueError:
            return None
        return {
            "version": version,
            "tag_name": payload.get("tag_name") or f"v{version}",
            "name": payload.get("name") or f"FlowMind {version}",
            "body": payload.get("body") or "",
            "published_at": payload.get("published_at"),
            "html_url": payload.get("html_url"),
            "prerelease": False,
        }

    async def list_releases(
        self, *, force: bool = False, limit: int = 20
    ) -> dict[str, Any]:
        settings = get_settings()
        limit = max(1, min(limit, 50))
        now = time.monotonic()
        if (
            not force
            and self._checked_at is not None
            and now - self._cached_at < settings.update_check_ttl_seconds
        ):
            return self._result(limit)

        async with self._lock:
            now = time.monotonic()
            if (
                not force
                and self._checked_at is not None
                and now - self._cached_at < settings.update_check_ttl_seconds
            ):
                return self._result(limit)

            checked_at = datetime.now(UTC).isoformat()
            url = f"https://api.github.com/repos/{settings.release_repository}/releases"
            try:
                async with httpx.AsyncClient(timeout=12.0) as client:
                    headers = {
                        "Accept": "application/vnd.github+json",
                        "User-Agent": f"FlowMind/{APP_VERSION}",
                        "X-GitHub-Api-Version": "2022-11-28",
                    }
                    if settings.github_token:
                        headers["Authorization"] = f"Bearer {settings.github_token}"
                    if self._etag:
                        headers["If-None-Match"] = self._etag
                    response = await client.get(
                        url,
                        headers=headers,
                        params={"per_page": 50},
                    )
                if response.status_code == 304:
                    self._error = None
                elif response.status_code == 404:
                    self._releases = []
                    self._etag = None
                    self._error = None
                else:
                    response.raise_for_status()
                    payload = response.json()
                    if not isinstance(payload, list):
                        raise TypeError("GitHub Releases API returned an invalid payload")
                    self._releases = [
                        release
                        for item in payload
                        if isinstance(item, dict)
                        if (release := self._release_from_payload(item)) is not None
                    ]
                    self._etag = response.headers.get("ETag")
                    self._error = None
            except (httpx.HTTPError, ValueError, TypeError, json.JSONDecodeError) as exc:
                self._error = f"检查更新失败: {str(exc)[:300]}"
                if not self._releases:
                    try:
                        fallback = await self._fallback_releases(settings.release_repository)
                        self._releases = fallback
                        self._error = None
                    except (httpx.HTTPError, ValueError, ElementTree.ParseError) as fallback_exc:
                        self._error = f"检查更新失败: {str(fallback_exc)[:300]}"

            self._checked_at = checked_at
            self._cached_at = now
            return self._result(limit)

    async def check(self, *, force: bool = False) -> dict[str, Any]:
        releases = await self.list_releases(force=force, limit=1)
        items = releases["items"]
        return {
            "latest": items[0] if items else None,
            "checked_at": releases["checked_at"],
            "error": releases["error"],
        }

    async def _fallback_releases(self, repository: str) -> list[dict[str, Any]]:
        feed_url = f"https://github.com/{repository}/releases.atom"
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.get(
                feed_url,
                headers={"User-Agent": f"FlowMind/{APP_VERSION}"},
            )
        if response.status_code == 404:
            return []
        response.raise_for_status()

        root = ElementTree.fromstring(response.text)
        namespace = {"atom": "http://www.w3.org/2005/Atom"}
        releases: list[dict[str, Any]] = []
        for entry in root.findall("atom:entry", namespace):
            entry_id = entry.findtext("atom:id", default="", namespaces=namespace)
            tag_name = entry_id.rsplit("/", 1)[-1]
            try:
                version = normalize_version(tag_name)
            except ValueError:
                continue
            if "-" in version:
                continue
            title = entry.findtext("atom:title", default="", namespaces=namespace)
            content = entry.findtext("atom:content", default="", namespaces=namespace)
            link = entry.find("atom:link[@rel='alternate']", namespace)
            html_url = link.get("href") if link is not None else None
            releases.append(
                {
                    "version": version,
                    "tag_name": tag_name,
                    "name": title if title and title != tag_name else f"FlowMind {version}",
                    "body": release_html_to_markdown(content),
                    "published_at": entry.findtext(
                        "atom:updated", default="", namespaces=namespace
                    )
                    or None,
                    "html_url": html_url,
                    "prerelease": False,
                }
            )
        return releases


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
