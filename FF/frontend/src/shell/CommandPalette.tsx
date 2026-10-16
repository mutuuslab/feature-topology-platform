// ⌘K / Ctrl+K 이동·실행 — 라우트 표(MENU)의 화면을 이름으로 찾아 이동한다. 키보드만으로 쓴다:
// 입력은 combobox, 결과는 listbox(↑↓로 고르고 Enter로 이동, Esc로 닫고 원래 자리로 포커스 복귀). 설계안 2.1 상단바 ⌘K.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ko } from '../copy/ko';
import { MENU } from '../routes';

const T = ko.shell.palette;

type Item = { label: string; to: string; group?: string };

/** 검색어가 있으면 Feature 검색을 맨 앞에, 화면 이름·그룹·경로가 검색어를 포함하는 메뉴 화면을 뒤에 둔다 */
export function paletteItems(needle: string): Item[] {
  const screens: Item[] = MENU.flatMap((g) => g.items.map((r) => ({ label: r.title, to: r.menu!, group: g.ko })));
  const q = needle.trim();
  if (!q) return screens;
  const low = q.toLowerCase();
  const hit = screens.filter((i) => i.label.toLowerCase().includes(low) || (i.group ?? '').toLowerCase().includes(low) || i.to.toLowerCase().includes(low));
  const feature = q.toUpperCase().startsWith('FEAT-') ? q.toUpperCase() : q;
  return [{ label: T.search(q), to: `/features?q=${encodeURIComponent(feature)}` }, ...hit];
}

export function CommandPalette() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const back = useRef<HTMLElement | null>(null);
  const list = useRef<HTMLUListElement>(null);

  const close = () => {
    setOpen(false);
    setQ('');
    setActive(0);
    back.current?.focus?.();
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => {
          if (!o) back.current = document.activeElement as HTMLElement | null;
          return !o;
        });
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const items = useMemo(() => paletteItems(q), [q]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const go = (i: Item | undefined) => {
    if (!i) return;
    setOpen(false);
    setQ('');
    setActive(0);
    nav(i.to);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, items.length - 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
    else if (e.key === 'Home') (e.preventDefault(), setActive(0));
    else if (e.key === 'End') (e.preventDefault(), setActive(items.length - 1));
    else if (e.key === 'Enter') (e.preventDefault(), go(items[active]));
    else if (e.key === 'Escape') (e.preventDefault(), close());
  };
  const optId = (i: number) => `sh-cmdk-opt-${i}`;

  return (
    <div className="sh-cmdk__backdrop" onClick={close}>
      <div className="sh-cmdk" role="dialog" aria-modal="true" aria-label={T.label} onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="sh-cmdk-list"
          aria-autocomplete="list"
          aria-activedescendant={items.length ? optId(active) : undefined}
          aria-label={T.label}
          placeholder={T.placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <ul id="sh-cmdk-list" role="listbox" aria-label={T.label} ref={list}>
          {items.map((i, n) => (
            <li key={i.to} id={optId(n)} data-index={n} role="option" aria-selected={n === active} className="sh-cmdk__item" onMouseEnter={() => setActive(n)} onClick={() => go(i)}>
              <span>{i.label}</span>
              {i.group && <span className="sh-cmdk__group">{i.group}</span>}
            </li>
          ))}
          {items.length === 0 && <li className="sh-cmdk__none">{T.none}</li>}
        </ul>
        <p className="sh-cmdk__hint">{T.hint}</p>
      </div>
    </div>
  );
}
