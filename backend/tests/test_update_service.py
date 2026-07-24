import httpx
import pytest

from app.services.update_service import (
    ReleaseService,
    normalize_version,
    release_html_to_markdown,
    version_is_newer,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1.2.3", "1.2.3"),
        ("v1.2.3", "1.2.3"),
        ("2.0.0-rc.1", "2.0.0-rc.1"),
    ],
)
def test_normalize_version(raw: str, expected: str):
    assert normalize_version(raw) == expected


@pytest.mark.parametrize("raw", ["latest", "1.2", "1.2.3.4", "v1.x.0"])
def test_normalize_version_rejects_invalid_values(raw: str):
    with pytest.raises(ValueError):
        normalize_version(raw)


@pytest.mark.parametrize(
    ("candidate", "current", "expected"),
    [
        ("0.1.1", "0.1.0", True),
        ("1.0.0", "0.9.9", True),
        ("1.0.0", "1.0.0-rc.1", True),
        ("1.0.0-rc.1", "1.0.0", False),
        ("0.1.0", "0.1.0", False),
    ],
)
def test_version_is_newer(candidate: str, current: str, expected: bool):
    assert version_is_newer(candidate, current) is expected


def test_release_payload_filters_non_final_releases():
    assert ReleaseService._release_from_payload({"tag_name": "v1.0.0", "draft": True}) is None
    assert ReleaseService._release_from_payload({"tag_name": "v1.0.0-rc.1", "prerelease": True}) is None
    assert ReleaseService._release_from_payload({"tag_name": "nightly"}) is None


def test_release_payload_normalizes_public_release():
    release = ReleaseService._release_from_payload(
        {
            "tag_name": "v1.2.0",
            "name": "FlowMind 1.2.0",
            "body": "## New",
            "published_at": "2026-07-24T00:00:00Z",
            "html_url": "https://example.test/releases/v1.2.0",
        }
    )

    assert release == {
        "version": "1.2.0",
        "tag_name": "v1.2.0",
        "name": "FlowMind 1.2.0",
        "body": "## New",
        "published_at": "2026-07-24T00:00:00Z",
        "html_url": "https://example.test/releases/v1.2.0",
        "prerelease": False,
    }


def test_release_html_to_markdown_preserves_lists_and_links():
    body = release_html_to_markdown(
        '<h2>新功能</h2><ul><li>批量更新</li></ul><p><a href="https://example.test">详情</a></p>'
    )

    assert body == "## 新功能\n- 批量更新\n[详情](https://example.test)"


def test_release_html_to_markdown_does_not_repeat_url_links():
    body = release_html_to_markdown(
        '<p><a href="https://example.test">https://example.test</a></p>'
    )

    assert body == "[https://example.test](https://example.test)"


@pytest.mark.asyncio
async def test_release_list_reuses_etag_cache(monkeypatch):
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(
                200,
                headers={"ETag": '"release-etag"'},
                json=[
                    {
                        "tag_name": "v0.2.0",
                        "name": "FlowMind 0.2.0",
                        "body": "## Features",
                        "prerelease": False,
                        "draft": False,
                    }
                ],
            )
        return httpx.Response(304)

    transport = httpx.MockTransport(handler)

    class MockAsyncClient(httpx.AsyncClient):
        def __init__(self, *args, **kwargs):
            super().__init__(transport=transport)

    monkeypatch.setattr(httpx, "AsyncClient", MockAsyncClient)
    service = ReleaseService()

    first = await service.list_releases(force=True)
    second = await service.list_releases(force=True)

    assert first["items"][0]["version"] == "0.2.0"
    assert second["items"] == first["items"]
    assert requests[1].headers["If-None-Match"] == '"release-etag"'
