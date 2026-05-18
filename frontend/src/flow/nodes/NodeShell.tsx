import { Handle, NodeResizer, Position } from "@xyflow/react";
import { Badge } from "../../components/Badge";
import type { FlowNodeData } from "../../types";

const toneByStatus: Record<string, "neutral" | "blue" | "amber" | "green" | "red" | "purple"> = {
  "AI Generated": "blue",
  Edited: "purple",
  Confirmed: "green",
  Draft: "neutral",
  "In Progress": "amber",
  "Issue Found": "red",
  "Ready for Report": "green"
};

export function NodeShell({
  id,
  data,
  selected,
  variant,
  showTarget = true,
  showSource = true
}: {
  id: string;
  data: FlowNodeData;
  selected?: boolean;
  variant: string;
  showTarget?: boolean;
  showSource?: boolean;
}) {
  const tone = toneByStatus[data.status] || "neutral";
  const minWidth = 560;
  const minHeight = 140;
  return (
    <div className={`audit-flow-node node-${variant} ${selected ? "selected" : ""}`}>
      <NodeResizer
        isVisible={selected}
        minWidth={minWidth}
        minHeight={minHeight}
        handleClassName="card-resize-handle"
        lineClassName="card-resize-line"
        onResizeEnd={(_, params) => data.onNodeResize?.(id, { width: params.width, height: params.height })}
      />
      {showTarget ? <Handle type="target" position={Position.Left} /> : null}
      <div className="node-topline">
        <span className="node-type">{variant.replace("-", " ")}</span>
        <Badge tone={tone}>{data.status}</Badge>
      </div>
      <h3>{data.title}</h3>
      {data.description ? <p>{data.description}</p> : null}
      <div className="node-meta">
        {data.severity ? <span>Severity: {data.severity}</span> : null}
        {data.testType ? <span>{data.testType}</span> : null}
        {data.itemStatus ? <span>{data.itemStatus}</span> : null}
        {typeof data.count === "number" ? <span>{data.count} linked</span> : null}
      </div>
      {showSource ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  );
}
