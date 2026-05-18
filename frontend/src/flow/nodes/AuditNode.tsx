import { NodeShell } from "./NodeShell";
import type { FlowNodeData } from "../../types";

export function AuditNode({ id, data, selected }: { id: string; data: FlowNodeData; selected?: boolean }) {
  return <NodeShell id={id} data={data} selected={selected} variant="audit" showTarget={false} />;
}
