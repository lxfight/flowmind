import pytest

from app.main import _initial_admin_password, _initial_admin_username


def test_initial_admin_username_defaults_to_admin(monkeypatch):
    monkeypatch.delenv("FLOWMIND_ADMIN_USERNAME", raising=False)

    assert _initial_admin_username() == "admin"


def test_initial_admin_username_accepts_custom_value(monkeypatch):
    monkeypatch.setenv("FLOWMIND_ADMIN_USERNAME", "secure-admin")

    assert _initial_admin_username() == "secure-admin"


@pytest.mark.parametrize("username", ["ab", "admin user", "管理员", "admin@local"])
def test_initial_admin_username_rejects_invalid_value(monkeypatch, username):
    monkeypatch.setenv("FLOWMIND_ADMIN_USERNAME", username)

    with pytest.raises(RuntimeError, match="FLOWMIND_ADMIN_USERNAME"):
        _initial_admin_username()


def test_initial_admin_password_generates_secret_for_empty_value(monkeypatch):
    monkeypatch.setenv("FLOWMIND_ADMIN_PASSWORD", "")

    password, generated = _initial_admin_password()

    assert generated is True
    assert len(password) >= 16


def test_initial_admin_password_accepts_strong_configured_value(monkeypatch):
    monkeypatch.setenv("FLOWMIND_ADMIN_PASSWORD", "configured-secret")

    assert _initial_admin_password() == ("configured-secret", False)


def test_initial_admin_password_rejects_short_value(monkeypatch):
    monkeypatch.setenv("FLOWMIND_ADMIN_PASSWORD", "short")

    with pytest.raises(RuntimeError, match="FLOWMIND_ADMIN_PASSWORD"):
        _initial_admin_password()
