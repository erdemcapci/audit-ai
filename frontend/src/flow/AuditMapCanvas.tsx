import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  type Viewport
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";

import { Button } from "../components/Button";
import type { AgentDefinition, AuditMapResponse, FlowNodeData, MapStateUpdate, PhaseLayout } from "../types";
import { calculateRequiredNodeSize, layoutAuditMap } from "./layoutAuditMap";
import { AgentNode } from "./nodes/AgentNode";
import { AuditNode } from "./nodes/AuditNode";
import { FieldworkItemNode } from "./nodes/FieldworkItemNode";
import { FieldworkSectionNode } from "./nodes/FieldworkSectionNode";
import { FindingNode } from "./nodes/FindingNode";
import { DocumentRequestNode } from "./nodes/DocumentRequestNode";
import { InterviewQuestionNode } from "./nodes/InterviewQuestionNode";
import { InterviewRoleNode } from "./nodes/InterviewRoleNode";
import { ObjectiveNode } from "./nodes/ObjectiveNode";
import { PhaseNode } from "./nodes/PhaseNode";
import { ReportNode } from "./nodes/ReportNode";
import { RiskNode } from "./nodes/RiskNode";
import { TestNode } from "./nodes/TestNode";
import { WorkstreamNode } from "./nodes/WorkstreamNode";

type PhaseFilter = "all" | "planning" | "fieldwork" | "reporting" | "execution";
type FlowBounds = { minX: number; minY: number; maxX: number; maxY: number };

export type MapHierarchyFilters = {
  workstreamId: string;
  objectiveId: string;
  status: string;
  nodeIds: string[];
  showInterviews: boolean;
  showDocumentRequests: boolean;
};

const nodeTypes: NodeTypes = {
  phaseNode: PhaseNode,
  auditNode: AuditNode,
  workstreamNode: WorkstreamNode,
  objectiveNode: ObjectiveNode,
  riskNode: RiskNode,
  testNode: TestNode,
  interviewRoleNode: InterviewRoleNode,
  interviewQuestionNode: InterviewQuestionNode,
  documentRequestNode: DocumentRequestNode,
  fieldworkItemNode: FieldworkItemNode,
  fieldworkSectionNode: FieldworkSectionNode,
  findingNode: FindingNode,
  reportNode: ReportNode,
  agentNode: AgentNode
} as NodeTypes;

function isHierarchyBridgeNode(nodeType: string): boolean {
  return ["auditNode", "workstreamNode", "objectiveNode", "riskNode", "testNode", "fieldworkItemNode", "documentRequestNode", "interviewRoleNode", "interviewQuestionNode", "findingNode", "reportNode"].includes(nodeType);
}

function phaseFromNode(node: Node<FlowNodeData>): string | null {
  if (node.type !== "phaseNode") return null;
  return node.id.replace("phase-", "");
}

function nodePhase(node: Node<FlowNodeData>, allNodes: Node<FlowNodeData>[]): PhaseFilter | null {
  if (node.type === "phaseNode") return (node.data.phase as PhaseFilter) || null;
  if (node.type === "fieldworkSectionNode") return "fieldwork";
  if (["auditNode", "workstreamNode", "objectiveNode", "riskNode", "testNode"].includes(node.type || "")) return "planning";
  if (["interviewRoleNode", "interviewQuestionNode", "fieldworkItemNode", "documentRequestNode", "findingNode"].includes(node.type || "")) return "fieldwork";
  if (node.type === "reportNode") return "reporting";
  if (node.type === "agentNode") {
    if (["interview_plan_generator", "document_request_generator", "finding_draft_agent"].includes(String(node.data.agentType || ""))) return "fieldwork";
    if (node.data.agentType === "report_draft_agent") return "reporting";
    const phases = allNodes.filter((item) => item.type === "phaseNode");
    const reporting = phases.find((item) => item.data.phase === "reporting");
    const fieldwork = phases.find((item) => item.data.phase === "fieldwork");
    if (reporting && node.position.x >= reporting.position.x) return "reporting";
    if (fieldwork && node.position.x >= fieldwork.position.x) return "fieldwork";
    return "planning";
  }
  return null;
}

function isHiddenFieldworkSectionNode(node: Node<FlowNodeData>, filters: MapHierarchyFilters): boolean {
  if (!filters.showInterviews) {
    if (node.type === "fieldworkSectionNode" && node.data.fieldworkSection === "interviews") return true;
    if (node.type === "interviewRoleNode" || node.type === "interviewQuestionNode") return true;
    if (node.type === "agentNode" && node.data.agentType === "interview_plan_generator") return true;
  }
  if (!filters.showDocumentRequests) {
    if (node.type === "fieldworkSectionNode" && node.data.fieldworkSection === "documents") return true;
    if (node.type === "documentRequestNode") return true;
    if (node.type === "agentNode" && node.data.agentType === "document_request_generator") return true;
  }
  return false;
}

function toMapState(nodes: Node<FlowNodeData>[], edges: Edge[]): MapStateUpdate {
  const phaseLayouts: Record<string, PhaseLayout> = {};
  const nodePositions: Record<string, { x: number; y: number }> = {};
  const nodeDimensions: Record<string, { width: number; height: number }> = {};
  nodes.forEach((node) => {
    const phase = phaseFromNode(node);
    if (phase) {
      const style = node.style || {};
      phaseLayouts[phase] = {
        x: node.position.x,
        y: node.position.y,
        width: Number(node.data.width || style.width || node.width || 800),
        height: Number(node.data.height || style.height || node.height || 900)
      };
      return;
    }
    nodePositions[node.id] = node.position;
    const style = node.style || {};
    nodeDimensions[node.id] = {
      width: Number(node.data.width || style.width || node.width || 560),
      height: Number(node.data.height || style.height || node.height || 140)
    };
  });
  return {
    phaseLayouts,
    nodePositions,
    nodeDimensions,
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type || "smoothstep",
      animated: Boolean(edge.animated),
      data: (edge.data || {}) as Record<string, unknown>
    }))
  };
}

function getNodeBounds(nodes: Node<FlowNodeData>[]): FlowBounds {
  if (!nodes.length) return { minX: 0, minY: 0, maxX: 1000, maxY: 800 };
  return nodes.reduce(
    (bounds, node) => {
      const width = Number(node.data.width || node.width || 560);
      const height = Number(node.data.height || node.height || 140);
      return {
        minX: Math.min(bounds.minX, node.position.x),
        minY: Math.min(bounds.minY, node.position.y),
        maxX: Math.max(bounds.maxX, node.position.x + width),
        maxY: Math.max(bounds.maxY, node.position.y + height)
      };
    },
    { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY }
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function InnerCanvas({
  map,
  selectedNodeId,
  agentTypes,
  onSelectNode,
  onSaveMap,
  onRunAgent,
  onAutoLayout,
  onError,
  phaseFilter,
  hierarchyFilters,
  agentExecutionEnabled,
  agentExecutionMessage
}: {
  map: AuditMapResponse | null;
  selectedNodeId: string | null;
  agentTypes: AgentDefinition[];
  onSelectNode: (node: Node<FlowNodeData> | null) => void;
  onSaveMap: (state: MapStateUpdate) => Promise<void>;
  onRunAgent: (agentId: string, inputNodeIds?: string[]) => void;
  onAutoLayout: () => Promise<void>;
  onError: (message: string) => void;
  phaseFilter: PhaseFilter;
  hierarchyFilters: MapHierarchyFilters;
  agentExecutionEnabled: boolean;
  agentExecutionMessage: string;
}) {
  const reactFlow = useReactFlow<Node<FlowNodeData>, Edge>();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [saving, setSaving] = useState(false);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const edgesRef = useRef<Edge[]>([]);
  const nodesRef = useRef<Node<FlowNodeData>[]>([]);
  const onSaveMapRef = useRef(onSaveMap);
  const onRunAgentRef = useRef(onRunAgent);
  const previousPhaseFilterRef = useRef<PhaseFilter>(phaseFilter);
  const previousHierarchyFilterRef = useRef("");

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    onSaveMapRef.current = onSaveMap;
  }, [onSaveMap]);

  useEffect(() => {
    onRunAgentRef.current = onRunAgent;
  }, [onRunAgent]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const updateSize = () => setCanvasSize({ width: element.clientWidth, height: element.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const persist = useCallback(
    async (nextNodes = nodesRef.current, nextEdges = edgesRef.current) => {
      setSaving(true);
      try {
        await onSaveMapRef.current(toMapState(nextNodes, nextEdges));
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const handlePhaseResize = useCallback(
    (nodeId: string, dimensions: { width: number; height: number }) => {
      setNodes((currentNodes) => {
        const nextNodes = currentNodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: { ...node.data, width: dimensions.width, height: dimensions.height },
                style: { ...node.style, width: dimensions.width, height: dimensions.height }
              }
            : node
        );
        setSaving(true);
        void onSaveMapRef.current(toMapState(nextNodes, edgesRef.current)).finally(() => setSaving(false));
        return nextNodes;
      });
    },
    [setNodes]
  );

  const handleNodeResize = useCallback(
    (nodeId: string, dimensions: { width: number; height: number }) => {
      setNodes((currentNodes) => {
        const nextNodes = currentNodes.map((node) => {
          if (node.id !== nodeId) return node;
          const required = calculateRequiredNodeSize(node.data, dimensions.width);
          const width = Math.max(dimensions.width, required.width);
          const height = Math.max(dimensions.height, required.height);
          return {
            ...node,
            data: { ...node.data, width, height },
            style: { ...node.style, width, height }
          };
        });
        setSaving(true);
        void onSaveMapRef.current(toMapState(nextNodes, edgesRef.current)).finally(() => setSaving(false));
        return nextNodes;
      });
    },
    [setNodes]
  );

  useEffect(() => {
    const laidOut = map ? layoutAuditMap(map) : null;
    const nextNodes: Node<FlowNodeData>[] =
      laidOut?.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onRunAgent: (agentId: string, inputNodeIds?: string[]) => onRunAgentRef.current(agentId, inputNodeIds),
          agentExecutionEnabled,
          agentExecutionMessage,
          onPhaseResize: handlePhaseResize,
          onNodeResize: handleNodeResize
        },
        style:
          node.type === "phaseNode" || node.type === "fieldworkSectionNode"
            ? { width: node.data.width || 800, height: node.data.height || 900 }
            : {
                width: node.width || node.data.width || calculateRequiredNodeSize(node.data).width,
                height: node.height || node.data.height || calculateRequiredNodeSize(node.data, node.width || node.data.width).height
              },
        zIndex: node.type === "phaseNode" ? 0 : node.type === "fieldworkSectionNode" ? 1 : 2,
        draggable: true,
        selectable: node.type !== "phaseNode",
        dragHandle: node.type === "phaseNode" ? ".phase-zone-label" : node.type === "fieldworkSectionNode" ? ".fieldwork-section-label" : undefined
      })) || [];
    const nextEdges: Edge[] =
      laidOut?.edges.map((edge) => ({
        ...edge,
        style: { stroke: "#94A3B8", strokeWidth: 2 }
      })) || [];
    setNodes(nextNodes);
    setEdges(nextEdges);
    window.requestAnimationFrame(() => reactFlow.fitView({ padding: 0.16, duration: 250 }));
  }, [agentExecutionEnabled, agentExecutionMessage, handleNodeResize, handlePhaseResize, map, reactFlow, setEdges, setNodes]);

  const nodeTypeById = useMemo(() => new Map(nodes.map((node) => [node.id, node.type || ""])), [nodes]);
  const connected = useMemo(() => {
    const set = new Set<string>();
    if (!selectedNodeId) return set;
    edges.forEach((edge) => {
      if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
        set.add(edge.source);
        set.add(edge.target);
      }
    });
    return set;
  }, [edges, selectedNodeId]);

  const decoratedNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onRunAgent: (agentId: string) => onRunAgentRef.current(agentId, edges.filter((edge) => edge.target === agentId).map((edge) => edge.source)),
          agentExecutionEnabled,
          agentExecutionMessage,
          onPhaseResize: handlePhaseResize,
          onNodeResize: handleNodeResize,
          isSelected: node.id === selectedNodeId
        },
        className:
          selectedNodeId && !["phaseNode", "fieldworkSectionNode"].includes(node.type || "") && node.id !== selectedNodeId && !connected.has(node.id)
            ? "node-faded"
            : ""
      })),
    [agentExecutionEnabled, agentExecutionMessage, connected, edges, handleNodeResize, handlePhaseResize, nodes, selectedNodeId]
  );
  const hierarchyVisibleIds = useMemo(() => {
    const hasHierarchyFilter = Boolean(hierarchyFilters.nodeIds.length || hierarchyFilters.status);
    if (!hasHierarchyFilter) return null;

    const nodeById = new Map(decoratedNodes.map((node) => [node.id, node]));
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();
    edges.forEach((edge) => {
      outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]);
      incoming.set(edge.target, [...(incoming.get(edge.target) || []), edge.source]);
    });

    const expandAround = (seedIds: Set<string>) => {
      const expanded = new Set<string>(seedIds);
      const includeAncestors = (id: string) => {
        expanded.add(id);
        (incoming.get(id) || []).forEach((parentId) => {
          const parent = nodeById.get(parentId);
          if (parent && ["auditNode", "workstreamNode", "objectiveNode", "riskNode", "testNode"].includes(parent.type || "")) {
            includeAncestors(parentId);
          }
        });
      };
      const includeDescendants = (id: string) => {
        (outgoing.get(id) || []).forEach((childId) => {
          if (expanded.has(childId)) return;
          const child = nodeById.get(childId);
          if (!child || child.type === "agentNode") return;
          expanded.add(childId);
          if (isHierarchyBridgeNode(child.type || "")) includeDescendants(childId);
        });
      };
      Array.from(seedIds).forEach((id) => {
        includeAncestors(id);
        includeDescendants(id);
      });
      return expanded;
    };

    const structuralIds = hierarchyFilters.nodeIds.length ? new Set(hierarchyFilters.nodeIds) : null;
    let visible = structuralIds ? new Set(structuralIds) : new Set<string>();

    if (hierarchyFilters.status) {
      const statusSeeds = new Set<string>();
      decoratedNodes.forEach((node) => {
        const nodeStatus = String(node.data.itemStatus || node.data.status || "");
        if (nodeStatus !== hierarchyFilters.status) return;
        if (structuralIds && !structuralIds.has(node.id)) return;
        statusSeeds.add(node.id);
      });
      visible = expandAround(statusSeeds);
    }

    decoratedNodes.forEach((node) => {
      if (node.type === "phaseNode" || node.type === "fieldworkSectionNode" || node.type === "agentNode") {
        visible.add(node.id);
      }
    });

    return visible;
  }, [decoratedNodes, edges, hierarchyFilters]);

  const visibleNodes = useMemo(
    () =>
      decoratedNodes.filter((node) => {
        if (isHiddenFieldworkSectionNode(node, hierarchyFilters)) return false;
        if (hierarchyVisibleIds && !hierarchyVisibleIds.has(node.id)) return false;
        if (phaseFilter === "all") return true;
        const phase = nodePhase(node, decoratedNodes);
        return phaseFilter === "execution" ? phase === "fieldwork" || phase === "reporting" : phase === phaseFilter;
      }),
    [decoratedNodes, hierarchyFilters, hierarchyVisibleIds, phaseFilter]
  );
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => (phaseFilter === "all" && !hierarchyVisibleIds ? edges : edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))),
    [edges, hierarchyVisibleIds, phaseFilter, visibleNodeIds]
  );
  const focusNodes = useMemo(() => {
    if (!hierarchyVisibleIds) return visibleNodes;
    const filteredCards = visibleNodes.filter((node) => node.type !== "phaseNode" && node.type !== "fieldworkSectionNode");
    return filteredCards.length ? filteredCards : visibleNodes;
  }, [hierarchyVisibleIds, visibleNodes]);
  const hierarchyFilterKey = useMemo(
    () =>
      JSON.stringify({
        nodeIds: [...hierarchyFilters.nodeIds].sort(),
        status: hierarchyFilters.status,
        showInterviews: hierarchyFilters.showInterviews,
        showDocumentRequests: hierarchyFilters.showDocumentRequests
      }),
    [hierarchyFilters.nodeIds, hierarchyFilters.showDocumentRequests, hierarchyFilters.showInterviews, hierarchyFilters.status]
  );
  const scrollMetrics = useMemo(() => {
    const padding = 80;
    const bounds = getNodeBounds(visibleNodes);
    const leftViewport = padding - bounds.minX * viewport.zoom;
    const rightViewport = canvasSize.width - (bounds.maxX + padding) * viewport.zoom;
    const topViewport = padding - bounds.minY * viewport.zoom;
    const bottomViewport = canvasSize.height - (bounds.maxY + padding) * viewport.zoom;
    const minX = Math.min(leftViewport, rightViewport);
    const maxX = Math.max(leftViewport, rightViewport);
    const minY = Math.min(topViewport, bottomViewport);
    const maxY = Math.max(topViewport, bottomViewport);
    const xRange = Math.max(maxX - minX, 1);
    const yRange = Math.max(maxY - minY, 1);
    return {
      minX,
      maxX,
      minY,
      maxY,
      xValue: Math.round(((maxX - clamp(viewport.x, minX, maxX)) / xRange) * 1000),
      yValue: Math.round(((maxY - clamp(viewport.y, minY, maxY)) / yRange) * 1000),
      canScrollX: xRange > 1,
      canScrollY: yRange > 1
    };
  }, [canvasSize.height, canvasSize.width, viewport.x, viewport.y, viewport.zoom, visibleNodes]);

  useEffect(() => {
    if (phaseFilter !== "all" && selectedNodeId && !visibleNodeIds.has(selectedNodeId)) {
      onSelectNode(null);
    }
  }, [phaseFilter, onSelectNode, selectedNodeId, visibleNodeIds]);

  useEffect(() => {
    if (previousPhaseFilterRef.current === phaseFilter) return;
    previousPhaseFilterRef.current = phaseFilter;
    window.requestAnimationFrame(() => reactFlow.fitView({ nodes: focusNodes, padding: 0.18, duration: 220 }));
  }, [focusNodes, phaseFilter, reactFlow]);

  useEffect(() => {
    if (previousHierarchyFilterRef.current === hierarchyFilterKey) return;
    previousHierarchyFilterRef.current = hierarchyFilterKey;
    if (!hierarchyFilters.nodeIds.length && !hierarchyFilters.status) return;
    window.requestAnimationFrame(() => reactFlow.fitView({ nodes: focusNodes, padding: 0.2, duration: 220 }));
  }, [focusNodes, hierarchyFilterKey, hierarchyFilters.nodeIds.length, hierarchyFilters.status, reactFlow]);

  function validateConnection(connection: Connection): string {
    const sourceType = nodeTypeById.get(connection.source || "");
    const targetType = nodeTypeById.get(connection.target || "");
    if (targetType !== "agentNode") return "";
    const targetNode = nodes.find((node) => node.id === connection.target);
    const definition = agentTypes.find((item) => item.type === targetNode?.data.agentType);
    if (!definition || !sourceType || definition.allowed_input_node_types.includes(sourceType)) return "";
    return "This agent cannot use that node type as input.";
  }

  function setHorizontalScroll(rawValue: string) {
    const nextValue = Number(rawValue) / 1000;
    const nextX = scrollMetrics.maxX - nextValue * (scrollMetrics.maxX - scrollMetrics.minX);
    reactFlow.setViewport({ ...viewport, x: nextX });
  }

  function setVerticalScroll(rawValue: string) {
    const nextValue = Number(rawValue) / 1000;
    const nextY = scrollMetrics.maxY - nextValue * (scrollMetrics.maxY - scrollMetrics.minY);
    reactFlow.setViewport({ ...viewport, y: nextY });
  }

  return (
    <div className="audit-map-canvas" ref={canvasRef}>
      <ReactFlow
        nodes={visibleNodes}
        edges={visibleEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.14 }}
        minZoom={0.18}
        maxZoom={1.5}
        nodesDraggable
        selectionOnDrag
        panOnDrag={[1, 2]}
        onMove={(_, nextViewport) => setViewport(nextViewport)}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={({ nodes: selectedNodes }) => {
          onSelectNode(selectedNodes.length === 1 ? (selectedNodes[0] as Node<FlowNodeData>) : null);
        }}
        onNodeClick={(event, node) => {
          const target = event.target instanceof Element ? event.target : null;
          if (node.type === "phaseNode" && !target?.closest(".phase-zone-label") && !target?.closest(".react-flow__resize-control")) {
            onSelectNode(null);
            return;
          }
          onSelectNode(node as Node<FlowNodeData>);
        }}
        onPaneClick={() => onSelectNode(null)}
        onNodeDragStop={(_, node) => {
          setNodes((currentNodes) => {
            const nextNodes = currentNodes.map((item) => (item.id === node.id ? { ...item, position: node.position } : item));
            void persist(nextNodes, edgesRef.current);
            return nextNodes;
          });
        }}
        onConnect={(connection) => {
          const error = validateConnection(connection);
          if (error) {
            onError(error);
            return;
          }
          const nextEdges = addEdge({ ...connection, type: "smoothstep", animated: true }, edges);
          setEdges(nextEdges);
          void persist(nodes, nextEdges);
        }}
      >
        <Panel position="top-left" className="canvas-toolbar">
          <Button variant="ghost" onClick={() => reactFlow.fitView({ padding: 0.16, duration: 250 })}>Fit View</Button>
          <Button variant="secondary" onClick={onAutoLayout}>Auto Layout</Button>
          {saving ? <span className="saving-pill">Saving</span> : null}
        </Panel>
        <Background color="#E2E8F0" gap={28} />
        <Controls />
        <MiniMap pannable zoomable nodeStrokeWidth={3} />
      </ReactFlow>
      <input
        aria-label="Horizontal map scrollbar"
        className="map-scrollbar map-scrollbar-horizontal"
        max={1000}
        min={0}
        onChange={(event) => setHorizontalScroll(event.target.value)}
        onPointerDown={(event) => event.stopPropagation()}
        type="range"
        value={scrollMetrics.xValue}
        disabled={!scrollMetrics.canScrollX}
      />
      <input
        aria-label="Vertical map scrollbar"
        className="map-scrollbar map-scrollbar-vertical"
        max={1000}
        min={0}
        onChange={(event) => setVerticalScroll(event.target.value)}
        onPointerDown={(event) => event.stopPropagation()}
        type="range"
        value={scrollMetrics.yValue}
        disabled={!scrollMetrics.canScrollY}
      />
    </div>
  );
}

export function AuditMapCanvas(props: {
  map: AuditMapResponse | null;
  selectedNodeId: string | null;
  agentTypes: AgentDefinition[];
  onSelectNode: (node: Node<FlowNodeData> | null) => void;
  onSaveMap: (state: MapStateUpdate) => Promise<void>;
  onRunAgent: (agentId: string, inputNodeIds?: string[]) => void;
  onAutoLayout: () => Promise<void>;
  onError: (message: string) => void;
  phaseFilter: PhaseFilter;
  hierarchyFilters: MapHierarchyFilters;
  agentExecutionEnabled: boolean;
  agentExecutionMessage: string;
}) {
  return (
    <ReactFlowProvider>
      <InnerCanvas {...props} />
    </ReactFlowProvider>
  );
}
