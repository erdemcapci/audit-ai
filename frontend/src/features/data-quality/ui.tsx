import { Badge } from "../../components/Badge";
import type { Severity, Verdict } from "./engine/types";

export const SEVERITY_LABEL: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low", clean: "Clean" };
export const SEVERITY_TONE: Record<Severity, "red" | "amber" | "blue" | "green"> = { high: "red", medium: "amber", low: "blue", clean: "green" };
export const VERDICT_TONE: Record<Verdict, "red" | "amber" | "green"> = { significant_issues: "red", issues_to_review: "amber", no_issues: "green" };

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={SEVERITY_TONE[severity]}>{SEVERITY_LABEL[severity]}</Badge>;
}

export function Kpi({ label, value, tone }: { label: string; value: string; tone?: "alert" | "ok" }) {
  return <div className={`dq-kpi${tone ? ` dq-kpi-${tone}` : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

/** Visible "still working" notice with a spinner, for steps that take a while on large files. */
export function Working({ children }: { children: string }) {
  return <div className="dq-banner dq-working" role="status" aria-live="polite"><span className="dq-spinner" aria-hidden="true" />{children}</div>;
}

export const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;

export function UploadIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 10.5v-8M4.5 6 8 2.5 11.5 6M2.5 13.5h11" />
    </svg>
  );
}

export function FileIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 1.8h5.2L12.5 5v9.2H4zM9 1.8V5.2h3.5" />
    </svg>
  );
}
