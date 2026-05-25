from fastapi import APIRouter, Body, Request

from app.models import AuditMap, AutoLayoutRequest, BulkDeleteRequest, MapState, MapStateUpdate, NodeUpdateRequest
from app.showcase.project_access import require_project_read, require_project_write
from app.services.audit_map_service import audit_map_service
from app.services.agent_service import agent_service
from app.store.project_store import project_store


router = APIRouter(prefix="/api/projects/{project_id}/audit-map", tags=["audit-map"])


@router.get("", response_model=AuditMap)
def get_audit_map(project_id: str, request: Request) -> AuditMap:
    require_project_read(request, project_id)
    return audit_map_service.build(project_id)


@router.put("", response_model=MapState)
def update_audit_map(project_id: str, update: MapStateUpdate, request: Request) -> MapState:
    require_project_write(request, project_id)
    state = project_store.load_map_state(project_id)
    if update.phaseLayouts is not None:
        state.phaseLayouts = update.phaseLayouts
    if update.nodePositions is not None:
        state.nodePositions = update.nodePositions
    if update.nodeDimensions is not None:
        state.nodeDimensions = update.nodeDimensions
    if update.edges is not None:
        state.edges = update.edges
    if update.agents is not None:
        state.agents = update.agents
    return project_store.save_map_state(project_id, state)


@router.post("/auto-layout", response_model=AuditMap)
def auto_layout(project_id: str, http_request: Request, request: AutoLayoutRequest = Body(default_factory=AutoLayoutRequest)) -> AuditMap:
    require_project_write(http_request, project_id)
    return audit_map_service.auto_layout(project_id, request)


@router.post("/bulk-delete", response_model=AuditMap)
def bulk_delete(project_id: str, request: BulkDeleteRequest, http_request: Request) -> AuditMap:
    require_project_write(http_request, project_id)
    agent_service.delete_dimension(project_id, request.phase, request.dimension)
    return audit_map_service.build(project_id)


@router.put("/nodes/{node_id}", response_model=AuditMap)
def update_node(project_id: str, node_id: str, request: NodeUpdateRequest, http_request: Request) -> AuditMap:
    require_project_write(http_request, project_id)
    agent_service.update_node(project_id, node_id, request)
    return audit_map_service.build(project_id)


@router.delete("/nodes/{node_id}", response_model=AuditMap)
def delete_node(project_id: str, node_id: str, request: Request) -> AuditMap:
    require_project_write(request, project_id)
    agent_service.delete_node(project_id, node_id)
    return audit_map_service.build(project_id)


@router.delete("/nodes/{node_id}/outputs", response_model=AuditMap)
def delete_node_outputs(project_id: str, node_id: str, request: Request) -> AuditMap:
    require_project_write(request, project_id)
    agent_service.delete_outputs(project_id, node_id)
    return audit_map_service.build(project_id)
