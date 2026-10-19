// data-tour 앵커 스포트라이트 — 표준 따라하기(GuideDock)와 업무 절차 따라하기(ProcedureGuide)가 같이 쓴다.
// 대상 요소는 비동기로 그려질 수 있으므로 짧게 폴링하고, 화면 이동·검색어 변경이면 다시 찾는다.
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

export interface SpotRect {
  top: number;
  left: number;
  width: number;
  height: number;
  tight: boolean;
}

export function useSpotlight(anchor: string | null, describedBy: string): SpotRect | null {
  const [rect, setRect] = useState<SpotRect | null>(null);
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (!anchor) {
      setRect(null);
      return;
    }
    let el: Element | null = null;
    let scrolled = false;
    let prevDesc: string | null = null;
    const release = () => {
      if (!el) return;
      el.removeAttribute('data-tour-active');
      if (prevDesc === null) el.removeAttribute('aria-describedby');
      else el.setAttribute('aria-describedby', prevDesc);
    };
    const tick = () => {
      const cur = document.querySelector(`[data-tour="${CSS.escape(anchor)}"]`);
      if (cur !== el) {
        release();
        el = cur;
        if (el) {
          prevDesc = el.getAttribute('aria-describedby');
          el.setAttribute('data-tour-active', 'true');
          el.setAttribute('aria-describedby', [prevDesc, describedBy].filter(Boolean).join(' '));
        }
      }
      if (!el) return setRect((r) => (r ? null : r));
      if (!scrolled) {
        el.scrollIntoView?.({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        scrolled = true;
      }
      const b = el.getBoundingClientRect();
      // 레일·표 안의 칸이면 고리를 촘촘하게 — 바깥 고리가 이웃 칸(G6 상태 점 등)을 가리지 않게
      const next = { top: b.top, left: b.left, width: b.width, height: b.height, tight: !!el.parentElement?.closest('.ds-gates, .ds-table, .ds-kv') };
      setRect((r) => (r && r.top === next.top && r.left === next.left && r.width === next.width && r.height === next.height && r.tight === next.tight ? r : next));
    };
    tick();
    const id = window.setInterval(tick, 400);
    window.addEventListener('resize', tick);
    document.addEventListener('scroll', tick, true);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('resize', tick);
      document.removeEventListener('scroll', tick, true);
      release();
    };
  }, [anchor, describedBy, pathname, search]);
  return rect;
}
