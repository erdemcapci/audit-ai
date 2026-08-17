import { useEffect, useState } from "react";
import { projectsApi } from "../api/projectsApi";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import type { AuditProject } from "../types";

export function OpenAuditScreen({
  onOpenExisting,
  onStartNew,
  onHome
}: {
  onOpenExisting: (projectId: string) => void;
  onStartNew: () => void;
  onHome: () => void;
}) {
  const [projects, setProjects] = useState<AuditProject[]>([]);

  useEffect(() => {
    projectsApi.list().then(setProjects).catch(() => setProjects([]));
  }, []);

  return (
    <main className="start-screen">
      <section className="simple-page">
        <div className="simple-page-header">
          <p className="eyebrow">Open workspace</p>
          <h1>Open existing audit</h1>
          <p className="hero-copy">Continue from a local audit workspace already stored on this machine.</p>
          <div className="button-row">
            <Button type="button" variant="ghost" onClick={onHome}>Home</Button>
            <Button type="button" variant="secondary" onClick={onStartNew}>Start New Audit</Button>
          </div>
        </div>
        {projects.length ? (
          <div className="recent-grid">
            {projects.map((project) => (
              <button key={project.id} className="recent-card" onClick={() => onOpenExisting(project.id)}>
                <strong>{project.title}</strong>
                <span>{project.description || "No description provided."}</span>
              </button>
            ))}
          </div>
        ) : (
          <Card className="empty-open-card">
            <h2>No local audits yet</h2>
            <p className="muted">Create a new audit workspace first, then it will appear here.</p>
            <Button type="button" onClick={onStartNew}>Start New Audit</Button>
          </Card>
        )}
      </section>
    </main>
  );
}
