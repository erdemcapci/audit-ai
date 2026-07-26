from fastapi import APIRouter, Request

from app.models import AgentRunLog, MessageResponse
from app.runtime import ensure_agent_log_access
from app.services.agent_run_log_service import agent_run_log_service


project_router = APIRouter(prefix="/api/projects/{project_id}/agent-runs", tags=["agent-runs"])
admin_router = APIRouter(prefix="/api/admin/agent-runs", tags=["agent-runs"])


@project_router.get("", response_model=list[AgentRunLog])
def list_agent_runs(request: Request, project_id: str) -> list[AgentRunLog]:
    ensure_agent_log_access(request)
    return agent_run_log_service.list_runs(project_id)


@project_router.get("/{run_id}", response_model=AgentRunLog)
def get_agent_run(request: Request, project_id: str, run_id: str) -> AgentRunLog:
    ensure_agent_log_access(request)
    return agent_run_log_service.get_run(project_id, run_id)


@project_router.delete("/{run_id}", response_model=MessageResponse)
def delete_agent_run(request: Request, project_id: str, run_id: str) -> MessageResponse:
    ensure_agent_log_access(request)
    agent_run_log_service.delete_run(project_id, run_id)
    return MessageResponse(message="Agent run log deleted")


@admin_router.get("", response_model=list[AgentRunLog])
def list_all_agent_runs(request: Request) -> list[AgentRunLog]:
    ensure_agent_log_access(request)
    return agent_run_log_service.list_all_runs()
