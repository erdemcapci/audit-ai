from __future__ import annotations

import hashlib
import hmac
import os
from pathlib import Path

from app.config import settings
from app.models import UserRecord, utc_now
from app.store.file_store import FileStore


PBKDF2_ITERATIONS = 210_000


def normalize_email(email: str) -> str:
    return email.strip().lower()


def password_hash(password: str, salt: bytes | None = None) -> str:
    actual_salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), actual_salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${actual_salt.hex()}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations, salt_hex, digest_hex = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = bytes.fromhex(salt_hex)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations)).hex()
        return hmac.compare_digest(digest, digest_hex)
    except Exception:
        return False


class UserStore:
    def __init__(self):
        self.file_store = FileStore(settings.projects_dir)
        self.path = Path(settings.projects_dir) / "users.json"

    def _read(self) -> list[UserRecord]:
        payload = self.file_store.read_json(self.path, []) if self.path.exists() else []
        return [UserRecord.model_validate(item) for item in payload]

    def _write(self, users: list[UserRecord]) -> None:
        self.file_store.write_json(self.path, [user.model_dump() for user in users])

    def list_users(self) -> list[UserRecord]:
        return sorted(self._read(), key=lambda user: user.created_at, reverse=True)

    def get_by_email(self, email: str) -> UserRecord | None:
        normalized = normalize_email(email)
        return next((user for user in self._read() if user.email == normalized), None)

    def create_user(self, email: str, password: str) -> UserRecord:
        normalized = normalize_email(email)
        users = self._read()
        if any(user.email == normalized for user in users):
            raise ValueError("A user with this email already exists.")
        user = UserRecord(email=normalized, password_hash=password_hash(password))
        users.append(user)
        self._write(users)
        return user

    def update_access(self, user_id: str, can_run_agents: bool) -> UserRecord:
        users = self._read()
        for user in users:
            if user.id == user_id:
                user.can_run_agents = can_run_agents
                user.updated_at = utc_now()
                self._write(users)
                return user
        raise FileNotFoundError("User not found.")


user_store = UserStore()
