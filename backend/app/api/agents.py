from fastapi import APIRouter

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
from app.services.agent_service import agent_service


types_router = APIRouter(prefix="/api/agents", tags=["agents"])
project_router = APIRouter(prefix="/api/projects/{project_id}/agents", tags=["project-agents"])


@types_router.get("/types", response_model=list[AgentDefinition])
def list_agent_types() -> list[AgentDefinition]:
    return agent_service.list_types()


@project_router.post("", response_model=AgentState)
def create_agent(project_id: str, request: AgentCreateRequest) -> AgentState:
    return agent_service.create(project_id, request)


@project_router.put("/{agent_id}", response_model=AgentState)
def update_agent(project_id: str, agent_id: str, request: AgentUpdateRequest) -> AgentState:
    return agent_service.update(project_id, agent_id, request)


@project_router.post("/{agent_id}/output-check", response_model=AgentOutputCheckResponse)
def check_agent_outputs(project_id: str, agent_id: str, request: AgentRunRequest) -> AgentOutputCheckResponse:
    return agent_service.check_outputs(project_id, agent_id, request)


@project_router.post("/{agent_id}/run", response_model=AgentRunResponse)
async def run_agent(project_id: str, agent_id: str, request: AgentRunRequest) -> AgentRunResponse:
    return await agent_service.run(project_id, agent_id, request)


@project_router.delete("/{agent_id}", response_model=MessageResponse)
def delete_agent(project_id: str, agent_id: str) -> MessageResponse:
    agent_service.delete(project_id, agent_id)
    return MessageResponse(message="Agent deleted")
