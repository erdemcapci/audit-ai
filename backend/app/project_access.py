"""Compatibility import for hosted project access helpers."""

from app.showcase.project_access import can_read_project, can_write_project, require_project_read, require_project_write

__all__ = ["can_read_project", "can_write_project", "require_project_read", "require_project_write"]
