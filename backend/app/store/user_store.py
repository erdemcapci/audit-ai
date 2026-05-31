from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import string
from pathlib import Path

from app.config import settings, validate_openai_model
from app.models import UserRecord, utc_now
from app.store.file_store import FileStore


PBKDF2_ITERATIONS = 210_000
ACCESS_CODE_ALPHABET = string.ascii_uppercase + string.digits


def normalize_username(username: str) -> str:
    return username.strip().lower()


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


def generate_access_code(length: int = 10) -> str:
    return "-".join(
        "".join(secrets.choice(ACCESS_CODE_ALPHABET) for _ in range(5))
        for _ in range(max(1, length // 5))
    )


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

    def get_by_username(self, username: str) -> UserRecord | None:
        normalized = normalize_username(username)
        return next((user for user in self._read() if user.email == normalized), None)

    def get_by_email(self, email: str) -> UserRecord | None:
        return self.get_by_username(email)

    def create_user(self, username: str, access_code: str | None = None) -> tuple[UserRecord, str]:
        normalized = normalize_username(username)
        users = self._read()
        if any(user.email == normalized for user in users):
            raise ValueError("This username is already taken.")
        actual_access_code = access_code or generate_access_code()
        user = UserRecord(
            email=normalized,
            password_hash=password_hash(actual_access_code),
            ai_total_run_limit=max(0, settings.ai_default_total_limit),
        )
        users.append(user)
        self._write(users)
        return user, actual_access_code

    def update_access(
        self,
        user_id: str,
        can_run_agents: bool,
        ai_total_run_limit: int | None = None,
        ai_runs_used: int | None = None,
        ai_model: str | None = None,
    ) -> UserRecord:
        users = self._read()
        for user in users:
            if user.id == user_id:
                user.can_run_agents = can_run_agents
                if ai_total_run_limit is not None:
                    user.ai_total_run_limit = max(0, ai_total_run_limit)
                    user.ai_runs_used = min(user.ai_runs_used, user.ai_total_run_limit)
                if ai_runs_used is not None:
                    user.ai_runs_used = min(max(0, ai_runs_used), user.ai_total_run_limit)
                if ai_model is not None:
                    user.ai_model = validate_openai_model(ai_model) if ai_model.strip() else None
                user.updated_at = utc_now()
                self._write(users)
                return user
        raise FileNotFoundError("User not found.")

    def record_ai_run(self, user_id: str) -> UserRecord:
        users = self._read()
        for user in users:
            if user.id == user_id:
                if not user.can_run_agents:
                    raise PermissionError("AI access is not enabled for your account yet.")
                if user.ai_runs_used >= user.ai_total_run_limit:
                    raise PermissionError("Your AI usage limit has been reached.")
                user.ai_runs_used += 1
                user.updated_at = utc_now()
                self._write(users)
                return user
        raise FileNotFoundError("User not found.")


user_store = UserStore()
