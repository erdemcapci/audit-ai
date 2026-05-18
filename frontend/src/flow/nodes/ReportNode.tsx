import { NodeShell } from "./NodeShell";
import type { FlowNodeData } from "../../types";

export function ReportNode({ id, data, selected }: { id: string; data: FlowNodeData; selected?: boolean }) {
  return <NodeShell id={id} data={data} selected={selected} variant="report" showSource={false} />;
}
