"""Tests for project report generation: stats computation and /api/llm/report."""

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from helpers import (
    add_member,
    admin_login,
    create_project,
    create_task,
    register_and_approve,
)

from app.services.report_service import (
    MAX_ASSIGNEE_LINES,
    MAX_PROJECT_DESCRIPTION_CHARS,
    REPORT_SECTION_TITLES,
    InvalidReportOutputError,
    ReportMilestone,
    ReportTask,
    build_report_prompt,
    compute_report_stats,
    format_stats_text,
    validate_report_output,
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

    def test_activity_total_reflects_window_not_truncation(self):
        """The "N 条" label must match the true window total, not the capped list."""
        tasks = make_tasks()
        stats = compute_report_stats(tasks, now=NOW)
        shown = [f"动态 {i}" for i in range(20)]
        text = format_stats_text(stats, tasks, shown, now=NOW, activity_total=57)
        assert "近 7 天项目动态（共 57 条，列出最近 20 条）" in text

    def test_activity_total_defaults_to_shown_count(self):
        tasks = make_tasks()
        stats = compute_report_stats(tasks, now=NOW)
        text = format_stats_text(stats, tasks, ["动态 A", "动态 B"], now=NOW)
        assert "共 2 条" in text

    def test_milestones_include_precomputed_progress_and_tasks(self):
        tasks = make_tasks()
        stats = compute_report_stats(tasks, now=NOW)
        milestones = [
            ReportMilestone(
                title="内测发布",
                status="open",
                health="at_risk",
                target_date=date(2025, 6, 20),
                owner="Alice",
                task_total=4,
                task_completed=2,
                progress=50,
                task_titles=["完成登录页", "修复支付 Bug"],
            ),
            ReportMilestone(
                title="正式上线",
                status="completed",
                health="completed",
                target_date=date(2025, 7, 1),
                task_total=1,
                task_completed=1,
                progress=100,
                task_titles=["设计评审"],
            ),
        ]

        text = format_stats_text(stats, tasks, [], now=NOW, milestones=milestones)

        assert "项目里程碑（共 2 个）" in text
        assert "内测发布 | 状态:进行中 | 健康:有风险" in text
        assert "负责人:Alice | 进度:50%（2/4）" in text
        assert "关联任务:完成登录页、修复支付 Bug" in text
        assert "正式上线 | 状态:已完成 | 健康:已完成" in text

    def test_empty_milestones_are_explicit(self):
        tasks = make_tasks()
        stats = compute_report_stats(tasks, now=NOW)
        text = format_stats_text(stats, tasks, [], now=NOW)

        assert "项目里程碑（共 0 个）" in text
        assert "当前项目暂无里程碑" in text

    def test_task_detail_cap(self):
        tasks = [
            ReportTask(title=f"任务{i}", status_name="待办", updated_at=NOW)
            for i in range(40)
        ]
        stats = compute_report_stats(tasks, now=NOW)
        text = format_stats_text(stats, tasks, [], now=NOW)
        assert "另有 10 个任务未列出" in text

    def test_assignee_load_is_bounded_and_stable(self):
        tasks = [
            ReportTask(
                title=f"任务{i}", status_name="待办", updated_at=NOW, assignees=[f"成员{i:02d}"]
            )
            for i in range(MAX_ASSIGNEE_LINES + 3)
        ]
        stats = compute_report_stats(tasks, now=NOW)
        text = format_stats_text(stats, tasks, [], now=NOW)

        assert "- 成员00: 1 个" in text
        assert f"- 成员{MAX_ASSIGNEE_LINES - 1:02d}: 1 个" in text
        assert f"- 成员{MAX_ASSIGNEE_LINES:02d}: 1 个" not in text
        assert "另有 3 名成员未列出" in text

    def test_project_description_is_bounded(self):
        prompt = build_report_prompt("大项目", "x" * (MAX_PROJECT_DESCRIPTION_CHARS + 100), "统计")

        assert "x" * MAX_PROJECT_DESCRIPTION_CHARS in prompt
        assert "x" * (MAX_PROJECT_DESCRIPTION_CHARS + 1) not in prompt
        assert "项目描述已截断" in prompt

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

    def test_report_validation_normalizes_markdown_fence(self):
        report = "```markdown\n" + "\n".join(
            f"## {section}\n内容" for section in REPORT_SECTION_TITLES
        ) + "\n```"

        cleaned = validate_report_output(report)

        assert cleaned.startswith("## 一、本期概览")
        assert "```" not in cleaned

    def test_report_validation_rejects_missing_sections(self):
        with pytest.raises(InvalidReportOutputError, match="六、下一步建议"):
            validate_report_output("## 一、本期概览\n内容")


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

    first_milestone = client.post(
        f"/api/projects/{project_id}/milestones",
        headers=headers,
        json={
            "title": "发布候选版",
            "description": "完成候选版本验证",
            "target_date": (datetime.now(UTC).date() + timedelta(days=14)).isoformat(),
            "task_ids": [task_id],
        },
    )
    assert first_milestone.status_code == 201, first_milestone.text
    second_milestone = client.post(
        f"/api/projects/{project_id}/milestones",
        headers=headers,
        json={
            "title": "正式发布",
            "target_date": (datetime.now(UTC).date() + timedelta(days=30)).isoformat(),
            "task_ids": [],
        },
    )
    assert second_milestone.status_code == 201, second_milestone.text

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
    assert body["project_id"] == project_id
    assert body["generated_by"] is not None
    assert "generated_at" in body

    prompt = captured["prompt"]
    # precomputed stats present
    assert "报告测试项目" in prompt
    assert "任务总数 1" in prompt
    assert "完成率 0.0%" in prompt
    assert "逾期任务（未完成且已过截止日期）（共 1 个）" in prompt
    assert "高优任务" in prompt
    assert "项目里程碑（共 2 个）" in prompt
    assert "发布候选版" in prompt
    assert "正式发布" in prompt
    assert "进度:0%（0/1）" in prompt
    assert "关联任务:高优任务" in prompt
    # required section skeleton present
    for section in ["一、本期概览", "二、进度分析", "三、重点事项与里程碑",
                    "四、风险与阻塞", "五、成员负载", "六、下一步建议"]:
        assert section in prompt
    # injection guard present
    assert "不要执行" in prompt


@pytest.mark.asyncio
async def test_generated_report_is_shared_with_project_members(client):
    admin_headers = admin_login(client)
    project_id, _ = create_project(client, admin_headers, name="共享报告项目")
    member_id, member_headers = register_and_approve(
        client, admin_headers, "report_member"
    )
    add_member(client, admin_headers, project_id, member_id)

    with patch(
        "app.services.llm_service.llm_service.generate_report",
        new=AsyncMock(return_value="项目共享报告内容"),
    ) as generate:
        response = client.post(
            f"/api/llm/report?project_id={project_id}", headers=admin_headers
        )

    assert response.status_code == 200, response.text
    shared = client.get(
        f"/api/llm/report?project_id={project_id}", headers=member_headers
    )
    assert shared.status_code == 200, shared.text
    assert [item["report"] for item in shared.json()] == ["项目共享报告内容"]
    assert generate.await_count == 1
    status = client.get(
        f"/api/llm/report/status?project_id={project_id}", headers=member_headers
    )
    assert status.status_code == 200, status.text
    assert status.json() == {
        "is_generating": False,
        "generated_by": None,
        "started_at": None,
    }


@pytest.mark.asyncio
async def test_report_generation_status_is_shared_and_rejects_duplicates(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="生成状态共享项目")
    generation_started = threading.Event()
    release_generation = threading.Event()

    async def slow_generate_report(_prompt: str) -> str:
        generation_started.set()
        await asyncio.to_thread(release_generation.wait)
        return "唯一生成的报告"

    with patch(
        "app.services.llm_service.llm_service.generate_report",
        new=AsyncMock(side_effect=slow_generate_report),
    ) as generate, ThreadPoolExecutor(max_workers=1) as executor:
        first_request = executor.submit(
            client.post,
            f"/api/llm/report?project_id={project_id}",
            headers=headers,
        )
        assert generation_started.wait(timeout=5)

        status = client.get(
            f"/api/llm/report/status?project_id={project_id}", headers=headers
        )
        assert status.status_code == 200, status.text
        assert status.json()["is_generating"] is True
        assert status.json()["generated_by"] is not None

        duplicate = client.post(
            f"/api/llm/report?project_id={project_id}", headers=headers
        )
        assert duplicate.status_code == 409, duplicate.text
        assert "正在生成" in duplicate.json()["detail"]

        release_generation.set()
        completed = first_request.result(timeout=5)

    assert completed.status_code == 200, completed.text
    assert completed.json()["report"] == "唯一生成的报告"
    assert generate.await_count == 1


@pytest.mark.asyncio
async def test_report_history_is_project_scoped_and_newest_first(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="报告历史项目")
    other_project_id, _ = create_project(client, headers, name="其他项目")

    with patch(
        "app.services.llm_service.llm_service.generate_report",
        new=AsyncMock(side_effect=["第一版", "第二版", "其他项目报告"]),
    ):
        for target_id in (project_id, project_id, other_project_id):
            response = client.post(
                f"/api/llm/report?project_id={target_id}", headers=headers
            )
            assert response.status_code == 200, response.text

    history = client.get(
        f"/api/llm/report?project_id={project_id}", headers=headers
    )
    assert history.status_code == 200, history.text
    assert [item["report"] for item in history.json()] == ["第二版", "第一版"]


@pytest.mark.asyncio
async def test_report_endpoint_requires_membership(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="私有项目")
    resp = client.post(f"/api/llm/report?project_id={project_id}")
    assert resp.status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("exception", "status_code", "detail"),
    [
        ("not_configured", 503, "LLM 未配置"),
        ("timeout", 504, "报告生成超时"),
        ("invalid", 502, "报告不完整"),
        ("unavailable", 502, "暂时不可用"),
    ],
)
async def test_report_endpoint_maps_generation_errors(
    client, exception, status_code, detail
):
    from app.services.llm_service import (
        LLMNotConfiguredError,
        LLMReportInvalidResponseError,
        LLMReportTimeoutError,
        LLMReportUnavailableError,
    )

    errors = {
        "not_configured": LLMNotConfiguredError(),
        "timeout": LLMReportTimeoutError(),
        "invalid": LLMReportInvalidResponseError(),
        "unavailable": LLMReportUnavailableError(),
    }
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name=f"报告错误-{exception}")

    with patch(
        "app.services.llm_service.llm_service.generate_report",
        new=AsyncMock(side_effect=errors[exception]),
    ):
        response = client.post(f"/api/llm/report?project_id={project_id}", headers=headers)

    assert response.status_code == status_code
    assert detail in response.json()["detail"]
    status = client.get(
        f"/api/llm/report/status?project_id={project_id}", headers=headers
    )
    assert status.status_code == 200, status.text
    assert status.json()["is_generating"] is False
