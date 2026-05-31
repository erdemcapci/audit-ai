from fastapi import APIRouter, Request

from app.models import (
    AgentCreateRequest,
    AgentDefinition,
    AgentOutputCheckResponse,
    AgentRunRequest,
    AgentRunResponse,
    AgentState,
    AgentUpdateRequest,
    MessageResponse,
)
from app.showcase.project_access import require_project_read, require_project_write
from app.runtime import agent_execution_context, record_successful_ai_run
from app.services.agent_service import agent_service


types_router = APIRouter(prefix="/api/agents", tags=["agents"])
project_router = APIRouter(prefix="/api/projects/{project_id}/agents", tags=["project-agents"])


@types_router.get("/types", response_model=list[AgentDefinition])
def list_agent_types() -> list[AgentDefinition]:
    return agent_service.list_types()


@project_router.post("", response_model=AgentState)
def create_agent(project_id: str, payload: AgentCreateRequest, request: Request) -> AgentState:
    require_project_write(request, project_id)
    return agent_service.create(project_id, payload)


@project_router.put("/{agent_id}", response_model=AgentState)
def update_agent(project_id: str, agent_id: str, payload: AgentUpdateRequest, request: Request) -> AgentState:
    require_project_write(request, project_id)
    return agent_service.update(project_id, agent_id, payload)


@project_router.post("/{agent_id}/output-check", response_model=AgentOutputCheckResponse)
def check_agent_outputs(project_id: str, agent_id: str, payload: AgentRunRequest, request: Request) -> AgentOutputCheckResponse:
    require_project_read(request, project_id)
    return agent_service.check_outputs(project_id, agent_id, payload)


@project_router.post("/{agent_id}/run", response_model=AgentRunResponse)
async def run_agent(project_id: str, agent_id: str, request: Request, payload: AgentRunRequest) -> AgentRunResponse:
    require_project_write(request, project_id)
    with agent_execution_context(request):
        result = await agent_service.run(project_id, agent_id, payload)
        record_successful_ai_run(request)
    return result


@project_router.delete("/{agent_id}", response_model=MessageResponse)
def delete_agent(project_id: str, agent_id: str, request: Request) -> MessageResponse:
    require_project_write(request, project_id)
    agent_service.delete(project_id, agent_id)
    return MessageResponse(message="Agent deleted")
