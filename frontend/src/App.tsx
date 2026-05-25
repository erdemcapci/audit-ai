/*
 * Copyright (C) 2026 Erdem Capci
 *
 * This file is part of AuditCopilot and is licensed under AGPLv3-or-later.
 */

import { useEffect, useState } from "react";
import { authApi, type UserMe } from "./api/authApi";
import { projectsApi } from "./api/projectsApi";
import { settingsApi, type RuntimeSettings } from "./api/settingsApi";
import { AdminScreen } from "./screens/AdminScreen";
import { AuthScreen } from "./screens/AuthScreen";
import { AuditWorkspace } from "./screens/AuditWorkspace";
import { StartScreen } from "./screens/StartScreen";
import { CookieNotice } from "./showcase/CookieNotice";
import { LegalPage } from "./showcase/LegalPage";

const CURRENT_PROJECT_KEY = "audit-ai-current-project";

function App() {
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem(CURRENT_PROJECT_KEY));
  const [runtime, setRuntime] = useState<RuntimeSettings | null>(null);
  const [user, setUser] = useState<UserMe | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [path, setPath] = useState(window.location.pathname);
  const isAdminRoute = path.startsWith("/admin");
  const isAuthRoute = path.startsWith("/auth");
  const legalPage = path === "/impressum" || path === "/privacy" || path === "/terms" ? path.slice(1) : null;

  async function refreshRuntime() {
    const next = await settingsApi.runtime();
    setRuntime(next);
    return next;
  }

  useEffect(() => {
    refreshRuntime().catch(() => setRuntime(null));
  }, []);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    authApi.me()
      .then((next) => {
        setUser(next);
        setRuntime(next.runtime);
      })
      .catch(() => setUser(null))
      .finally(() => setAuthLoaded(true));
  }, []);

  useEffect(() => {
    if (!user?.isAuthenticated || runtime?.deploymentMode !== "hosted") return;
    const interval = window.setInterval(() => {
      authApi.me()
        .then((next) => {
          setUser(next);
          setRuntime(next.runtime);
        })
        .catch(() => undefined);
    }, 10000);
    return () => window.clearInterval(interval);
  }, [runtime?.deploymentMode, user?.isAuthenticated]);

  useEffect(() => {
    if (projectId) {
      localStorage.setItem(CURRENT_PROJECT_KEY, projectId);
    } else {
      localStorage.removeItem(CURRENT_PROJECT_KEY);
    }
  }, [projectId]);

  async function startAudit(payload: {
    title: string;
    description: string;
    process_area: string;
    initial_concern: string;
    extra_context: string;
    accepted_data_warning?: boolean;
  }) {
    const project = await projectsApi.create(payload);
    setProjectId(project.id);
  }

  function openProject(id: string) {
    window.history.pushState({}, "", "/");
    setPath("/");
    setProjectId(id);
  }

  function goTo(pathname: string) {
    window.history.pushState({}, "", pathname);
    setPath(pathname);
  }

  async function logoutUser() {
    const next = await authApi.logout();
    setUser(next);
    setRuntime(next.runtime);
    setProjectId(null);
  }

  if (isAdminRoute) {
    return <AdminScreen onOpenProject={openProject} onRuntimeChange={setRuntime} refreshRuntime={refreshRuntime} />;
  }

  if (legalPage) {
    return <LegalPage page={legalPage} onBack={() => goTo("/")} />;
  }

  if (!authLoaded) {
    return <main className="workspace"><p className="muted">Loading session...</p></main>;
  }

  if (isAuthRoute) {
    return (
      <>
        <AuthScreen
          onAuthenticated={(next) => {
            setUser(next);
            setRuntime(next.runtime);
            goTo("/");
          }}
          onCancel={() => {
            goTo("/");
          }}
        />
        <CookieNotice enabled={runtime?.deploymentMode === "hosted"} />
      </>
    );
  }

  if (!projectId) {
    return (
      <>
        <StartScreen
          onStart={startAudit}
          onOpenExisting={setProjectId}
          runtime={runtime}
          user={user}
          onLogoutUser={logoutUser}
          onSignIn={() => goTo("/auth")}
        />
        <CookieNotice enabled={runtime?.deploymentMode === "hosted"} />
      </>
    );
  }

  return (
    <>
      <AuditWorkspace
        projectId={projectId}
        onReset={() => setProjectId(null)}
        runtime={runtime}
        user={user}
        onLogoutUser={logoutUser}
        onSignIn={() => goTo("/auth")}
        onRuntimeChanged={async () => {
          await refreshRuntime();
        }}
      />
      <CookieNotice enabled={runtime?.deploymentMode === "hosted"} />
    </>
  );
}

export default App;
