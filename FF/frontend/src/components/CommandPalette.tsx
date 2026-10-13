import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function CommandPalette() {
  const nav = useNavigate();
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
      { label: '변경 영향 분석 · Impact', to: '/analysis/impact' },
      { label: '변경요청 등록', to: '/change/cr?new=1' },
      { label: '검토함', to: '/admin/approval' },
      { label: '긴급 차단·복구 · Kill Switch', to: '/ops/kill' },
      { label: '사전 점검 · PRECHECK', to: '/precheck' },
      { label: 'PoC 6단계 진행', to: '/poc' },
    ];
    const needle = q.trim();
    // Feature ID·이름은 Registry 검색으로 넘긴다(서버가 원천).
    const search = needle ? [{ label: `Feature 검색 · ${needle}`, to: `/features?q=${encodeURIComponent(needle)}` }] : [];
    if (!needle) return actions;
    return [...search, ...actions.filter(i => i.label.toLowerCase().includes(needle.toLowerCase()))].slice(0, 10);
  }, [q]);

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
