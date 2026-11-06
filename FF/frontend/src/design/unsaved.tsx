// 저장하지 않은 변경 보호(출시 준비 RD-UX-02) — 편집 중인 화면·창이 useUnsavedGuard(dirty)로 알리면
//   ① 앱 안 링크를 누를 때 확인 창을 띄운다(계속 편집 / 버리고 이동) — BrowserRouter라 useBlocker 대신 문서 클릭을 캡처 단계에서 가로챈다
//   ② 새로 고침·창 닫기는 브라우저 기본 확인(beforeunload)
// 프로그램으로 하는 이동(저장 뒤 상세로 가기 등)은 막지 않는다 — 사용자가 고른 이동만 묻는다. 창(Drawer) 닫기는 overlay.tsx가 dirty로 묻는다.
import { useEffect, useId, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { unsaved as U } from '../copy/unsaved';
import { Button } from './primitives';

const dirty = new Set<string>();
let pending: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/** 지금 저장하지 않은 변경이 있는가 */
export const hasUnsaved = () => dirty.size > 0;

/** 이 화면·창에 저장하지 않은 변경이 있으면 true를 넘긴다 */
export function useUnsavedGuard(isDirty: boolean) {
  const id = useId();
  useEffect(() => {
    if (!isDirty) return;
    dirty.add(id);
    return () => {
      dirty.delete(id);
    };
  }, [id, isDirty]);
}

/** 앱 안 링크인가 — 같은 출처, 새 창·내려받기·보조 키가 아님 */
function inAppLink(e: MouseEvent): HTMLAnchorElement | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || a.target && a.target !== '_self' || a.hasAttribute('download')) return null;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return null;
  // 같은 화면 안 이동(#조각)만 바뀌면 묻지 않는다
  if (url.pathname === location.pathname && url.search === location.search) return null;
  return a;
}

/** 셸에 한 번 — 링크 가로채기·창 닫기 확인·확인 창 */
export function UnsavedPrompt() {
  const nav = useNavigate();
  const to = useSyncExternalStore(subscribe, () => pending, () => null);
  const titleId = useId();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!hasUnsaved()) return;
      const a = inAppLink(e);
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      const url = new URL(a.href, location.href);
      const base = import.meta.env.BASE_URL.replace(/\/$/, '');
      pending = (url.pathname.startsWith(base) ? url.pathname.slice(base.length) || '/' : url.pathname) + url.search + url.hash;
      emit();
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsaved()) return;
      e.preventDefault();
      // 옛 Chromium은 returnValue가 있어야 확인 창을 띄운다
      e.returnValue = '';
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pending) ((pending = null), emit());
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);
  if (!to) return null;
  const stay = () => ((pending = null), emit());
  const leave = () => {
    const dest = to;
    dirty.clear();
    pending = null;
    emit();
    nav(dest);
  };
  return createPortal(
    <>
      <div className="ds-scrim" onClick={stay} />
      <div className="ds-modal" role="alertdialog" aria-modal="true" aria-labelledby={titleId} data-unsaved-prompt>
        <header className="ds-modal__head">
          <h2 id={titleId}>{U.title}</h2>
        </header>
        <div className="ds-modal__body">
          <p>{U.body}</p>
        </div>
        <footer className="ds-modal__foot">
          <Button onClick={leave} variant="danger">
            {U.leave}
          </Button>
          <Button variant="primary" onClick={stay} autoFocus>
            {U.stay}
          </Button>
        </footer>
      </div>
    </>,
    document.body,
  );
}
