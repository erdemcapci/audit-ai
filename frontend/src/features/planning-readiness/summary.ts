import type { PlanningReadinessResponse, PlanningReadinessSeverity } from "./types";

export type ReadinessIssue = {
  id: string;
  title: string;
  category: string;
  severity: PlanningReadinessSeverity;
  explanation: string;
  action: string;
  artifactIds: string[];
  artifactNames: string[];
  branch: string;
  sources: string[];
};

const rank: Record<PlanningReadinessSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

export function summarizeReadiness(readiness: PlanningReadinessResponse) {
  const currentAi = readiness.overall_status === "current" && readiness.overall_score !== null && readiness.ai_review && !readiness.ai_review.stale;
  const issues: ReadinessIssue[] = readiness.deterministic.findings.map((finding) => ({
    id: finding.id, title: finding.check_name, category: finding.category,
    severity: finding.severity, explanation: finding.explanation, action: finding.recommended_action,
    artifactIds: finding.affected_artifact_ids.length ? finding.affected_artifact_ids : finding.navigation?.node_id ? [finding.navigation.node_id] : [],
    artifactNames: finding.affected_artifact_names, branch: finding.branch, sources: ["Plan checks"]
  }));
  if (currentAi) {
    const review = readiness.ai_review!;
    for (const group of [review.critical_gaps, review.warnings, review.duplication_findings, review.contradiction_findings, review.missing_coverage_findings, review.improvement_opportunities, review.prioritized_recommendations]) {
      for (const finding of group) {
        // A Critical recommendation is at least high priority, even if the model
        // supplied a lower severity. No per-artifact score is introduced.
        const severity = finding.priority === "Critical" && rank[finding.severity] > rank.high ? "high" : finding.severity;
        issues.push({ id: `ai-${finding.id}`, title: finding.concise_issue?.trim() || finding.category, category: finding.category, severity,
          explanation: finding.explanation, action: finding.suggested_action,
          artifactIds: finding.affected_artifact_ids, artifactNames: finding.affected_artifact_names,
          branch: finding.affected_workstreams.join(" / "), sources: ["AI review"] });
      }
    }
  }
  const unique = new Map<string, ReadinessIssue>();
  for (const issue of issues) {
    // Exact normalized content + affected scope only. Different issues on the
    // same card, or identical issues on different cards, remain distinct.
    const scope = issue.artifactIds.length ? [...new Set(issue.artifactIds)].sort() : issue.artifactNames.map(normalize).sort();
    const key = JSON.stringify([normalize(issue.explanation) || normalize(issue.title), scope]);
    const previous = unique.get(key);
    if (previous) {
      if (rank[issue.severity] < rank[previous.severity]) previous.severity = issue.severity;
      previous.sources = [...new Set([...previous.sources, ...issue.sources])];
      if (!previous.action) previous.action = issue.action;
    } else {
      unique.set(key, { ...issue });
    }
  }
  const findings = [...unique.values()].sort((a, b) => rank[a.severity] - rank[b.severity]);
  const score = currentAi ? readiness.overall_score! : readiness.deterministic.score;
  const important = findings.filter((finding) => rank[finding.severity] <= rank.high).length;
  const status = score < 55 || findings.some((finding) => finding.severity === "critical") ? "Not ready"
    : score < 75 || important > 0 ? "Needs attention"
    : score < 90 || findings.length > 0 ? "Ready with improvements" : "Ready";
  const summary = important > 0
    ? `${important} important issue${important === 1 ? "" : "s"} should be addressed before fieldwork.`
    : status === "Not ready" || status === "Needs attention"
      ? "The assessment needs attention. Review the readiness dimensions and recommendations before fieldwork."
      : findings.length > 0
        ? `${findings.length} improvement${findings.length === 1 ? "" : "s"} identified. No high-priority issues reported.`
        : currentAi ? "No readiness issues identified by the current plan checks and AI review."
          : "No issues identified by plan checks. Complete the AI review to assess overall readiness.";
  return { score, status, summary, important, findings, biggestConcern: findings[0], preliminary: !currentAi };
}
