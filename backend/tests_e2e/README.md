# Manual E2E / Smoke Scripts

These are end-to-end and smoke scripts. They are **not** part of the pytest
suite (`backend/tests/`), but they **are wired into CI** as a separate
non-blocking `e2e-smoke` job (`continue-on-error: true`) in
`.github/workflows/ci.yml` — failures show up in the checks list without
blocking PRs. They can also be run manually as described below.

Each script is self-contained: it creates its own temporary SQLite database,
so it does not touch your dev database. No LLM API key is required.
They print `[PASS]` / `[FAIL]` lines and exit non-zero on failure.

Run them **from the `backend/` directory** (so `app` is importable):

```bash
cd backend

# API-level e2e flows (use FastAPI TestClient in-process)
python -m tests_e2e.test_due_date_e2e        # due dates + due-reminder scanning
python -m tests_e2e.test_notifications_e2e   # notification generation & read flow
python -m tests_e2e.test_task_search_e2e     # cross-project task search
python -m tests_e2e.test_agent_undo_e2e      # streaming agent chat -> real tool execution -> undo batch

# WebSocket smoke test: starts a real uvicorn server on 127.0.0.1:8765
# and verifies a task_created event reaches a WS client after a REST mutation.
python -m tests_e2e.ws_smoke_test
```

> Note: `ws_smoke_test.py` binds a real local port; make sure nothing else is
> using 8765, and that `uvicorn` + `websockets` are installed
> (included in the project dependencies via `uvicorn[standard]`).

> Note: `test_agent_undo_e2e.py` sets its own dummy `LLM_API_KEY` before
> importing the app and replaces only the LLM "brain"
> (`agent_service.ChatOpenAI`) with a scripted fake chat model — the LangGraph
> ReAct loop, the real tools, the batch-snapshot machinery, persistence, and
> the undo endpoint all execute for real against its temp database. It is part
> of the same non-blocking CI `e2e-smoke` job.
