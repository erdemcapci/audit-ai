import { Handle, NodeResizer, Position } from "@xyflow/react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import type { FlowNodeData } from "../../types";

export function AgentNode({ id, data, selected }: { id: string; data: FlowNodeData; selected?: boolean }) {
  return (
    <div className={`audit-flow-node agent-node ${selected ? "selected" : ""}`}>
      <NodeResizer
        isVisible={selected}
        minWidth={560}
        minHeight={160}
        handleClassName="card-resize-handle"
        lineClassName="card-resize-line"
        onResizeEnd={(_, params) => data.onNodeResize?.(id, { width: params.width, height: params.height })}
      />
      <Handle type="target" position={Position.Left} />
      <div className="node-topline">
        <span className="node-type">Agent</span>
        <Badge tone={data.status === "Error" ? "red" : data.status === "Completed" ? "green" : "purple"}>{String(data.status)}</Badge>
      </div>
      <h3><span aria-hidden="true">✦</span> {data.title}</h3>
      <p>{data.agentType?.replace(/_/g, " ")}</p>
      <div className="node-meta">
        <span>{data.inputCount || 0} inputs</span>
        {data.lastRunAt ? <span>{new Date(data.lastRunAt).toLocaleTimeString()}</span> : <span>Not run</span>}
      </div>
      {data.lastError ? <p className="agent-error">{data.lastError}</p> : null}
      <Button
        className="agent-run-button"
        disabled={data.agentExecutionEnabled === false}
        title={data.agentExecutionEnabled === false ? data.agentExecutionMessage || "Agent execution is disabled." : undefined}
        onClick={(event) => {
          event.stopPropagation();
          if (data.agentExecutionEnabled === false) return;
          data.onRunAgent?.(id);
        }}
      >
        Run
      </Button>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
