"""AuditCopilot FastAPI entrypoint.

Copyright (C) 2026 Erdem Capci

This file is part of AuditCopilot and is licensed under AGPLv3-or-later.
"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import admin, agent_runs, agents, audit_map, fieldwork, findings, interviews, planning, projects, reports, settings as settings_api
from app.config import settings


app = FastAPI(title="Audit AI Copilot", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(FileNotFoundError)
async def not_found_handler(_: Request, exc: FileNotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(ValueError)
async def value_error_handler(_: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(projects.router)
app.include_router(planning.router)
app.include_router(interviews.router)
app.include_router(fieldwork.router)
app.include_router(findings.router)
app.include_router(reports.router)
app.include_router(settings_api.router)
app.include_router(settings_api.runtime_router)
app.include_router(audit_map.router)
app.include_router(agents.types_router)
app.include_router(agents.project_router)
app.include_router(agent_runs.project_router)
app.include_router(agent_runs.admin_router)
app.include_router(admin.router)
