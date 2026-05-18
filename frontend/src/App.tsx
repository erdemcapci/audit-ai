/*
 * Copyright (C) 2026 Erdem Capci
 *
 * This file is part of AuditCopilot and is licensed under AGPLv3-or-later.
 */

import { useEffect, useState } from "react";
import { projectsApi } from "./api/projectsApi";
import { AuditWorkspace } from "./screens/AuditWorkspace";
import { StartScreen } from "./screens/StartScreen";

const CURRENT_PROJECT_KEY = "audit-ai-current-project";

function App() {
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem(CURRENT_PROJECT_KEY));

  useEffect(() => {
    if (projectId) {
      localStorage.setItem(CURRENT_PROJECT_KEY, projectId);
    } else {
      localStorage.removeItem(CURRENT_PROJECT_KEY);
    }
  }, [projectId]);

  async function startAudit(payload: { title: string; description: string; process_area: string; initial_concern: string; extra_context: string }) {
    const project = await projectsApi.create(payload);
    setProjectId(project.id);
  }

  if (!projectId) {
    return <StartScreen onStart={startAudit} onOpenExisting={setProjectId} />;
  }

  return <AuditWorkspace projectId={projectId} onReset={() => setProjectId(null)} />;
}

export default App;
