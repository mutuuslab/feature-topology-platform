// 공개 시연 사이트(정적) — '시연 데이터 초기화' 확인 창. 이 브라우저의 시연 데이터(api/sim 오버레이)를 버리고 모든 조회를 다시 읽는다.
// 셸이 누를 때만 불러온다(첫 화면 묶음 밖)
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { loadSim } from '../api/client';
import { ko } from '../copy/ko';
import { sim as S } from '../copy/sim';
import { Button } from '../design';

export default function DemoReset({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  const reset = async () => {
    setBusy(true);
    await (await loadSim()).resetSim();
    await qc.invalidateQueries();
    setBusy(false);
    onClose();
  };
  return createPortal(
    <>
      <div className="ds-scrim" onClick={onClose} />
      <div className="ds-modal" role="alertdialog" aria-modal="true" aria-labelledby={id} ref={box} data-testid="demo-reset">
        <header className="ds-modal__head">
          <h2 id={id}>{S.resetTitle}</h2>
        </header>
        <div className="ds-modal__body">
          <p style={{ margin: 0 }}>{S.resetBody}</p>
        </div>
        <footer className="ds-modal__foot">
          <Button onClick={onClose}>{ko.action.cancel}</Button>
          <Button variant="danger" disabled={busy} onClick={() => void reset()}>
            {S.resetAction}
          </Button>
        </footer>
      </div>
    </>,
    document.body,
  );
}
