import { NodeShell } from "./NodeShell";
import type { FlowNodeData } from "../../types";

export function ObjectiveNode({ id, data, selected }: { id: string; data: FlowNodeData; selected?: boolean }) {
  return <NodeShell id={id} data={data} selected={selected} variant="objective" />;
}
