"""Coverage for the assistant's awareness of the current date/time.

The system prompt must carry the current local date/time so the model can
resolve relative dates (今天/明天/本周…), and bare due dates it emits must be
anchored to the local zone rather than UTC midnight.
"""
from datetime import datetime

from app.services import agent_service
from app.services.agent_service import _build_cross_project_prompt, _build_system_prompt, _parse_due_date


def test_system_prompt_includes_current_time():
    prompt = _build_system_prompt({"project_name": "P", "project_description": ""})
    assert "当前时间信息" in prompt
    assert "今天日期" in prompt
    assert "相对时间" in prompt


def test_cross_project_prompt_includes_current_time():
    prompt = _build_cross_project_prompt({1: "项目A"})
    assert "当前时间信息" in prompt


def test_current_time_context_has_today():
    ctx = agent_service._current_time_context()
    today = datetime.now().strftime("%Y-%m-%d")
    # The injected "今天日期" tracks the local calendar day.
    assert today in ctx


def test_parse_due_date_bare_date_is_local_end_of_day():
    dt = _parse_due_date("2026-07-25")
    assert dt.tzinfo is not None
    assert (dt.hour, dt.minute, dt.second) == (23, 59, 59)
    assert dt.strftime("%Y-%m-%d") == "2026-07-25"


def test_parse_due_date_naive_time_gets_local_zone():
    dt = _parse_due_date("2026-07-25T10:30")
    assert dt.tzinfo is not None
    assert (dt.hour, dt.minute) == (10, 30)


def test_parse_due_date_keeps_explicit_timezone():
    dt = _parse_due_date("2026-07-25T10:30:00+00:00")
    assert dt.utcoffset().total_seconds() == 0
