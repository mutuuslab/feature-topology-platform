// Optional tab-strip tools are read after the native tabs; keep the first-screen bundle within its existing budget.
import { useEffect, useState, type RefObject } from 'react';
import { ko } from '../copy/ko';
import { Button } from './primitives';

export default function TabsOverflow({ strip, stripId, count }: { strip: RefObject<HTMLDivElement>; stripId: string; count: number }) {
  const [overflow, setOverflow] = useState({ before: false, after: false });
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const update = () => {
      const before = el.scrollLeft > 1;
      const after = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setOverflow((old) => old.before === before && old.after === after ? old : { before, after });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    Array.from(el.children).forEach((child) => observer?.observe(child));
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
    return () => { observer?.disconnect(); el.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [strip, count]);
  const move = (direction: number) => {
    const el = strip.current;
    el?.scrollBy({ left: direction * Math.max(100, el.clientWidth * 0.75), behavior: 'auto' });
  };
  if (!overflow.before && !overflow.after) return null;
  return <span className="ds-tabs-scroll-controls">
    <Button variant="ghost" icon="chevronLeft" className="ds-tabs-scroll" aria-label={ko.design.previousTabs} title={ko.design.previousTabs} aria-controls={stripId} disabled={!overflow.before} onClick={() => move(-1)} />
    <Button variant="ghost" icon="chevron" className="ds-tabs-scroll" aria-label={ko.design.nextTabs} title={ko.design.nextTabs} aria-controls={stripId} disabled={!overflow.after} onClick={() => move(1)} />
  </span>;
}
