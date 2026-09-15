import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';

const COLOR: Record<string, string> = {
  'feature-center': '#0B5FFF', feature: '#3B82F6', requirement: '#6366F1',
  swcomponent: '#7C3AED', ecu: '#9333EA', apiservice: '#0EA5E9', signal: '#0891B2',
  dtc: '#D9822B', variantrule: '#16A34A', controlpoint: '#DB2777', rule: '#B45309',
  observationpoint: '#0F766E', deploymentunit: '#2563EB', testcase: '#059669',
  supplierfunction: '#CA8A04', artifact: '#6B7280',
};

/** concentric 반지름 등급 — 중심 Feature 에서 먼 검증·배포 계열을 바깥 링으로 밀어 라벨 충돌을 줄인다. */
const RING: Record<string, number> = {
  'feature-center': 10, deploymentunit: 4, testcase: 4, supplierfunction: 3,
  observationpoint: 3, rule: 3, controlpoint: 2, feature: 2,
};

export default function GraphCanvas({ elements, layout = 'concentric', onNodeClick, onReady, live }:
  { elements: { nodes: any[]; edges: any[] }; layout?: string; onNodeClick?: (id: string) => void; onReady?: (cy: any) => void; live?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    // cytoscape 는 없는 노드를 가리키는 간선을 만나면 던진다 — 화면 하나가 제품 전체를 비우지 않도록 간선 무결성을 먼저 보장한다.
    const nodeIds = new Set(elements.nodes.map(n => n.data.id));
    const safeEdges = elements.edges.filter(e => nodeIds.has(e.data.source) && nodeIds.has(e.data.target));
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--ink').trim() || '#1A1F2B';
    const surface = css.getPropertyValue('--surface').trim() || '#ffffff';
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
          'background-color': (n: any) => COLOR[n.data('type')] || '#6B7280',
          label: 'data(label)', color: ink, 'font-size': 10, 'text-wrap': 'wrap', 'text-max-width': '110px',
          'text-valign': 'bottom', 'text-margin-y': 4, width: 26, height: 26,
        } },
        { selector: 'node[type="feature-center"]', style: {
          width: 52, height: 52, 'font-size': 13, 'font-weight': 'bold', 'border-width': 3, 'border-color': '#ffffff',
          'background-fill': 'radial-gradient', 'background-gradient-stop-colors': ['#5B9BFF', '#0B5FFF', '#073BB3'],
          'background-gradient-stop-positions': [0, 55, 100],
          'underlay-color': '#0B5FFF', 'underlay-opacity': 0.35, 'underlay-padding': 12, 'underlay-shape': 'ellipse',
        } },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#0B5FFF', 'underlay-color': '#0B5FFF', 'underlay-opacity': 0.25, 'underlay-padding': 8 } },
        { selector: 'edge', style: {
          width: 1.5, 'line-color': '#B6C0CE', 'target-arrow-color': '#B6C0CE', 'target-arrow-shape': 'triangle',
          'curve-style': 'bezier', label: 'data(label)', 'font-size': 8, color: '#8895A7', 'text-rotation': 'autorotate',
          'text-background-color': surface, 'text-background-opacity': 1, 'text-background-padding': '2px',
          'arrow-scale': 0.9, 'line-opacity': 0.85,
        } },
        { selector: 'edge:selected', style: { width: 2.5, 'line-color': '#0B5FFF', 'target-arrow-color': '#0B5FFF' } },
      ],
      layout: layoutOpts,
    });
    if (onNodeClick) cy.on('tap', 'node', (e: any) => onNodeClick(e.target.id()));
    if (onReady) onReady(cy);
    // 살아 움직이는 그래프: 미세한 호흡만 준다 — 크게 흔들면 라벨이 흔들려 읽기 어려워진다 (드래그는 기본 활성)
    let iv: any;
    if (live) iv = setInterval(() => {
      cy.nodes().forEach((n: any) => { if (n.grabbed()) return; const p = n.position(); n.position({ x: p.x + (Math.random() - 0.5) * 2.4, y: p.y + (Math.random() - 0.5) * 2.4 }); });
    }, 1800);
    return () => { if (iv) clearInterval(iv); cy.destroy(); };
  }, [elements, layout, live]);
  return <div className="graph" ref={ref} aria-label="Topology 그래프 (드래그·줌 가능)" role="img" />;
}
