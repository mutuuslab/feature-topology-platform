// 가젯 디렉터리 — Jira 편집 모드 오른쪽 패널: 검색, 분류(차트·목록·운영·바로 가기), 카드(아이콘·설명·추가).
// 같은 종류도 여러 번 추가할 수 있다(설정만 달리). 필요할 때만 읽는 묶음.
import { useEffect, useId, useRef, useState } from 'react';
import { dashboard } from '../../../copy/dashboard';
import { GADGET_TYPES, typeTitle, type Category } from './catalog';
import { CategoryIcon, Glyph } from './icons';
import { countOf, type Board } from './layout';

const D = dashboard.board.directory;
const T = dashboard.board.types as Record<string, { title: string; description: string }>;
const CATS: ('all' | Category)[] = ['all', 'charts', 'lists', 'ops', 'shortcuts'];

export default function Directory({ board, onAdd, onClose }: { board: Board; onAdd: (type: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<'all' | Category>('all');
  const hid = useId();
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => search.current?.focus({ preventScroll: true }), []);
  const needle = q.trim().toLowerCase();
  const list = GADGET_TYPES.filter((g) => (cat === 'all' || g.category === cat) && (!needle || `${T[g.type].title} ${T[g.type].description}`.toLowerCase().includes(needle)));
  return (
    <aside className="jd-directory" aria-labelledby={hid}>
      <header className="jd-directory__head">
        <h2 id={hid}>{D.title}</h2>
        <button type="button" className="jd-iconbtn" aria-label={D.close} title={D.close} onClick={onClose}>
          <Glyph name="close" />
        </button>
      </header>
      <div className="jd-search">
        <Glyph name="search" />
        <input ref={search} type="search" className="jd-input" placeholder={D.search} aria-label={D.search} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="jd-cats" role="group" aria-label={D.title}>
        {CATS.map((c) => (
          <button key={c} type="button" aria-pressed={cat === c} className="jd-cat" onClick={() => setCat(c)}>
            {D.categories[c]}
          </button>
        ))}
      </div>
      <p className="jd-directory__count" aria-live="polite">
        {list.length ? D.count(list.length) : D.none}
      </p>
      <ul className="jd-cards">
        {list.map((g) => {
          const n = countOf(board, g.type);
          return (
            <li key={g.type} className="jd-card" data-gadget-entry={g.type}>
              <CategoryIcon category={g.category} />
              <div className="jd-card__text">
                <strong>{typeTitle(g.type)}</strong>
                <p>{T[g.type].description}</p>
                {n > 0 && <p className="jd-card__inuse">{D.inUse(n)}</p>}
              </div>
              <button type="button" className="jd-btn" aria-label={D.addAria(typeTitle(g.type))} onClick={() => onAdd(g.type)}>
                {D.add}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
