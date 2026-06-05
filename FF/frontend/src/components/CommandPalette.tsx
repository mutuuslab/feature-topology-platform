import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store';

export default function CommandPalette() {
  const nav = useNavigate();
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const items = useMemo(() => {
    const actions = [
      { label: 'Run Impact Analysis', to: '/impact' },
      { label: 'Create CR (Wizard)', to: '/cr-wizard' },
      { label: 'Release Readiness · FEAT-BDC-001', to: '/readiness/FEAT-BDC-001' },
      { label: 'Kill Switch · FEAT-BDC-001', to: '/ops/FEAT-BDC-001' },
      { label: 'Consistency Console', to: '/consistency' },
    ];
    const feats = state.features.map(f => ({ label: `${f.id} · ${f.displayName}`, to: `/feature/${f.id}` }));
    const all = [...actions, ...feats];
    if (!q) return all.slice(0, 8);
    return all.filter(i => i.label.toLowerCase().includes(q.toLowerCase())).slice(0, 10);
  }, [q, state.features]);

  if (!open) return null;
  return (
    <div className="rp-overlay" onClick={() => setOpen(false)} style={{ alignItems: 'flex-start' }}>
      <div className="cmdk" onClick={e => e.stopPropagation()}>
        <input autoFocus placeholder="이동/실행 검색… (feat:, Run Impact)" value={q} onChange={e => setQ(e.target.value)} />
        <div>
          {items.map(i => (
            <div key={i.to} className="cmdk-item" onClick={() => { nav(i.to); setOpen(false); setQ(''); }}>{i.label}</div>
          ))}
          {items.length === 0 && <div className="cmdk-item muted">결과 없음</div>}
        </div>
        <div className="muted small" style={{ padding: '6px 10px' }}>⌘K / Ctrl+K 로 토글 · Esc 닫기</div>
      </div>
    </div>
  );
}
