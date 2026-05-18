import { NodeShell } from "./NodeShell";
import type { FlowNodeData } from "../../types";

export function InterviewQuestionNode({ id, data, selected }: { id: string; data: FlowNodeData; selected?: boolean }) {
  return <NodeShell id={id} data={data} selected={selected} variant="interview-question" />;
}
