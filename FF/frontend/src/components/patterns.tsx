import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store';
import { useT } from '../i18n';

export function EmptyState({ title, cta }: { title: string; cta?: React.ReactNode }) {
  return <div className="card" style={{ textAlign: 'center', padding: 40 }}><p className="muted">{title}</p>{cta}</div>;
}
export function Skeleton({ rows = 5 }: { rows?: number }) {
  return <div className="card">{Array.from({ length: rows }).map((_, i) =>
    <div key={i} className="skel" style={{ height: 16, margin: '8px 0', borderRadius: 4 }} />)}</div>;
}
export function ErrorState({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  const { t } = useT();
  return <div className="card" style={{ borderColor: 'var(--fail)' }}><p style={{ color: 'var(--fail)' }}>⚠ {msg}</p>{onRetry && <button className="btn" onClick={onRetry}>{t('retry')}</button>}</div>;
}
export function NoPermission({ verb }: { verb: string }) {
  const { t } = useT();
  return <span className="pill" title={`${t('noPerm')}: ${verb}`} style={{ opacity: .6 }}>🔒 {verb}</span>;
}

// 권한 게이팅 버튼
export function GButton({ verb, children, ...rest }: any) {
  const { can } = useApp();
  if (!can(verb)) return <span className="btn" style={{ opacity: .5, cursor: 'not-allowed' }} title={`권한 필요: ${verb}`}>🔒 {children}</span>;
  return <button {...rest} className={rest.className || 'btn'}>{children}</button>;
}

// 우측 슬라이드오버
export function RightPanel({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="rp-overlay" onClick={onClose}>
      <aside className="rp" role="dialog" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="rp-head"><b>{title}</b><button className="btn" onClick={onClose} aria-label="닫기">✕</button></div>
        <div className="rp-body">{children}</div>
      </aside>
    </div>
  );
}

// Toast 호스트 (store.toast 구독, 자동 소멸)
export function ToastHost() {
  const { state, dispatch } = useApp();
  useEffect(() => {
    if (state.toast) { const id = setTimeout(() => dispatch({ t: 'TOAST', toast: null }), 2600); return () => clearTimeout(id); }
  }, [state.toast]);
  if (!state.toast) return null;
  const c = { ok: 'var(--pass)', warn: 'var(--pending)', err: 'var(--fail)' }[state.toast.kind];
  return <div className="toast" style={{ borderLeft: `4px solid ${c}` }}>{state.toast.msg}</div>;
}

export function NotFound() {
  const { t } = useT();
  // BrowserRouter이므로 '#/'가 아니라 라우터 링크로 홈에 간다 (IA 감사: 깨진 링크 수정)
  return <div data-not-found><EmptyState title={t('notFound')} cta={<Link className="btn" to="/">{t('home')}</Link>} /></div>;
}

/** 문장 속 날짜·시각(2026-09-13, 2026-09-13T10:00:00Z)이 하이픈 뒤에서 두 줄로 갈리지 않게 묶는다(UI 하네스 2판, 2026-10-23) */
export function DateText({ text }: { text: string }) {
  const parts = text.split(/(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?)/);
  return <>{parts.map((p, i) => (i % 2 ? <span key={i} style={{ whiteSpace: 'nowrap' }}>{p}</span> : p))}</>;
}
