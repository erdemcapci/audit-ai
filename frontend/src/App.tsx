/*
 * Copyright (C) 2026 Erdem Capci
 *
 * This file is part of Assurenodia and is licensed under AGPLv3-or-later.
 */

import { useEffect, useState } from "react";
import { projectsApi } from "./api/projectsApi";
import { settingsApi, type RuntimeSettings } from "./api/settingsApi";
import { AdminScreen } from "./screens/AdminScreen";
import { AuditWorkspace } from "./screens/AuditWorkspace";
import { HomeScreen } from "./screens/HomeScreen";
import { OpenAuditScreen } from "./screens/OpenAuditScreen";
import { StartScreen } from "./screens/StartScreen";

const CURRENT_PROJECT_KEY = "audit-ai-current-project";

function App() {
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem(CURRENT_PROJECT_KEY));
  const [runtime, setRuntime] = useState<RuntimeSettings | null>(null);
  const [route, setRoute] = useState(() => window.location.pathname);
  const isAdminRoute = window.location.pathname.startsWith("/admin");

  function navigate(path: string) {
    window.history.pushState({}, "", path);
    setRoute(path);
  }

  async function refreshRuntime() {
    const next = await settingsApi.runtime();
    setRuntime(next);
    return next;
  }

  useEffect(() => {
    refreshRuntime().catch(() => setRuntime(null));
  }, []);

  useEffect(() => {
    const onPopState = () => setRoute(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (projectId) {
      localStorage.setItem(CURRENT_PROJECT_KEY, projectId);
    } else {
      localStorage.removeItem(CURRENT_PROJECT_KEY);
    }
  }, [projectId]);

  async function startAudit(payload: { title: string; description: string; process_area: string; initial_concern: string; extra_context: string }) {
    const project = await projectsApi.create(payload);
    window.history.pushState({}, "", "/");
    setRoute("/");
    setProjectId(project.id);
  }

  function openProject(id: string) {
    window.history.pushState({}, "", "/");
    setRoute("/");
    setProjectId(id);
  }

  if (isAdminRoute) {
    return <AdminScreen onOpenProject={openProject} onRuntimeChange={setRuntime} refreshRuntime={refreshRuntime} />;
  }

  if (!projectId) {
    if (route === "/new") {
      return <StartScreen onStart={startAudit} onOpenExisting={() => navigate("/open")} onHome={() => navigate("/")} />;
    }
    if (route === "/open") {
      return <OpenAuditScreen onOpenExisting={openProject} onStartNew={() => navigate("/new")} onHome={() => navigate("/")} />;
    }
    return <HomeScreen onStartNew={() => navigate("/new")} />;
  }

  return <AuditWorkspace projectId={projectId} onReset={() => { setProjectId(null); navigate("/"); }} runtime={runtime} onRuntimeChanged={refreshRuntime} />;
}

export default App;
