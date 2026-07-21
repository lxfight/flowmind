"""@mention notifications in LLM agent chat messages.

Mentions resolve only to members of the chat's project; the sender is
never notified about their own mention, and unknown names are ignored.
The mention fan-out runs regardless of LLM configuration (the endpoint
returns a graceful error result when no API key is set).
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


def test_chat_mention_notifies_project_member(client):
    headers = admin_login(client)
    member_id, member_headers = register_and_approve(client, headers, "chatmember")
    project_id, _ = create_project(client, headers)
    add_member(client, headers, project_id, member_id, role="member")

    _chat(client, headers, project_id, "@chatmember 帮我看一下这个项目的任务")

    assert "mention" in _notification_types(client, member_headers)


def test_chat_mention_does_not_notify_self(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)

    _chat(client, headers, project_id, "给自己提个醒 @admin")

    assert "mention" not in _notification_types(client, headers)


def test_chat_mention_ignores_non_member(client):
    headers = admin_login(client)
    outsider_id, outsider_headers = register_and_approve(client, headers, "chatoutsider")
    project_id, _ = create_project(client, headers)

    _chat(client, headers, project_id, "随便提一下 @chatoutsider")

    assert "mention" not in _notification_types(client, outsider_headers)


def test_chat_without_mention_sends_no_notification(client):
    headers = admin_login(client)
    member_id, member_headers = register_and_approve(client, headers, "chatquiet")
    project_id, _ = create_project(client, headers)
    add_member(client, headers, project_id, member_id, role="member")

    _chat(client, headers, project_id, "今天项目进展如何？")

    assert "mention" not in _notification_types(client, member_headers)


def test_chat_stream_mention_also_notifies(client):
    headers = admin_login(client)
    member_id, member_headers = register_and_approve(client, headers, "chatstreamer")
    project_id, _ = create_project(client, headers)
    add_member(client, headers, project_id, member_id, role="member")

    response = client.post(
        "/api/llm/agent-chat/stream",
        headers=headers,
        json={"project_id": project_id, "message": "@chatstreamer 流式也通知"},
    )
    assert response.status_code == 200, response.text

    assert "mention" in _notification_types(client, member_headers)
