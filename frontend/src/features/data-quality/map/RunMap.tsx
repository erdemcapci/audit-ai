import { Background, Controls, Handle, Position, ReactFlow, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { SEVERITY_LABEL } from "../ui";
import { buildMap, type MapInput, type MapNodeData } from "./mapModel";

function StepNode({ data, selected }: NodeProps<Node<MapNodeData>>) {
  const inactive = data.state === "not_applicable" || data.state === "switched_off";
  return (
    <div className={`dq-map-node dq-map-${data.kind} dq-state-${data.state}${data.severity ? ` dq-sev-${data.severity}` : ""}${selected ? " selected" : ""}`}>
      {data.kind !== "source" ? <Handle type="target" position={Position.Left} /> : null}
      <div className="dq-map-top">
        <span className={`dq-map-actor dq-map-actor-${data.actor.toLowerCase()}`}>{data.actor}</span>
        {data.severity && data.severity !== "clean" && !inactive ? <span className={`dq-map-sev dq-map-sev-${data.severity}`}>{SEVERITY_LABEL[data.severity]}</span> : null}
        {data.state === "running" ? <span className="dq-map-spinner" aria-label="Running" /> : null}
      </div>
      <strong title={data.title}>{data.title}</strong>
      <span className="dq-map-sub">{data.subtitle}</span>
      {data.kind !== "result" ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  );
}

const nodeTypes: NodeTypes = { dqStep: StepNode };

export function RunMap({ input, selected, onSelect }: { input: MapInput; selected: string | null; onSelect: (id: string | null) => void }) {
  const { nodes, edges } = useMemo(() => buildMap(input), [input]);
  const withSelection = useMemo(() => nodes.map((nd) => ({ ...nd, selected: nd.id === selected })), [nodes, selected]);
  return (
    <div className="dq-map">
      <ReactFlow
        nodes={withSelection}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={(_, nd) => onSelect(nd.id)}
        onPaneClick={() => onSelect(null)}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        minZoom={0.3}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} color="#e2e8f0" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
