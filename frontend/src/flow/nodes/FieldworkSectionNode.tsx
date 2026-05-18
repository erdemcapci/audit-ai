import { NodeResizer } from "@xyflow/react";
import type { FlowNodeData } from "../../types";

export function FieldworkSectionNode({ id, data, selected }: { id: string; data: FlowNodeData; selected?: boolean }) {
  const isSelected = selected || data.isSelected;

  return (
    <div className={`fieldwork-section fieldwork-section-${data.fieldworkSection || "default"} ${isSelected ? "selected" : ""}`}>
      <NodeResizer
        color="#64748b"
        isVisible={isSelected}
        minWidth={420}
        minHeight={320}
        handleClassName="phase-resize-handle"
        lineClassName="phase-resize-line"
        onResizeEnd={(_, params) => data.onNodeResize?.(id, { width: params.width, height: params.height })}
      />
      <div className="fieldwork-section-label">
        <strong>{data.title}</strong>
        <span>{data.description}</span>
      </div>
    </div>
  );
}
