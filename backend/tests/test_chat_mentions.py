"""@mention behavior in LLM agent chat messages.

Mentions in a chat message are context for the assistant, NOT a request to
alert the mentioned user — so they must never fan out notifications (unlike
task comments, where @mention notifies the member). This applies to both the
buffered and streaming endpoints.
"""
from helpers import add_member, admin_login, create_project, register_and_approve


def _chat(client, headers, project_id, message):
    response = client.post(
        "/api/llm/agent-chat",
        headers=headers,
        json={"project_id": project_id, "message": message},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _notification_types(client, headers):
    response = client.get("/api/notifications", headers=headers)
    assert response.status_code == 200, response.text
    return [n["type"] for n in response.json()["items"]]


def test_chat_mention_does_not_notify_member(client):
    """@ in a chat message must not notify the mentioned project member."""
    headers = admin_login(client)
    member_id, member_headers = register_and_approve(client, headers, "chatmember")
    project_id, _ = create_project(client, headers)
    add_member(client, headers, project_id, member_id, role="member")

    _chat(client, headers, project_id, "@chatmember 帮我看一下这个项目的任务")

    assert "mention" not in _notification_types(client, member_headers)


def test_chat_stream_mention_does_not_notify_member(client):
    """The streaming endpoint behaves the same: no mention notification."""
    headers = admin_login(client)
    member_id, member_headers = register_and_approve(client, headers, "chatstreamer")
    project_id, _ = create_project(client, headers)
    add_member(client, headers, project_id, member_id, role="member")

    response = client.post(
        "/api/llm/agent-chat/stream",
        headers=headers,
        json={"project_id": project_id, "message": "@chatstreamer 流式也不通知"},
    )
    assert response.status_code == 200, response.text

    assert "mention" not in _notification_types(client, member_headers)


def test_chat_without_mention_sends_no_notification(client):
    headers = admin_login(client)
    member_id, member_headers = register_and_approve(client, headers, "chatquiet")
    project_id, _ = create_project(client, headers)
    add_member(client, headers, project_id, member_id, role="member")

    _chat(client, headers, project_id, "今天项目进展如何？")

    assert "mention" not in _notification_types(client, member_headers)
