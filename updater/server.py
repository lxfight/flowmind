import fcntl
import hashlib
import hmac
import json
import os
import re
import shlex
import shutil
import subprocess
import threading
import time
import urllib.request
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


PORT = int(os.getenv("PORT", "8090"))
TOKEN = os.getenv("FLOWMIND_UPDATER_TOKEN", "")
PROJECT_DIR = Path(os.getenv("FLOWMIND_PROJECT_DIR", "/workspace")).resolve()
STATE_DIR = Path(os.getenv("FLOWMIND_UPDATE_STATE_DIR", "/state")).resolve()
COMPOSE_PROJECT = os.getenv("COMPOSE_PROJECT_NAME", "flowmind")
BACKEND_HEALTH_URL = os.getenv(
    "FLOWMIND_BACKEND_HEALTH_URL", "http://backend:8000/api/health"
)
FRONTEND_HEALTH_URL = os.getenv("FLOWMIND_FRONTEND_HEALTH_URL", "http://frontend/")
MIN_FREE_BYTES = int(os.getenv("FLOWMIND_UPDATE_MIN_FREE_BYTES", str(1024**3)))
APP_VERSION = os.getenv("APP_VERSION", "0.4.0")
RELEASE_REPOSITORY = os.getenv("FLOWMIND_RELEASE_REPOSITORY", "lxfight/flowmind").strip()
STATE_PATH = STATE_DIR / "update.json"
DEPLOYMENT_PATH = STATE_DIR / "deployment.json"
LOCK_PATH = STATE_DIR / "update.lock"
BACKUP_DIR = STATE_DIR / "backups"
SEMVER = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$")
ACTIVE = {"queued", "preparing", "backing_up", "downloading", "deploying", "verifying", "rolling_back"}
DEFAULT_GITHUB_ACCELERATORS = (
    "https://edgeone.gh-proxy.com",
    "https://hk.gh-proxy.com",
    "https://gh-proxy.com",
    "https://gh.dpik.top",
)
state_lock = threading.Lock()
operation_lock = threading.Lock()


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def normalize_version(value: str) -> str:
    match = SEMVER.fullmatch(value.strip())
    if not match:
        raise ValueError("invalid semantic version")
    suffix = f"-{match.group(4)}" if match.group(4) else ""
    return f"{match.group(1)}.{match.group(2)}.{match.group(3)}{suffix}"


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def read_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return default


def current_version() -> str:
    deployment = read_json(DEPLOYMENT_PATH, {})
    if deployment.get("version"):
        return str(deployment["version"])
    try:
        return (PROJECT_DIR / "VERSION").read_text(encoding="utf-8").strip() or APP_VERSION
    except OSError:
        return APP_VERSION


def initial_state() -> dict[str, Any]:
    return {
        "available": True,
        "status": "idle",
        "operation": None,
        "request_id": None,
        "previous_version": current_version(),
        "previous_sha": None,
        "target_version": None,
        "step": "idle",
        "progress": 0,
        "message": "updater 已就绪",
        "error": None,
        "backup_path": None,
        "deployment_started": False,
        "rollback_available": bool(read_json(DEPLOYMENT_PATH, {}).get("previous_version")),
        "started_at": None,
        "finished_at": None,
        "logs": [],
    }


def load_state() -> dict[str, Any]:
    state = read_json(STATE_PATH, initial_state())
    state["available"] = True
    return state


def save_state(state: dict[str, Any]) -> None:
    with state_lock:
        atomic_json(STATE_PATH, state)


def update_state(state: dict[str, Any], **changes: Any) -> None:
    state.update(changes)
    save_state(state)


def add_log(state: dict[str, Any], message: str) -> None:
    clean = message.strip()
    if not clean:
        return
    logs = list(state.get("logs") or [])
    logs.append(f"{datetime.now().strftime('%H:%M:%S')} {clean[:1000]}")
    state["logs"] = logs[-120:]
    save_state(state)


def command(
    state: dict[str, Any],
    args: list[str],
    *,
    timeout: int = 600,
    env: dict[str, str] | None = None,
) -> str:
    add_log(state, f"$ {shlex.join(args)}")
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    process = subprocess.run(
        args,
        cwd=PROJECT_DIR,
        env=merged_env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
        check=False,
    )
    output = process.stdout.strip()
    for line in output.splitlines()[-20:]:
        add_log(state, line)
    if process.returncode != 0:
        raise RuntimeError(f"command failed ({process.returncode}): {output[-2000:]}")
    return output


def compose_args(*args: str) -> list[str]:
    return ["docker", "compose", "-p", COMPOSE_PROJECT, *args]


def image_registry_mirrors(value: str | None = None) -> tuple[str, ...]:
    """Configured image-registry mirrors, used as a fallback when the primary
    registry (ghcr.io by default) is unreachable on a flaky network."""
    configured = os.getenv("FLOWMIND_IMAGE_REGISTRY_MIRRORS", "") if value is None else value
    configured = configured.strip()
    if configured.lower() in {"off", "none", "false", "0"}:
        return ()
    result: list[str] = []
    for candidate in configured.split(","):
        base = candidate.strip().rstrip("/")
        if base and base not in result:
            result.append(base)
    return tuple(result)


def pull_image_via_mirror(state: dict[str, Any], image: str) -> bool:
    """Try to obtain ``image`` (e.g. ghcr.io/lxfight/flowmind-backend:1.2.3) from
    the configured registry mirrors. Returns True on success after re-tagging
    the image back to the primary name so compose resolves it unchanged."""
    if ":" not in image:
        image = f"{image}:{current_version()}"
    for mirror in image_registry_mirrors():
        source = f"{mirror}/{image.split('/', 1)[-1]}"
        add_log(state, f"尝试从镜像仓库 {mirror} 拉取 {source}")
        try:
            command(state, ["docker", "pull", source], timeout=1200)
            command(state, ["docker", "tag", source, image], timeout=60)
            add_log(state, f"已通过镜像仓库 {mirror} 获取 {image}")
            return True
        except (RuntimeError, subprocess.TimeoutExpired) as exc:
            add_log(state, f"镜像仓库 {mirror} 拉取失败: {str(exc)[-300:]}")
    return False


def pull_images_with_retry(state: dict[str, Any], services: tuple[str, ...]) -> None:
    """Pull the target images, retrying a few times on transient network
    failures so a slow or flaky registry connection doesn't abort the whole
    update. Docker pull resumes partial layers, so a retry is cheap. If the
    primary registry stays unreachable, configured image-registry mirrors are
    tried and the result re-tagged to the primary name."""
    attempts = int(os.getenv("FLOWMIND_PULL_RETRIES", "3"))
    attempts = max(1, min(attempts, 6))
    base_delay = float(os.getenv("FLOWMIND_PULL_RETRY_DELAY", "3"))
    last_error = ""
    for attempt in range(1, attempts + 1):
        if attempt > 1:
            add_log(state, f"镜像拉取第 {attempt}/{attempts} 次尝试")
        try:
            command(state, compose_args("pull", *services), timeout=1200)
            return
        except (RuntimeError, subprocess.TimeoutExpired) as exc:
            last_error = str(exc)[-500:]
            if attempt < attempts:
                add_log(state, f"镜像拉取失败，{base_delay}s 后重试")
                time.sleep(base_delay * attempt)
    # Primary registry exhausted — fall back to configured mirrors per service.
    if image_registry_mirrors():
        add_log(state, "主镜像仓库拉取失败，改用镜像仓库尝试")
        missing: list[str] = []
        for service in services:
            image = configured_service_image(state, service)
            if not pull_image_via_mirror(state, image):
                missing.append(image)
        if not missing:
            return
        last_error = f"镜像仓库未能提供: {', '.join(missing)}"
    raise RuntimeError(f"镜像拉取多次失败: {last_error}")


def configured_application_services(state: dict[str, Any]) -> tuple[str, ...]:
    configured = set(
        command(state, compose_args("config", "--services"), timeout=60).splitlines()
    )
    required = {"backend", "frontend"}
    missing = sorted(required - configured)
    if missing:
        raise RuntimeError(f"compose config missing required services: {', '.join(missing)}")
    return tuple(
        service
        for service in ("backend", "frontend", "notifier", "updater")
        if service in configured
    )


def configured_service_image(state: dict[str, Any], service: str) -> str:
    output = command(
        state,
        compose_args("config", "--format", "json"),
        timeout=60,
    )
    try:
        image = json.loads(output)["services"][service]["image"]
    except (KeyError, TypeError, ValueError) as exc:
        raise RuntimeError(f"compose config missing image for service: {service}") from exc
    if not isinstance(image, str) or not image.strip():
        raise RuntimeError(f"compose config missing image for service: {service}")
    return image.strip()


def git_args(*args: str) -> list[str]:
    return ["git", "-c", f"safe.directory={PROJECT_DIR}", *args]


def acquire_operation_lock():
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    lock_handle = LOCK_PATH.open("a+")
    try:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        lock_handle.close()
        raise RuntimeError("another update is already running") from exc
    return lock_handle


def release_operation_lock(lock_handle: Any) -> None:
    fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
    lock_handle.close()


def github_accelerators(value: str | None = None) -> tuple[str, ...]:
    configured = os.getenv("FLOWMIND_GITHUB_ACCELERATORS", "") if value is None else value
    configured = configured.strip()
    if configured.lower() in {"off", "none", "false", "0"}:
        return ()
    candidates = configured.split(",") if configured else DEFAULT_GITHUB_ACCELERATORS
    result: list[str] = []
    for candidate in candidates:
        base = candidate.strip().rstrip("/")
        parsed = urlparse(base)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            continue
        if base not in result:
            result.append(base)
    return tuple(result)


def git_fetch_timeout() -> int:
    try:
        configured = int(os.getenv("FLOWMIND_GIT_FETCH_TIMEOUT", "45"))
    except ValueError:
        configured = 45
    return max(15, min(configured, 300))


def git_fetch_sources() -> tuple[tuple[str, str], ...]:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", RELEASE_REPOSITORY):
        raise RuntimeError("FLOWMIND_RELEASE_REPOSITORY must be in owner/repository format")
    repository_url = f"https://github.com/{RELEASE_REPOSITORY}.git"
    accelerated = tuple(
        (urlparse(base).hostname or base, f"{base}/{repository_url}")
        for base in github_accelerators()
    )
    return (("GitHub", "origin"), *accelerated)


def fetch_tags(state: dict[str, Any]) -> None:
    errors: list[str] = []
    # A low speed threshold so a slow-but-alive connection on a flaky network
    # isn't killed as a false timeout. Values are configurable via env.
    low_speed_limit = int(os.getenv("FLOWMIND_GIT_LOW_SPEED_LIMIT", "100"))
    low_speed_time = int(os.getenv("FLOWMIND_GIT_LOW_SPEED_TIME", "30"))
    for name, source in git_fetch_sources():
        add_log(state, f"正在从 {name} 获取 Tags")
        try:
            command(
                state,
                git_args(
                    "-c", f"http.lowSpeedLimit={low_speed_limit}",
                    "-c", f"http.lowSpeedTime={low_speed_time}",
                    "fetch", "--tags", source,
                ),
                timeout=git_fetch_timeout(),
            )
        except (RuntimeError, subprocess.TimeoutExpired) as exc:
            errors.append(f"{name}: {str(exc)[-300:]}")
            add_log(state, f"{name} 拉取失败，尝试下一个源")
            continue
        add_log(state, f"已从 {name} 获取 Tags")
        return

    raise RuntimeError("unable to fetch tags; " + "; ".join(errors))


def set_dotenv_version(version: str) -> None:
    env_path = PROJECT_DIR / ".env"
    try:
        lines = env_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        lines = []
    result: list[str] = []
    replaced = False
    for line in lines:
        if line.startswith("FLOWMIND_VERSION="):
            result.append(f"FLOWMIND_VERSION={version}")
            replaced = True
        else:
            result.append(line)
    if not replaced:
        if result and result[-1] != "":
            result.append("")
        result.append(f"FLOWMIND_VERSION={version}")
    temporary = env_path.with_suffix(".env.tmp")
    temporary.write_text("\n".join(result) + "\n", encoding="utf-8")
    temporary.replace(env_path)


def preflight(state: dict[str, Any], target: str) -> tuple[str, str]:
    if not (PROJECT_DIR / "docker-compose.yml").is_file():
        raise RuntimeError("docker-compose.yml not found in project directory")
    if shutil.disk_usage(PROJECT_DIR).free < MIN_FREE_BYTES:
        raise RuntimeError("insufficient free disk space")
    command(state, ["docker", "info"], timeout=30)
    command(state, compose_args("version"), timeout=30)
    dirty = command(
        state,
        git_args("status", "--porcelain", "--untracked-files=no"),
        timeout=30,
    )
    if dirty:
        allow_dirty = os.getenv("FLOWMIND_ALLOW_DIRTY_UPDATE", "").strip().lower() in {
            "1", "true", "yes", "on",
        }
        changed = ", ".join(line[3:] for line in dirty.splitlines()[:10])
        if allow_dirty:
            # checkout --detach would overwrite tracked changes; stash them so
            # the update can proceed and the edits survive for restoration.
            add_log(state, f"检测到已修改文件，自动暂存后继续更新: {changed}")
            command(
                state,
                git_args("stash", "push", "-m", "flowmind-update-before-checkout"),
                timeout=60,
            )
            update_state(state, dirty_stashed=True)
        else:
            raise RuntimeError(
                "working tree has tracked changes; move deployment settings to .env "
                f"or commit/revert these files before updating: {changed}"
            )
    previous_sha = command(state, git_args("rev-parse", "HEAD"), timeout=30).strip()
    target_ref = f"refs/tags/v{target}"
    fetch_tags(state)
    command(state, git_args("rev-parse", "--verify", target_ref), timeout=30)
    command(state, git_args("cat-file", "-e", f"{target_ref}^{{commit}}"), timeout=30)
    return previous_sha, current_version()


def database_size(state: dict[str, Any]) -> int:
    output = command(
        state,
        compose_args(
            "exec", "-T", "postgres", "psql", "-U", "flowmind", "-d", "flowmind",
            "-At", "-c", "SELECT pg_database_size(current_database())",
        ),
        timeout=30,
    ).strip()
    try:
        return int(output.splitlines()[-1])
    except (IndexError, ValueError) as exc:
        raise RuntimeError("unable to determine database size before backup") from exc


def backup_database(state: dict[str, Any], request_id: str) -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    required_bytes = MIN_FREE_BYTES + database_size(state)
    free_bytes = shutil.disk_usage(BACKUP_DIR).free
    if free_bytes < required_bytes:
        raise RuntimeError(
            "insufficient backup volume space: "
            f"need at least {required_bytes} bytes, have {free_bytes} bytes"
        )
    backup_path = BACKUP_DIR / f"flowmind-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{request_id[:8]}.sql"
    add_log(state, f"数据库备份: {backup_path}")
    with backup_path.open("wb") as output:
        process = subprocess.run(
            compose_args(
                "exec", "-T", "postgres", "pg_dump", "-U", "flowmind", "-d", "flowmind"
            ),
            cwd=PROJECT_DIR,
            stdout=output,
            stderr=subprocess.PIPE,
            timeout=300,
            check=False,
        )
    if process.returncode != 0:
        backup_path.unlink(missing_ok=True)
        raise RuntimeError(f"database backup failed: {process.stderr.decode(errors='replace')[-2000:]}")
    if backup_path.stat().st_size == 0:
        backup_path.unlink(missing_ok=True)
        raise RuntimeError("database backup is empty")
    return backup_path


def wait_for_url(
    state: dict[str, Any],
    url: str,
    name: str,
    timeout: int = 120,
    expected_version: str | None = None,
) -> None:
    deadline = time.monotonic() + timeout
    last_error = ""
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                if 200 <= response.status < 300:
                    if expected_version is not None:
                        payload = json.loads(response.read(65536))
                        actual_version = str(payload.get("version") or "")
                        if actual_version != expected_version:
                            last_error = (
                                f"expected version {expected_version}, got "
                                f"{actual_version or 'unknown'}"
                            )
                            time.sleep(2)
                            continue
                    add_log(state, f"{name} 健康检查通过")
                    return
        except Exception as exc:
            last_error = str(exc)
        time.sleep(2)
    raise RuntimeError(f"{name} health check failed: {last_error}")


def checkout_and_deploy(state: dict[str, Any], target: str) -> None:
    command(state, git_args("checkout", "--detach", f"refs/tags/v{target}"), timeout=120)
    set_dotenv_version(target)
    command(state, compose_args("config", "--quiet"), timeout=60)
    services = configured_application_services(state)
    runtime_services = tuple(service for service in services if service != "updater")
    update_state(
        state,
        status="downloading",
        step="pulling_images",
        progress=45,
        message="正在拉取版本镜像",
    )
    pull_images_with_retry(state, services)
    update_state(
        state,
        status="deploying",
        step="recreating_services",
        progress=70,
        message="正在重建应用服务并执行数据库迁移",
    )
    command(
        state,
        compose_args(
            "up",
            "-d",
            "--no-build",
            "--no-deps",
            "--remove-orphans",
            "--wait",
            "--wait-timeout",
            "180",
            *runtime_services,
        ),
        timeout=600,
    )
    update_state(
        state,
        status="verifying",
        step="health_check",
        progress=88,
        message="正在验证更新后的服务",
    )
    wait_for_url(state, BACKEND_HEALTH_URL, "backend", expected_version=target)
    wait_for_url(state, FRONTEND_HEALTH_URL, "frontend")
    if "notifier" in runtime_services:
        add_log(state, "notifier 健康检查通过")


def rollback_deployment(
    state: dict[str, Any], previous_sha: str, previous_version: str
) -> None:
    update_state(
        state,
        status="rolling_back",
        step="rolling_back",
        progress=92,
        message="更新失败，正在恢复上一版本镜像",
    )
    command(state, git_args("checkout", "--detach", previous_sha), timeout=120)
    set_dotenv_version(previous_version)
    services = configured_application_services(state)
    runtime_services = tuple(service for service in services if service != "updater")
    command(
        state,
        compose_args(
            "up",
            "-d",
            "--no-build",
            "--no-deps",
            "--remove-orphans",
            "--wait",
            "--wait-timeout",
            "180",
            *runtime_services,
        ),
        timeout=600,
    )
    wait_for_url(
        state,
        BACKEND_HEALTH_URL,
        "rollback backend",
        timeout=90,
        expected_version=previous_version,
    )
    wait_for_url(state, FRONTEND_HEALTH_URL, "rollback frontend", timeout=90)
    if "notifier" in runtime_services:
        add_log(state, "rollback notifier 健康检查通过")


def restore_stashed_changes(state: dict[str, Any]) -> None:
    """Pop the stash made by preflight (FLOWMIND_ALLOW_DIRTY_UPDATE) back onto
    the working tree after the checkout. Conflicts leave the stash intact and
    are reported so nothing is silently lost."""
    if not state.get("dirty_stashed"):
        return
    try:
        command(state, git_args("stash", "pop"), timeout=60)
        add_log(state, "已恢复更新前暂存的本地修改")
        state["dirty_stashed"] = False
    except RuntimeError as exc:
        add_log(state, f"暂存修改恢复时冲突，已保留在 stash: {str(exc)[-500:]}")


def schedule_updater_recreate(state: dict[str, Any]) -> None:
    helper_name = f"flowmind-updater-reloader-{str(state['request_id'])[:8]}"
    project = str(PROJECT_DIR)
    helper_image = configured_service_image(state, "updater")
    script = (
        "sleep 5; "
        f"cd {shlex.quote(project)}; "
        f"docker compose -p {shlex.quote(COMPOSE_PROJECT)} up -d --no-build --no-deps updater"
    )
    command(
        state,
        [
            "docker", "run", "-d", "--rm", "--name", helper_name,
            "-v", "/var/run/docker.sock:/var/run/docker.sock",
            "-v", f"{project}:{project}", "-w", project,
            helper_image, "sh", "-c", script,
        ],
        timeout=60,
    )


def run_operation(
    operation: str,
    target: str,
    request_id: str,
    lock_handle: Any | None = None,
) -> None:
    target = normalize_version(target)
    if lock_handle is None:
        try:
            lock_handle = acquire_operation_lock()
        except RuntimeError:
            return

    previous_sha = ""
    previous_version = current_version()
    state = {
        **initial_state(),
        "status": "preparing",
        "operation": operation,
        "request_id": request_id,
        "previous_version": previous_version,
        "target_version": target,
        "step": "preflight",
        "progress": 5,
        "message": "正在执行更新前检查",
        "started_at": utc_now(),
        "logs": [],
    }
    save_state(state)
    deployment_started = False
    try:
        previous_sha, previous_version = preflight(state, target)
        update_state(
            state,
            previous_sha=previous_sha,
            previous_version=previous_version,
        )
        update_state(
            state,
            status="backing_up",
            step="database_backup",
            progress=25,
            message="正在备份 PostgreSQL 数据库",
        )
        backup_path = backup_database(state, request_id)
        update_state(
            state,
            backup_path=str(backup_path),
            deployment_started=True,
        )
        deployment_started = True
        checkout_and_deploy(state, target)
        atomic_json(
            DEPLOYMENT_PATH,
            {
                "version": target,
                "previous_version": previous_version,
                "git_sha": command(state, git_args("rev-parse", "HEAD"), timeout=30).strip(),
                "deployed_at": utc_now(),
                "backup_path": str(backup_path),
            },
        )
        update_state(
            state,
            status="succeeded" if operation == "update" else "rolled_back",
            step="complete",
            progress=100,
            message="更新完成" if operation == "update" else "回滚完成",
            error=None,
            rollback_available=True,
            deployment_started=False,
            finished_at=utc_now(),
        )
        try:
            schedule_updater_recreate(state)
        except Exception as exc:
            add_log(state, f"updater 延迟重建未启动: {exc}")
        restore_stashed_changes(state)
    except Exception as exc:
        error = str(exc)[:4000]
        add_log(state, error)
        rolled_back = False
        if deployment_started and previous_sha:
            try:
                rollback_deployment(state, previous_sha, previous_version)
                rolled_back = True
            except Exception as rollback_exc:
                error = f"{error}; rollback failed: {rollback_exc}"[:4000]
                add_log(state, str(rollback_exc))
        restore_stashed_changes(state)
        update_state(
            state,
            status="rolled_back" if rolled_back else "failed",
            step="complete",
            progress=100,
            message="更新失败，已恢复上一版本" if rolled_back else "更新失败",
            error=error,
            deployment_started=False if rolled_back else deployment_started,
            finished_at=utc_now(),
        )
    finally:
        release_operation_lock(lock_handle)


def start_operation(operation: str, target: str, request_id: str) -> dict[str, Any]:
    target = normalize_version(target)
    with operation_lock:
        current = load_state()
        if current.get("request_id") == request_id:
            if current.get("operation") != operation or current.get("target_version") != target:
                raise RuntimeError("request id is already used by another operation")
            return current
        if current.get("status") in ACTIVE:
            raise RuntimeError("another update is already running")
        lock_handle = acquire_operation_lock()
        handed_off = False
        try:
            current = load_state()
            if current.get("request_id") == request_id:
                if current.get("operation") != operation or current.get("target_version") != target:
                    raise RuntimeError("request id is already used by another operation")
                return current
            if current.get("status") in ACTIVE:
                raise RuntimeError("another update is already running")
            queued = {
                **initial_state(),
                "status": "queued",
                "operation": operation,
                "request_id": request_id,
                "previous_version": current_version(),
                "target_version": target,
                "step": "queued",
                "message": "更新任务已进入队列",
                "started_at": utc_now(),
            }
            save_state(queued)
            thread = threading.Thread(
                target=run_operation,
                args=(operation, target, request_id, lock_handle),
                daemon=True,
            )
            thread.start()
            handed_off = True
        finally:
            if not handed_off:
                release_operation_lock(lock_handle)
    return queued


def recover_interrupted_operation(state: dict[str, Any]) -> None:
    interruption = "update process was interrupted by updater restart"
    add_log(state, interruption)
    previous_sha = str(state.get("previous_sha") or "")
    previous_version = str(state.get("previous_version") or "")
    if state.get("deployment_started") and previous_sha and previous_version:
        try:
            rollback_deployment(state, previous_sha, previous_version)
        except Exception as exc:
            error = f"{interruption}; automatic recovery failed: {exc}"[:4000]
            add_log(state, str(exc))
            update_state(
                state,
                status="failed",
                step="interrupted",
                progress=100,
                message="updater 重启，自动恢复上一版本失败",
                error=error,
                finished_at=utc_now(),
            )
            return
        update_state(
            state,
            status="rolled_back",
            step="interrupted",
            progress=100,
            message="updater 重启，已自动恢复上一版本",
            error=interruption,
            deployment_started=False,
            finished_at=utc_now(),
        )
        return
    update_state(
        state,
        status="failed",
        step="interrupted",
        progress=100,
        message="updater 重启导致任务中断，部署尚未开始",
        error=interruption,
        finished_at=utc_now(),
    )


def valid_signature(method: str, path: str, body: bytes, headers: Any) -> bool:
    if not TOKEN:
        return False
    timestamp = headers.get("X-FlowMind-Timestamp", "")
    signature = headers.get("X-FlowMind-Signature", "")
    try:
        if abs(time.time() - int(timestamp)) > 300:
            return False
    except ValueError:
        return False
    signed = b"\n".join([timestamp.encode(), method.encode(), path.encode(), body])
    expected = hmac.new(TOKEN.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)


class Handler(BaseHTTPRequestHandler):
    server_version = "FlowMindUpdater/1"

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} {format % args}", flush=True)

    def respond(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self) -> bytes:
        length = int(self.headers.get("Content-Length", "0") or 0)
        return self.rfile.read(length) if length else b""

    def do_GET(self) -> None:
        body = self.body()
        if self.path == "/health":
            self.respond(200, {"status": "ok", "version": APP_VERSION})
            return
        if self.path != "/status":
            self.respond(404, {"detail": "not found"})
            return
        if not valid_signature("GET", self.path, body, self.headers):
            self.respond(401, {"detail": "invalid signature"})
            return
        self.respond(200, load_state())

    def do_POST(self) -> None:
        body = self.body()
        if self.path not in {"/apply", "/rollback"}:
            self.respond(404, {"detail": "not found"})
            return
        if not valid_signature("POST", self.path, body, self.headers):
            self.respond(401, {"detail": "invalid signature"})
            return
        try:
            payload = json.loads(body or b"{}")
            request_id = str(payload["request_id"])
            if not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", request_id):
                raise ValueError("invalid request id")
            operation = "update" if self.path == "/apply" else "rollback"
            state = start_operation(operation, str(payload["version"]), request_id)
            self.respond(202, state)
        except (KeyError, TypeError, ValueError) as exc:
            self.respond(422, {"detail": str(exc)})
        except RuntimeError as exc:
            self.respond(409, {"detail": str(exc)})


def main() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    if STATE_PATH.exists():
        state = load_state()
        if state.get("status") in ACTIVE:
            recover_interrupted_operation(state)
    else:
        save_state(initial_state())
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"FlowMind updater listening on :{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
