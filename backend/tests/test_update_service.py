import pytest

from app.services.update_service import normalize_version, version_is_newer


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
