// 대시보드 창 — 새로 만들기·사본·이름 바꾸기·공유(역할)·삭제·기본 레이아웃으로. Jira처럼 가운데 모달.
// 초점은 창 안에 가두고(Tab 순환), Escape로 닫으며, 닫으면 연 단추로 돌아간다. 필요할 때만 읽는 묶음.
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HUMAN_ROLES, ROLE_LABEL, type Role } from '@ff/contracts';
import { ApiError } from '../../../api/client';
import { dashboard } from '../../../copy/dashboard';
import { ErrorNote } from '../../../design';
import type { DialogKind } from './Dashboard';
import { emptyBoard } from './layout';
import type { DashboardsApi } from './store';

const B = dashboard.board;
const D = B.dialog;

function Modal({ title, onClose, children, danger }: { title: string; onClose: () => void; children: ReactNode; danger?: boolean }) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null));
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    el?.focus();
    const ret = back.current;
    return () => ret?.focus?.();
  }, []);
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
    if (e.key !== 'Tab') return;
    const f = [...(box.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input, select, textarea') ?? [])];
    if (!f.length) return;
    const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) {
      e.preventDefault();
      f.at(-1)!.focus();
    } else if (!e.shiftKey && i === f.length - 1) {
      e.preventDefault();
      f[0].focus();
    }
  };
  return createPortal(
    <>
      <div className="jd-blanket" onClick={onClose} />
      <div className="jd-modal" role={danger ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby={id} ref={box} onKeyDown={keys}>
        <header className="jd-modal__head">
          <h2 id={id}>{title}</h2>
        </header>
        {children}
      </div>
    </>,
    document.body,
  );
}

export default function DashboardDialog({ kind, api, onClose, onDone }: { kind: DialogKind; api: DashboardsApi; onClose: () => void; onDone: (msg: string) => void }) {
  const { current } = api;
  const [name, setName] = useState(kind === 'copy' ? B.copyName(current.name) : kind === 'rename' ? current.name : B.newName);
  const [roles, setRoles] = useState<Role[]>(current.sharedRoles);
  const [error, setError] = useState<ApiError | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fid = useId();

  const run = async (fn: () => Promise<unknown> | unknown, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone(done);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', B.saveFailed));
    } finally {
      setBusy(false);
    }
  };
  const actions = (submit: string, opts: { danger?: boolean } = {}) => (
    <footer className="jd-modal__foot">
      <button type="submit" className={opts.danger ? 'jd-btn jd-btn--danger' : 'jd-btn jd-btn--primary'} disabled={busy}>
        {submit}
      </button>
      <button type="button" className="jd-btn jd-btn--subtle" data-close onClick={onClose}>
        {D.cancel}
      </button>
    </footer>
  );

  if (kind === 'create' || kind === 'copy' || kind === 'rename') {
    const title = kind === 'create' ? D.createTitle : kind === 'copy' ? D.copyTitle : D.renameTitle;
    const submit = (e: FormEvent) => {
      e.preventDefault();
      const n = name.trim();
      if (!n) return setNameError(D.nameRequired);
      if (kind === 'rename') return void run(() => api.rename(n), n);
      return void run(() => api.create(n, kind === 'copy' ? current.board : emptyBoard('2')), n);
    };
    return (
      <Modal title={title} onClose={onClose}>
        <form onSubmit={submit} noValidate>
          <div className="jd-modal__body">
            <div className="jd-field">
              <label htmlFor={fid}>{D.name}</label>
              <input id={fid} className="jd-input" value={name} maxLength={80} aria-invalid={!!nameError} aria-describedby={nameError ? `${fid}-e` : undefined} onChange={(e) => (setName(e.target.value), setNameError(null))} />
              {nameError && (
                <p className="jd-field__error" id={`${fid}-e`}>
                  {nameError}
                </p>
              )}
            </div>
            <ErrorNote error={error} />
          </div>
          {actions(kind === 'rename' ? D.save : D.create)}
        </form>
      </Modal>
    );
  }

  if (kind === 'share') {
    const toggle = (r: Role) => setRoles((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]));
    return (
      <Modal title={D.shareTitle(current.name)} onClose={onClose}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.share(HUMAN_ROLES.filter((r) => roles.includes(r))), D.shareTitle(current.name));
          }}
        >
          <div className="jd-modal__body">
            <p>{D.shareLead}</p>
            <fieldset className="jd-fieldset">
              <legend>{D.shareRoles}</legend>
              <div className="jd-checks jd-checks--grid">
                {HUMAN_ROLES.map((r) => (
                  <label key={r} className="jd-check">
                    <input type="checkbox" checked={roles.includes(r)} onChange={() => toggle(r)} />
                    {ROLE_LABEL[r]}
                  </label>
                ))}
              </div>
            </fieldset>
            <ErrorNote error={error} />
          </div>
          {actions(D.save)}
        </form>
      </Modal>
    );
  }

  const remove = kind === 'remove';
  return (
    <Modal title={remove ? D.removeTitle : D.resetTitle} onClose={onClose} danger>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => (remove ? api.remove() : api.resetLayout()), remove ? D.removeTitle : D.resetTitle);
        }}
      >
        <div className="jd-modal__body">
          <p>{remove ? D.removeLead(current.name) : D.resetLead}</p>
          <ErrorNote error={error} />
        </div>
        {actions(remove ? D.remove : D.reset, { danger: true })}
      </form>
    </Modal>
  );
}

