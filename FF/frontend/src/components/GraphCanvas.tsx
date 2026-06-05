import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';

const COLOR: Record<string, string> = {
  'feature-center': '#0B5FFF', feature: '#3B82F6', requirement: '#6366F1',
  swcomponent: '#7C3AED', ecu: '#9333EA', apiservice: '#0EA5E9', signal: '#0891B2',
  dtc: '#D9822B', variantrule: '#16A34A', controlpoint: '#DB2777',
  deploymentunit: '#2563EB', testcase: '#059669', supplierfunction: '#CA8A04', artifact: '#6B7280',
};

export default function GraphCanvas({ elements, layout = 'concentric', onNodeClick, onReady, live }:
  { elements: { nodes: any[]; edges: any[] }; layout?: string; onNodeClick?: (id: string) => void; onReady?: (cy: any) => void; live?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--ink').trim() || '#1A1F2B';
    const surface = css.getPropertyValue('--surface').trim() || '#ffffff';
    const layoutOpts: any = layout === 'concentric'
      ? { name: 'concentric', minNodeSpacing: 50, concentric: (n: any) => (n.data('type') === 'feature-center' ? 10 : 1), levelWidth: () => 1 }
      : layout === 'breadthfirst'
      ? { name: 'breadthfirst', directed: true, spacingFactor: 1.3, roots: elements.nodes.filter(n => n.data.type === 'feature-center').map(n => n.data.id) }
      : { name: 'cose', idealEdgeLength: 90, nodeRepulsion: 9000 };
    const cy = cytoscape({
      container: ref.current,
      elements: [...elements.nodes, ...elements.edges],
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
    // 살아 움직이는 그래프: 잡고 있지 않은 노드를 미세하게 흔들어 생동감 부여 (드래그는 기본 활성)
    let iv: any;
    if (live) iv = setInterval(() => {
      cy.nodes().forEach((n: any) => { if (n.grabbed()) return; const p = n.position(); n.position({ x: p.x + (Math.random() - 0.5) * 7, y: p.y + (Math.random() - 0.5) * 7 }); });
    }, 1200);
    return () => { if (iv) clearInterval(iv); cy.destroy(); };
  }, [elements, layout, live]);
  return <div className="graph" ref={ref} aria-label="Topology 그래프 (드래그·줌 가능)" role="img" />;
}
