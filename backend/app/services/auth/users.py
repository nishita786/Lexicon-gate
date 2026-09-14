"""JSON user directory under the data dir."""

from __future__ import annotations

import json
import re
import threading
import uuid
from pathlib import Path
from typing import Any

from ...config import Settings
from .passwords import hash_password, verify_password

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_lock = threading.Lock()


def normalise_email(email: str) -> str:
    return (email or "").strip().lower()


def valid_email(email: str) -> bool:
    return bool(_EMAIL_RE.match(normalise_email(email)))


def users_path(settings: Settings) -> Path:
    path = Path(settings.data_dir) / "auth" / "users.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _load(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(payload, list):
        return payload
    return payload.get("users", []) if isinstance(payload, dict) else []


def _save(path: Path, users: list[dict[str, Any]]) -> None:
    path.write_text(json.dumps({"users": users}, indent=2), encoding="utf-8")


def find_by_email(settings: Settings, email: str) -> dict[str, Any] | None:
    wanted = normalise_email(email)
    with _lock:
        for user in _load(users_path(settings)):
            if normalise_email(str(user.get("email", ""))) == wanted:
                return user
    return None


def create_user(settings: Settings, email: str, password: str, name: str = "") -> dict[str, Any]:
    record = {
        "user_id": uuid.uuid4().hex,
        "email": normalise_email(email),
        "name": (name or "").strip()[:80],
        "password_hash": hash_password(password),
    }
    path = users_path(settings)
    with _lock:
        users = _load(path)
        if any(normalise_email(str(u.get("email", ""))) == record["email"] for u in users):
            raise ValueError("email_taken")
        users.append(record)
        _save(path, users)
    return record


def authenticate(settings: Settings, email: str, password: str) -> dict[str, Any] | None:
    user = find_by_email(settings, email)
    if user is None:
        return None
    if not verify_password(password, str(user.get("password_hash", ""))):
        return None
    return user


def public_user(user: dict[str, Any]) -> dict[str, str]:
    return {
        "user_id": str(user.get("user_id", "")),
        "email": str(user.get("email", "")),
        "name": str(user.get("name", "")),
    }
