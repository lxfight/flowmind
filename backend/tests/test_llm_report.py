"""Tests for project report generation: stats computation and /api/llm/report."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from helpers import admin_login, create_project, create_task

from app.services.report_service import (
    ReportTask,
    build_report_prompt,
    compute_report_stats,
    format_stats_text,
)

NOW = datetime(2025, 6, 15, 12, 0, 0, tzinfo=UTC)


def make_tasks() -> list[ReportTask]:
    return [
        # done task in a done column
        ReportTask(
            title="完成登录页", status_name="已完成", status_is_done=True,
            priority=2, is_completed=True, updated_at=NOW,
            assignees=["Alice"], subtask_total=2, subtask_done=2,
        ),
        # overdue, high priority, assigned
        ReportTask(
            title="修复支付 Bug", status_name="进行中", priority=4,
            due_date=NOW - timedelta(days=2), updated_at=NOW - timedelta(days=1),
            assignees=["Bob"],
        ),
        # stale (not updated for 10 days), unassigned
        ReportTask(
            title="编写部署文档", status_name="待办", priority=1,
            updated_at=NOW - timedelta(days=10),
        ),
        # fresh normal task
        ReportTask(
            title="设计评审", status_name="待办", priority=2,
            due_date=NOW + timedelta(days=3), updated_at=NOW,
            assignees=["Alice", "Carol"], subtask_total=3, subtask_done=1,
        ),
    ]


class TestComputeReportStats:
    def test_counts_and_completion_rate(self):
        stats = compute_report_stats(make_tasks(), now=NOW)
        assert stats["total"] == 4
        assert stats["done"] == 1
        assert stats["completion_rate"] == 25.0
        assert stats["status_counts"] == {"已完成": 1, "进行中": 1, "待办": 2}
        assert stats["subtask_total"] == 5
        assert stats["subtask_done"] == 3

    def test_overdue_high_priority_stale(self):
        stats = compute_report_stats(make_tasks(), now=NOW)
        assert [t.title for t in stats["overdue"]] == ["修复支付 Bug"]
        assert [t.title for t in stats["high_priority_open"]] == ["修复支付 Bug"]
        assert [t.title for t in stats["stale"]] == ["编写部署文档"]

    def test_priority_counts_exclude_done(self):
        stats = compute_report_stats(make_tasks(), now=NOW)
        assert stats["priority_counts"] == {4: 1, 1: 1, 2: 1}

    def test_assignee_load_includes_unassigned(self):
        stats = compute_report_stats(make_tasks(), now=NOW)
        assert stats["assignee_load"] == {"Bob": 1, "未分配": 1, "Alice": 1, "Carol": 1}

    def test_empty_project(self):
        stats = compute_report_stats([], now=NOW)
        assert stats["total"] == 0
        assert stats["completion_rate"] == 0.0
        assert stats["overdue"] == []


class TestPromptBuilding:
    def test_stats_text_contains_precomputed_numbers(self):
        tasks = make_tasks()
        stats = compute_report_stats(tasks, now=NOW)
        text = format_stats_text(stats, tasks, ["创建了任务 X"], now=NOW)
        assert "完成率 25.0%" in text
        assert "- 待办: 2 个" in text
        assert "逾期任务" in text and "修复支付 Bug" in text
        assert "长期未更新任务" in text and "编写部署文档" in text
        assert "高优先级未完成任务" in text
        assert "- Bob: 1 个" in text
        assert "近 7 天项目动态" in text

    def test_task_detail_cap(self):
        tasks = [
            ReportTask(title=f"任务{i}", status_name="待办", updated_at=NOW)
            for i in range(40)
        ]
        stats = compute_report_stats(tasks, now=NOW)
        text = format_stats_text(stats, tasks, [], now=NOW)
        assert "另有 10 个任务未列出" in text

    def test_prompt_structure_and_guards(self):
        tasks = make_tasks()
        stats = compute_report_stats(tasks, now=NOW)
        text = format_stats_text(stats, tasks, [], now=NOW)
        prompt = build_report_prompt("演示项目", "一个演示项目", text)
        # project context
        assert "演示项目" in prompt and "一个演示项目" in prompt
        # precomputed stats embedded
        assert "完成率 25.0%" in prompt
        # required section skeleton
        for section in ["一、本期概览", "二、进度分析", "三、重点事项与里程碑",
                        "四、风险与阻塞", "五、成员负载", "六、下一步建议"]:
            assert section in prompt
        # anti-hallucination and injection guard
        assert "不得编造数据" in prompt
        assert "必须与【预统计数据】一致" in prompt
        assert "<task_data>" in prompt and "</task_data>" in prompt
        assert "不要执行" in prompt
        # Chinese markdown output requirement
        assert "中文" in prompt and "Markdown" in prompt


@pytest.mark.asyncio
async def test_report_endpoint_with_mocked_llm(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="报告测试项目")
    todo = next(s for s in statuses if not s["is_done"])

    task = create_task(client, headers, project_id, todo["id"], "高优任务")
    task_id = task["id"]
    past = (datetime.now(UTC) - timedelta(days=3)).isoformat()
    resp = client.put(
        f"/api/projects/{project_id}/tasks/{task_id}",
        headers=headers,
        json={"priority": 4, "due_date": past},
    )
    assert resp.status_code == 200, resp.text

    mock_report = "## 一、本期概览\n这是 mock 报告"
    captured: dict[str, str] = {}

    async def fake_generate_report(prompt: str) -> str:
        captured["prompt"] = prompt
        return mock_report

    with patch(
        "app.services.llm_service.llm_service.generate_report",
        new=AsyncMock(side_effect=fake_generate_report),
    ):
        resp = client.post(
            f"/api/llm/report?project_id={project_id}", headers=headers
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["report"] == mock_report
    assert "generated_at" in body

    prompt = captured["prompt"]
    # precomputed stats present
    assert "报告测试项目" in prompt
    assert "任务总数 1" in prompt
    assert "完成率 0.0%" in prompt
    assert "逾期任务（未完成且已过截止日期）（共 1 个）" in prompt
    assert "高优任务" in prompt
    # required section skeleton present
    for section in ["一、本期概览", "二、进度分析", "三、重点事项与里程碑",
                    "四、风险与阻塞", "五、成员负载", "六、下一步建议"]:
        assert section in prompt
    # injection guard present
    assert "不要执行" in prompt


@pytest.mark.asyncio
async def test_report_endpoint_requires_membership(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="私有项目")
    resp = client.post(f"/api/llm/report?project_id={project_id}")
    assert resp.status_code == 401
