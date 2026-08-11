"""Attachment upload/list/download/delete coverage."""
import pytest
from helpers import (
    add_member,
    admin_login,
    create_project,
    create_task,
    register_and_approve,
)

from app.core.config import get_settings


@pytest.fixture
def upload_tmp(tmp_path, monkeypatch):
    """Redirect attachment storage to a per-test temp directory."""
    monkeypatch.setattr(get_settings(), "upload_dir", str(tmp_path))
    return tmp_path


def _setup(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers)
    task = create_task(client, headers, project_id, statuses[0]["id"], "附件任务")
    return headers, project_id, task["id"]


def _upload(client, headers, project_id, task_id, filename, content: bytes,
            content_type="application/octet-stream"):
    return client.post(
        f"/api/projects/{project_id}/tasks/{task_id}/attachments",
        headers=headers,
        files={"file": (filename, content, content_type)},
    )


@pytest.mark.asyncio
async def test_upload_list_download_delete_roundtrip(client, upload_tmp):
    headers, project_id, task_id = _setup(client)
    payload = b"hello attachment \x00\x01 bytes"

    response = _upload(client, headers, project_id, task_id, "notes.txt", payload, "text/plain")
    assert response.status_code == 201, response.text
    attachment = response.json()
    assert attachment["filename"] == "notes.txt"
    assert attachment["size"] == len(payload)

    response = client.get(
        f"/api/projects/{project_id}/tasks/{task_id}/attachments", headers=headers
    )
    assert [a["id"] for a in response.json()] == [attachment["id"]]

    # Download round-trip: bytes must match exactly
    response = client.get(
        f"/api/projects/{project_id}/tasks/{task_id}/attachments/{attachment['id']}/download",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.content == payload

    # Uploader can delete; afterwards download 404s
    response = client.delete(
        f"/api/projects/{project_id}/tasks/{task_id}/attachments/{attachment['id']}",
        headers=headers,
    )
    assert response.status_code == 200
    response = client.get(
        f"/api/projects/{project_id}/tasks/{task_id}/attachments/{attachment['id']}/download",
        headers=headers,
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_upload_rejects_oversize(client, upload_tmp):
    headers, project_id, task_id = _setup(client)
    big = b"x" * (20 * 1024 * 1024 + 1)
    response = _upload(client, headers, project_id, task_id, "big.txt", big)
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_path_traversal_filename_is_sanitized(client, upload_tmp):
    headers, project_id, task_id = _setup(client)
    response = _upload(client, headers, project_id, task_id, "../../evil.txt", b"echo pwned")
    assert response.status_code == 201, response.text
    attachment = response.json()
    # Only the basename is kept; nothing escapes the attachments directory
    assert attachment["filename"] == "evil.txt"
    stored_files = list((upload_tmp / "task_attachments").iterdir())
    assert len(stored_files) == 1
    stored = stored_files[0]
    assert stored.read_bytes() == b"echo pwned"
    assert stored.resolve().parent == (upload_tmp / "task_attachments").resolve()
    # And the download round-trips under the sanitized name
    response = client.get(
        f"/api/projects/{project_id}/tasks/{task_id}/attachments/{attachment['id']}/download",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.content == b"echo pwned"


@pytest.mark.asyncio
async def test_delete_permission_uploader_vs_member_vs_admin(client, upload_tmp):
    headers, project_id, task_id = _setup(client)
    uploader_id, uploader_headers = register_and_approve(client, headers, "uploader")
    other_id, other_headers = register_and_approve(client, headers, "othermember")
    add_member(client, headers, project_id, uploader_id, role="member")
    add_member(client, headers, project_id, other_id, role="member")

    attachment = _upload(
        client, uploader_headers, project_id, task_id, "a.txt", b"a"
    ).json()
    url = f"/api/projects/{project_id}/tasks/{task_id}/attachments/{attachment['id']}"

    # Non-uploader regular member cannot delete
    assert client.delete(url, headers=other_headers).status_code == 403
    # Project owner/admin can delete someone else's attachment
    assert client.delete(url, headers=headers).status_code == 200

    # Uploader can delete their own attachment
    attachment = _upload(
        client, uploader_headers, project_id, task_id, "b.txt", b"b"
    ).json()
    url = f"/api/projects/{project_id}/tasks/{task_id}/attachments/{attachment['id']}"
    assert client.delete(url, headers=uploader_headers).status_code == 200


@pytest.mark.asyncio
async def test_viewer_cannot_upload(client, upload_tmp):
    headers, project_id, task_id = _setup(client)
    viewer_id, viewer_headers = register_and_approve(client, headers, "attviewer")
    add_member(client, headers, project_id, viewer_id, role="viewer")
    response = _upload(client, viewer_headers, project_id, task_id, "v.txt", b"v")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_task_deletion_removes_attachment_files(client, upload_tmp):
    headers, project_id, task_id = _setup(client)
    _upload(client, headers, project_id, task_id, "notes.txt", b"delete me", "text/plain")
    stored_dir = upload_tmp / "task_attachments"
    assert len(list(stored_dir.iterdir())) == 1

    response = client.delete(f"/api/projects/{project_id}/tasks/{task_id}", headers=headers)
    assert response.status_code == 200, response.text

    # DB cascade removed the row; the on-disk file must be gone too.
    assert list(stored_dir.iterdir()) == []


@pytest.mark.asyncio
async def test_upload_rejects_active_content_extensions(client, upload_tmp):
    headers, project_id, task_id = _setup(client)
    for dangerous in (".html", ".svg", ".js", ".sh", ".bin", ".exe"):
        response = _upload(
            client, headers, project_id, task_id, f"evil{dangerous}", b"<script>alert(1)</script>"
        )
        assert response.status_code == 400, f"{dangerous} should be rejected"


@pytest.mark.asyncio
async def test_download_is_forced_inert_and_nosniff(client, upload_tmp):
    headers, project_id, task_id = _setup(client)
    attachment = _upload(
        client, headers, project_id, task_id, "notes.txt", b"hello", "text/plain"
    ).json()
    response = client.get(
        f"/api/projects/{project_id}/tasks/{task_id}/attachments/{attachment['id']}/download",
        headers=headers,
    )
    assert response.status_code == 200
    # Never inline-render: disposition is attachment and content-type is inert
    assert "attachment" in response.headers.get("content-disposition", "")
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert response.headers.get("content-type", "").startswith("text/plain")
    assert response.content == b"hello"


@pytest.mark.asyncio
async def test_task_attachments_not_served_by_static_mount(client, upload_tmp, monkeypatch):
    """Static mount exposes only avatars; task attachments are not reachable."""
    headers, project_id, task_id = _setup(client)
    _upload(client, headers, project_id, task_id, "notes.txt", b"hello", "text/plain")
    # The stored file is a uuid hex + ".txt" — try a plausible guess and a directory probe.
    stored_dir = upload_tmp / "task_attachments"
    assert stored_dir.exists()
    stored_name = next(stored_dir.iterdir()).name
    # Directly accessing the file through /api/uploads must not leak it.
    response = client.get(f"/api/uploads/task_attachments/{stored_name}")
    assert response.status_code == 404
    # The old whole-uploads mount is gone, so even the avatars path is the only mount.
    response = client.get(f"/api/uploads/{stored_name}")
    assert response.status_code == 404
    # The authenticated download endpoint still works.
    attachment = client.get(
        f"/api/projects/{project_id}/tasks/{task_id}/attachments", headers=headers
    ).json()[0]
    response = client.get(
        f"/api/projects/{project_id}/tasks/{task_id}/attachments/{attachment['id']}/download",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.content == b"hello"
