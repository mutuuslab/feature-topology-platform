import { useNavigate } from 'react-router-dom';

// 모든 화면 → Topology 허브 연결. 클릭 시 해당 Feature 중심 토폴로지로 이동.
export default function TopoLink({ id = 'FEAT-BDC-001', label = 'Topology에서 보기' }: { id?: string; label?: string }) {
  const nav = useNavigate();
  return <button className="topo-link" onClick={() => nav(`/topology/${id}`)} title="Feature Topology 허브">◍ {label}</button>;
}
