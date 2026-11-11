export type WorkspaceScreen = "Map" | "Readiness" | "Audit Plan" | "Data Quality" | "Settings" | "Agent Logs";

export type NavItem = {
  label: string;
  /** Screen opened when the item is clicked. */
  screen: WorkspaceScreen;
  /** Every screen that should highlight this item (defaults to `screen`). */
  screens?: WorkspaceScreen[];
};

export type NavSection = { label: string; items: NavItem[] };

/** Left-pane structure, grouped by audit phase. Add Fieldwork / Reporting sections here as pages are built. */
export const WORKSPACE_NAV: NavSection[] = [
  { label: "Planning", items: [{ label: "Audit Planning", screen: "Map", screens: ["Map", "Readiness"] }] },
  { label: "Data Analysis", items: [{ label: "Data Quality Tests", screen: "Data Quality" }] },
  { label: "Project", items: [{ label: "Settings", screen: "Settings" }, { label: "Agent Logs", screen: "Agent Logs" }] }
];

/** Pages that share the Map / Readiness tab strip. */
export const PLANNING_SCREENS: WorkspaceScreen[] = ["Map", "Readiness"];
