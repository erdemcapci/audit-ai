import { NodeResizer } from "@xyflow/react";
import type { FlowNodeData } from "../../types";

export function PhaseNode({ id, data, selected }: { id: string; data: FlowNodeData; selected?: boolean }) {
  const isSelected = selected || data.isSelected;

  return (
    <div className={`phase-zone phase-${data.phase || "default"} ${isSelected ? "selected" : ""}`}>
      <NodeResizer
        color="#64748b"
        isVisible={isSelected}
        minWidth={600}
        minHeight={500}
        handleClassName="phase-resize-handle"
        lineClassName="phase-resize-line"
        onResizeEnd={(_, params) => data.onPhaseResize?.(id, { width: params.width, height: params.height })}
      />
      <div className="phase-zone-label">
        <strong>{data.title}</strong>
        <span>{data.description}</span>
      </div>
    </div>
  );
}
