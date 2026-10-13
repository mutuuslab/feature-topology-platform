import { LEGACY_PAL } from '../design/legacy-palette';
import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import { useMotionTick } from '../state/motion';

const COLOR: Record<string, string> = {
  'feature-center': LEGACY_PAL['lg-0b5fff'], feature: LEGACY_PAL['lg-3b82f6'], requirement: LEGACY_PAL['lg-6366f1'],
  swcomponent: LEGACY_PAL['lg-7c3aed'], ecu: LEGACY_PAL['lg-9333ea'], apiservice: LEGACY_PAL['lg-0ea5e9'], signal: LEGACY_PAL['lg-0891b2'],
  dtc: LEGACY_PAL['lg-d9822b'], variantrule: LEGACY_PAL['lg-16a34a'], controlpoint: LEGACY_PAL['lg-db2777'], rule: LEGACY_PAL['lg-b45309'],
  observationpoint: LEGACY_PAL['lg-0f766e'], deploymentunit: LEGACY_PAL['lg-2563eb'], testcase: LEGACY_PAL['lg-059669'],
  supplierfunction: LEGACY_PAL['lg-ca8a04'], artifact: LEGACY_PAL['lg-6b7280'],
};

/** concentric 반지름 등급 — 중심 Feature 에서 먼 검증·배포 계열을 바깥 링으로 밀어 라벨 충돌을 줄인다. */
const RING: Record<string, number> = {
  'feature-center': 10, deploymentunit: 4, testcase: 4, supplierfunction: 3,
  observationpoint: 3, rule: 3, controlpoint: 2, feature: 2,
};

export default function GraphCanvas({ elements, layout = 'concentric', onNodeClick, onReady, live }:
  { elements: { nodes: any[]; edges: any[] }; layout?: string; onNodeClick?: (id: string) => void; onReady?: (cy: any) => void; live?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<any>(null);
  useEffect(() => {
    if (!ref.current) return;
    // cytoscape 는 없는 노드를 가리키는 간선을 만나면 던진다 — 화면 하나가 제품 전체를 비우지 않도록 간선 무결성을 먼저 보장한다.
    const nodeIds = new Set(elements.nodes.map(n => n.data.id));
    const safeEdges = elements.edges.filter(e => nodeIds.has(e.data.source) && nodeIds.has(e.data.target));
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--ink').trim() || LEGACY_PAL['lg-1a1f2b'];
    const surface = css.getPropertyValue('--surface').trim() || LEGACY_PAL['lg-ffffff'];
    const layoutOpts: any = layout === 'concentric'
      ? { name: 'concentric', minNodeSpacing: 80, concentric: (n: any) => RING[n.data('type')] ?? 1, levelWidth: () => 1, padding: 30 }
      : layout === 'breadthfirst'
      ? { name: 'breadthfirst', directed: true, spacingFactor: 1.4, padding: 30, roots: elements.nodes.filter(n => n.data.type === 'feature-center').map(n => n.data.id) }
      : { name: 'cose', idealEdgeLength: 110, nodeRepulsion: 12000, padding: 30 };
    const cy = cytoscape({
      container: ref.current,
      elements: [...elements.nodes, ...safeEdges],
      style: [
        { selector: 'node', style: {
          'background-color': (n: any) => COLOR[n.data('type')] || LEGACY_PAL['lg-6b7280'],
          label: 'data(label)', color: ink, 'font-size': 10, 'text-wrap': 'wrap', 'text-max-width': '110px',
          'text-valign': 'bottom', 'text-margin-y': 4, width: 26, height: 26,
        } },
        { selector: 'node[type="feature-center"]', style: {
          width: 52, height: 52, 'font-size': 13, 'font-weight': 'bold', 'border-width': 3, 'border-color': LEGACY_PAL['lg-ffffff'],
          'background-fill': 'radial-gradient', 'background-gradient-stop-colors': [LEGACY_PAL['lg-5b9bff'], LEGACY_PAL['lg-0b5fff'], LEGACY_PAL['lg-073bb3']],
          'background-gradient-stop-positions': [0, 55, 100],
          'underlay-color': LEGACY_PAL['lg-0b5fff'], 'underlay-opacity': 0.35, 'underlay-padding': 12, 'underlay-shape': 'ellipse',
        } },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': LEGACY_PAL['lg-0b5fff'], 'underlay-color': LEGACY_PAL['lg-0b5fff'], 'underlay-opacity': 0.25, 'underlay-padding': 8 } },
        { selector: 'edge', style: {
          width: 1.5, 'line-color': LEGACY_PAL['lg-b6c0ce'], 'target-arrow-color': LEGACY_PAL['lg-b6c0ce'], 'target-arrow-shape': 'triangle',
          'curve-style': 'bezier', label: 'data(label)', 'font-size': 8, color: LEGACY_PAL['lg-8895a7'], 'text-rotation': 'autorotate',
          'text-background-color': surface, 'text-background-opacity': 1, 'text-background-padding': '2px',
          'arrow-scale': 0.9, 'line-opacity': 0.85,
        } },
        { selector: 'edge:selected', style: { width: 2.5, 'line-color': LEGACY_PAL['lg-0b5fff'], 'target-arrow-color': LEGACY_PAL['lg-0b5fff'] } },
      ],
      layout: layoutOpts,
    });
    if (onNodeClick) cy.on('tap', 'node', (e: any) => onNodeClick(e.target.id()));
    cyRef.current = cy;
    if (onReady) onReady(cy);
    return () => { cy.destroy(); };
  }, [elements, layout, live]);
  // 살아 움직이는 그래프: 미세한 호흡만 준다 — 크게 흔들면 라벨이 흔들려 읽기 어려워진다 (드래그는 기본 활성).
  // 주기는 공용 모션 커널이 소유한다(창을 가리거나 모션을 멈추면 흔들림도 멈춘다).
  useMotionTick(1800, () => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().forEach((n: any) => { if (n.grabbed()) return; const p = n.position(); n.position({ x: p.x + (Math.random() - 0.5) * 2.4, y: p.y + (Math.random() - 0.5) * 2.4 }); });
  }, !!live);
  return <div className="graph" ref={ref} aria-label="Topology 그래프 (드래그·줌 가능)" role="img" />;
}
