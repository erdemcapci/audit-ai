import type { PlanningState } from "../../types";
import { PlanningReadinessPanel } from "./PlanningReadinessPanel";
import { usePlanningReadiness } from "./usePlanningReadiness";

export function PlanningReadinessScreen({ projectId, planning, artifactLabels, onOpenArtifact, agentExecutionEnabled, agentExecutionMessage }: {
  projectId: string;
  planning: PlanningState;
  artifactLabels: Record<string, string>;
  onOpenArtifact: (nodeId: string) => void;
  agentExecutionEnabled: boolean;
  agentExecutionMessage: string;
}) {
  const review = usePlanningReadiness(projectId, planning);
  return <section className="screen-panel"><PlanningReadinessPanel {...review}
    artifactLabels={artifactLabels} onOpenArtifact={onOpenArtifact}
    agentExecutionEnabled={agentExecutionEnabled} agentExecutionMessage={agentExecutionMessage} />
  </section>;
}
