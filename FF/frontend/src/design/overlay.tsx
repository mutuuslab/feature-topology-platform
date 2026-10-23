// 드로어·파괴적 액션 확인 — Esc로 닫고, 열릴 때 첫 입력으로 초점을 옮기고, 닫히면 원래 자리로 돌려준다.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ko } from '../copy/ko';
import { Button } from './primitives';

function useOverlay(open: boolean, onClose: () => void) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => box.current?.querySelector<HTMLElement>('input, button, [tabindex]')?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      // 창이 겹치면(요청 Drawer 위의 확인 창) 맨 위 창만 닫는다 — 아래 창의 입력이 함께 사라지지 않게
      const top = [...document.querySelectorAll('[aria-modal="true"]')].at(-1);
      if (box.current && top && top !== box.current) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && box.current) {
        const f = [...box.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')];
        if (!f.length) return;
        const [first, last] = [f[0], f[f.length - 1]];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  return box;
}

export function Drawer({ open, title, onClose, children }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode }) {
  const box = useOverlay(open, onClose);
  const id = useId();
  if (!open) return null;
  return createPortal(
    <>
      <div className="ds-scrim" onClick={onClose} />
      <div className="ds-drawer" role="dialog" aria-modal="true" aria-labelledby={id} ref={box}>
        <header className="ds-drawer__head">
          <h2 id={id}>{title}</h2>
          <Button variant="ghost" icon="close" aria-label={ko.action.close} onClick={onClose} />
        </header>
        <div className="ds-drawer__body">{children}</div>
      </div>
    </>,
    document.body,
  );
}

/**
 * 파괴적 액션(Kill·Rollback) 확인 — 대상 ID를 그대로 입력해야 실행 버튼이 열린다(type-to-confirm).
 * 설계 원칙 5: "안전한 파괴적 액션 — type-to-confirm + verb gate".
 */
export function DangerConfirm({ open, title, body, confirmWord, actionLabel, onConfirm, onClose, children }: {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  confirmWord: string;
  actionLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const box = useOverlay(open, onClose);
  const [typed, setTyped] = useState('');
  const id = useId();
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);
  if (!open) return null;
  const ok = typed.trim() === confirmWord;
  return createPortal(
    <>
      <div className="ds-scrim" onClick={onClose} />
      <div className="ds-modal ds-modal--danger" role="alertdialog" aria-modal="true" aria-labelledby={id} ref={box}>
        <header className="ds-modal__head">
          <h2 id={id}>{title}</h2>
        </header>
        <div className="ds-modal__body">
          <p style={{ margin: 0 }}>{body}</p>
          {children}
          <label style={{ display: 'grid', gap: 6, fontSize: 'var(--fs-sm)' }}>
            {ko.danger.typeToConfirm(confirmWord)}
            <input className="ds-input ds-input--mono" value={typed} onChange={(e) => setTyped(e.target.value)} aria-invalid={typed.length > 0 && !ok} autoComplete="off" spellCheck={false} />
          </label>
          {typed.length > 0 && !ok && <span style={{ color: 'var(--danger)', fontSize: 'var(--fs-xs)' }}>{ko.danger.mismatch}</span>}
        </div>
        <footer className="ds-modal__foot">
          <Button onClick={onClose}>{ko.action.cancel}</Button>
          <Button variant="danger" disabled={!ok} onClick={onConfirm}>
            {actionLabel}
          </Button>
        </footer>
      </div>
    </>,
    document.body,
  );
}
