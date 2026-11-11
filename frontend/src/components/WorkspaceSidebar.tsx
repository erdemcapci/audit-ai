import { useState } from "react";
import { WORKSPACE_NAV, type WorkspaceScreen } from "../navigation";

const COLLAPSED_KEY = "audit-ai-sidebar-collapsed";

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
}

export function WorkspaceSidebar({ active, onNavigate }: { active: string; onNavigate: (screen: WorkspaceScreen) => void }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch { /* preference is optional */ }
  }

  return (
    <aside className={`workspace-sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="sidebar-top">
        {!collapsed ? <div className="sidebar-brand">Assurenodia</div> : null}
        <button className="sidebar-toggle" onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} title={collapsed ? "Expand navigation" : "Collapse navigation"}>
          {collapsed ? "»" : "«"}
        </button>
      </div>
      {!collapsed ? (
        <nav aria-label="Audit phases">
          {WORKSPACE_NAV.map((section) => (
            <div key={section.label} className="sidebar-section">
              <div className="sidebar-section-label">{section.label}</div>
              {section.items.map((item) => {
                const isActive = (item.screens || [item.screen]).includes(active as WorkspaceScreen);
                return (
                  <button key={item.label} className={isActive ? "active" : ""} aria-current={isActive ? "page" : undefined} onClick={() => onNavigate(item.screen)}>
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      ) : null}
    </aside>
  );
}
