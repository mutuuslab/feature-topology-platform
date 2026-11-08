import { uiLocaleTag } from '../locale/runtime';
// 목록 탐색판 — 왼쪽 분류·출처 트리, 가운데 요약 수치 + 표, 오른쪽 다중 선택 필터(참고: 스프레드시트 BI 작업판).
// 트리·필터·요약은 모두 같은 행 집합에서 센 값을 받는다(화면이 수를 만들지 않는다). Feature DB 목록·개발비 산정 목록이 쓴다.
import { useId, useState, type ReactNode } from 'react';
import { workbook as W } from '../copy/workbook';
import { Icon } from './icons';
import './workbook.css';

export interface WorkbookOption {
  value: string;
  label?: ReactNode;
  /** 화면 읽기용 이름(label이 글자가 아닐 때) */
  text?: string;
  count?: number;
  title?: string;
}
export interface WorkbookFilter {
  key: string;
  label: string;
  options: WorkbookOption[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}
export interface WorkbookTreeItem {
  key: string;
  label: ReactNode;
  text: string;
  count?: number;
  selected?: boolean;
  onSelect: () => void;
  title?: string;
  /** 고른 항목 아래에 펼쳐 보이는 하위 항목 */
  children?: WorkbookTreeItem[];
}
export interface WorkbookTreeGroup {
  key: string;
  label: string;
  items: WorkbookTreeItem[];
  /** 항목이 많으면 이 그룹만 스크롤 */
  scroll?: boolean;
}
export interface WorkbookMetric {
  key: string;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** 맨 앞 큰 칸 */
  lead?: boolean;
}

const nf = (n: number | undefined) => (n === undefined ? '' : n.toLocaleString(uiLocaleTag()));

function TreeItems({ items, depth }: { items: WorkbookTreeItem[]; depth: number }) {
  return (
    <ul className="wb-tree__list" data-depth={depth}>
      {items.map((it) => (
        <li key={it.key}>
          <button type="button" className="wb-tree__item" data-zero={it.count === 0 ? '' : undefined} aria-current={it.selected ? 'true' : undefined} aria-label={W.treeItem(it.text, it.count)} title={it.title} onClick={it.onSelect}>
            <span className="wb-tree__name">{it.label}</span>
            {it.count !== undefined && <span className="wb-tree__count">{nf(it.count)}</span>}
          </button>
          {!!it.children?.length && <TreeItems items={it.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

function FilterGroup({ f }: { f: WorkbookFilter }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const picked = new Set(f.selected);
  const ordered = [...f.options].sort((a, b) => Number(picked.has(b.value)) - Number(picked.has(a.value)) || Number(a.count === 0) - Number(b.count === 0));
  const visible = expanded ? ordered : ordered.slice(0, Math.max(6, picked.size));
  const toggle = (v: string) => f.onChange(picked.has(v) ? f.selected.filter((x) => x !== v) : [...f.selected, v]);
  return (
    <div className="wb-filter" role="group" aria-labelledby={id} data-active={picked.size ? '' : undefined}>
      <div className="wb-filter__head">
        <span id={id} className="wb-filter__title">
          {f.label}
          {picked.size > 0 && <span className="wb-filter__n">{picked.size}</span>}
        </span>
        {picked.size > 0 && (
          <button type="button" className="wb-filter__clear" onClick={() => f.onChange([])} aria-label={`${f.label} ${W.clearAxis}`}>
            {W.clearAxis}
          </button>
        )}
      </div>
      <ul className="wb-filter__list">
        {visible.map((o) => {
          const on = picked.has(o.value);
          const text = o.text ?? (typeof o.label === 'string' ? o.label : o.value);
          return (
            <li key={o.value}>
              <button type="button" className="wb-chip" aria-pressed={on} data-dim={picked.size && !on ? '' : undefined} data-zero={o.count === 0 ? '' : undefined} title={o.title} aria-label={W.chip(f.label, text, o.count)} onClick={() => toggle(o.value)}>
                <span className="wb-chip__label">{o.label ?? o.value}</span>
                {o.count !== undefined && <span className="wb-chip__count">{nf(o.count)}</span>}
                <span className="wb-chip__mark" aria-hidden="true">{on && <Icon name="check" size={14} />}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {ordered.length > Math.max(6, picked.size) && <button className="wb-filter__clear" type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>{expanded ? W.less : W.more(ordered.length - visible.length)}</button>}
    </div>
  );
}

/** onClearAll — 모든 필터를 한 번에 지운다(필터마다 onChange를 부르면 주소 갱신이 겹쳐 마지막 것만 남는다) */
export function Workbook({ label, treeLabel = W.tree, tree, metrics, filters, onClearAll, toolbar, children }: { label: string; treeLabel?: string; tree: WorkbookTreeGroup[]; metrics: WorkbookMetric[]; filters: WorkbookFilter[]; onClearAll: () => void; toolbar?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const treeId = useId();
  const filtersId = useId();
  const applied = filters.flatMap((f) => f.selected.map((v) => ({ f, v, o: f.options.find((o) => o.value === v) })));
  return (
    // 폭은 화면이 아니라 탐색판이 놓인 칸 기준(컨테이너 질의) — 왼쪽 메뉴·패널 여백에 따라 단 수가 바뀐다
    <div className="wb-host">
    <section className="wb" aria-label={label}>
      <nav className="wb-tree" aria-label={treeLabel} data-open={open ? '' : undefined}>
        <button type="button" className="wb-tree__toggle" aria-expanded={open} aria-controls={treeId} onClick={() => setOpen((x) => !x)}>
          <Icon name="chevron" size={14} aria-hidden="true" />
          {W.treeToggle(treeLabel, open)}
        </button>
        <div id={treeId} className="wb-tree__body">
          {tree.map((g) => (
            <div key={g.key} className="wb-tree__group" data-scroll={g.scroll ? '' : undefined}>
              <h3 className="wb-tree__head">{g.label}</h3>
              <TreeItems items={g.items} depth={0} />
            </div>
          ))}
        </div>
      </nav>
      <div className="wb-main">
        {toolbar}
        <dl className="wb-metrics" aria-label={W.metrics}>
          {metrics.map((m) => (
            <div key={m.key} className="wb-metric" data-lead={m.lead ? '' : undefined} data-metric={m.key}>
              <dt>{m.label}</dt>
              <dd>
                {m.value}
                {m.hint && <small>{m.hint}</small>}
              </dd>
            </div>
          ))}
        </dl>
        {applied.length > 0 && (
          <div className="wb-applied" role="group" aria-label={W.applied}>
            <span className="wb-applied__label">{W.applied}</span>
            {applied.map(({ f, v, o }) => {
              const text = o?.text ?? (typeof o?.label === 'string' ? o.label : v);
              return (
                <button key={`${f.key}:${v}`} type="button" className="wb-applied__chip" aria-label={W.removeChip(f.label, text)} onClick={() => f.onChange(f.selected.filter((x) => x !== v))}>
                  <span className="wb-applied__axis">{f.label}</span>
                  {o?.label ?? v}
                  <Icon name="close" size={12} aria-hidden="true" />
                </button>
              );
            })}
            <button type="button" className="wb-applied__clear" onClick={onClearAll}>
              {W.clearAll}
            </button>
          </div>
        )}
        <p className="wb-scroll-hint">{W.tableHint}</p>
        <div className="wb-table">{children}</div>
      </div>
      <aside className="wb-filters" aria-label={W.filters} data-open={filtersOpen ? '' : undefined}>
        <button type="button" className="wb-filters__toggle" aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => setFiltersOpen((x) => !x)}>
          <Icon name="filter" size={14} aria-hidden="true" />
          {W.filtersToggle(filtersOpen, applied.length)}
        </button>
        <div id={filtersId} className="wb-filters__body">
          <p className="wb-filters__hint">{W.filtersHint}</p>
          {filters.map((f) => (
            <FilterGroup key={f.key} f={f} />
          ))}
        </div>
      </aside>
    </section>
    </div>
  );
}
