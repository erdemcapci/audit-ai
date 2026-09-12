import type { ArtifactPresentations } from "./presentation";
import type { PlanningState } from "../../types";
import { PlanningReadinessPanel } from "./PlanningReadinessPanel";
import { usePlanningReadiness } from "./usePlanningReadiness";

export function PlanningReadinessScreen({ projectId, planning, artifactLabels, artifacts, onOpenArtifacts, onOpenArtifact, agentExecutionEnabled, agentExecutionMessage }: {
  projectId: string;
  planning: PlanningState;
  artifacts?: ArtifactPresentations;
  onOpenArtifacts?: (nodeIds: string[]) => void;
  artifactLabels: Record<string, string>;
  onOpenArtifact: (nodeId: string) => void;
  agentExecutionEnabled: boolean;
  agentExecutionMessage: string;
}) {
  const review = usePlanningReadiness(projectId, planning);
  return <section className="screen-panel"><PlanningReadinessPanel {...review}
    artifactLabels={artifactLabels} artifacts={artifacts} onOpenArtifacts={onOpenArtifacts} onOpenArtifact={onOpenArtifact}
    agentExecutionEnabled={agentExecutionEnabled} agentExecutionMessage={agentExecutionMessage} />
  </section>;
}
