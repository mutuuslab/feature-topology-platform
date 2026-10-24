// Jira 대시보드식 가젯 판 — 열 레이아웃 위의 가젯을 머리(⋮⋮)로 끌어 옮기고, 가젯 추가·빼기·접기, 레이아웃(1·2·2L·3열)을 바꾼다.
// 끌기를 못 쓰는 사용자는 가젯마다 배치 메뉴(위·아래·왼쪽·오른쪽 열)로 같은 배치를 만든다(WCAG 2.5.7 끌기 대안). 배치는 역할별로 저장한다.
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { dashboard } from '../../../copy/dashboard';
import { Button, Drawer, Segmented } from '../../../design';
import { DEFAULT_BOARD, GADGET_IDS, GADGETS, gadgetById } from './gadgets';
import { add, COLUMN_COUNT, dropIndex, LAYOUTS, loadBoard, locate, move, moveBy, placed, remove, resetBoard, saveBoard, setLayout, toggleCollapsed, type Board, type Direction, type LayoutKind } from './layout';
import './Dashboard.css';

const B = dashboard.board;
const MIME = 'application/x-ff-gadget';

/** 역할별 배치 — 역할을 바꾸면 그 역할의 배치를 읽는다 */
export function useBoard(role: string) {
  const [board, setBoard] = useState<Board>(() => loadBoard(role, GADGET_IDS, DEFAULT_BOARD));
  const [forRole, setForRole] = useState(role);
  if (forRole !== role) {
    setForRole(role);
    setBoard(loadBoard(role, GADGET_IDS, DEFAULT_BOARD));
  }
  const update = (fn: (b: Board) => Board) =>
    setBoard((b) => {
      const next = fn(b);
      if (next !== b) saveBoard(role, next);
      return next;
    });
  const reset = () => {
    resetBoard(role);
    setBoard(DEFAULT_BOARD);
  };
  return { board, update, reset };
}

/** 지금 그려진 가젯 높이 — 열을 늘릴 때 높이로 나누는 데 쓴다 */
const measureGadgets = () => Object.fromEntries([...document.querySelectorAll<HTMLElement>('.db-board [data-gadget]')].map((el) => [el.dataset.gadget!, el.offsetHeight || 1]));

/** 머리 오른쪽 도구 — 레이아웃·가젯 추가·기본 배치 */
export function DashboardTools({ board, update, reset, onAdd }: ReturnType<typeof useBoard> & { onAdd: () => void }) {
  return (
    <div className="db-tools">
      <Segmented label={B.layout} options={LAYOUTS.map((l) => ({ value: l, label: B.layouts[l] }))} value={board.layout} onChange={(v) => update((b) => setLayout(b, v as LayoutKind, measureGadgets()))} />
      <Button variant="ghost" onClick={reset} data-ui="dashboard-reset">
        {B.reset}
      </Button>
      <Button onClick={onAdd} data-ui="dashboard-add">
        {B.add}
      </Button>
    </div>
  );
}

/** 가젯 추가 창 — Jira의 가젯 디렉터리. 이미 놓인 가젯은 '추가됨' */
export function GadgetDirectory({ open, onClose, board, update }: { open: boolean; onClose: () => void } & Pick<ReturnType<typeof useBoard>, 'board' | 'update'>) {
  const on = new Set(placed(board));
  // 추가할 수 있는 가젯을 먼저 — 이미 놓인 가젯은 아래에 흐리게
  const list = [...GADGETS].sort((a, b) => Number(on.has(a.id)) - Number(on.has(b.id)));
  return (
    <Drawer open={open} title={B.directory} onClose={onClose}>
      <p className="ds-field__hint">{B.directoryLead}</p>
      <ul className="db-directory">
        {list.map((g) => (
          <li key={g.id} data-gadget-entry={g.id} data-added={on.has(g.id) ? '' : undefined}>
            <div>
              <strong>{g.title}</strong>
              <p className="ds-field__hint">{g.description}</p>
            </div>
            {on.has(g.id) ? (
              <span className="db-directory__added">
                <svg viewBox="0 0 16 16" aria-hidden>
                  <path d="M3 8.5l3 3 7-7" />
                </svg>
                {B.added}
              </span>
            ) : (
              <Button onClick={() => update((b) => add(b, g.id))} aria-label={`${g.title} ${B.addOne}`}>
                {B.addOne}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Drawer>
  );
}

export function DashboardBoard({ role, board, update }: { role: string } & Pick<ReturnType<typeof useBoard>, 'board' | 'update'>) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<{ col: number; index: number } | null>(null);
  const [announce, setAnnounce] = useState('');
  const cols = useRef<(HTMLDivElement | null)[]>([]);

  const over = (col: number) => (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // 놓는 자리 — 끌고 있는 가젯을 뺀 가젯들의 세로 가운데와 비교한다(자리 표시가 흔들리지 않게)
    const items = [...(cols.current[col]?.querySelectorAll<HTMLElement>(':scope > [data-gadget]') ?? [])];
    const mids = items.map((el) => (el.dataset.gadget === dragging ? Number.NaN : el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2));
    let index = dropIndex(mids.filter((m) => !Number.isNaN(m)), e.clientY);
    // 걸러 낸 끌린 가젯 자리를 원래 열 순서로 되돌린다
    const self = items.findIndex((el) => el.dataset.gadget === dragging);
    if (self >= 0 && index >= self) index++;
    if (!target || target.col !== col || target.index !== index) setTarget({ col, index });
  };
  const drop = (col: number) => (e: DragEvent) => {
    const id = e.dataTransfer.getData(MIME);
    e.preventDefault();
    if (id && target?.col === col) commit(id, col, target.index);
    end();
  };
  const end = () => {
    setDragging(null);
    setTarget(null);
  };
  const commit = (id: string, col: number, index: number) => {
    const next = move(board, id, col, index);
    update(() => next);
    const at = locate(next, id);
    if (at) setAnnounce(B.moved(gadgetById(id)?.title ?? id, at.col + 1, at.index + 1));
  };
  const menuMove = (id: string, dir: Direction) => {
    const next = moveBy(board, id, dir);
    if (next === board) return;
    update(() => next);
    const at = locate(next, id)!;
    setAnnounce(B.moved(gadgetById(id)?.title ?? id, at.col + 1, at.index + 1));
  };

  return (
    <>
      <div className="db-board" data-layout={board.layout} data-dragging={dragging ? '' : undefined} style={{ ['--db-cols' as string]: COLUMN_COUNT[board.layout] }}>
        {board.columns.map((ids, col) => (
          <div key={col} className="db-col" data-col={col} data-over={dragging && target?.col === col ? '' : undefined} ref={(el) => void (cols.current[col] = el)} onDragOver={over(col)} onDrop={drop(col)} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setTarget(null)}>
            {ids.map((id, index) => (
              <Slot key={id} show={!!dragging && target?.col === col && target.index === index}>
                <GadgetFrame id={id} role={role} board={board} col={col} index={index} onToggle={() => update((b) => toggleCollapsed(b, id))} onRemove={() => update((b) => remove(b, id))} onMove={(d) => menuMove(id, d)} onDragStart={() => setDragging(id)} onDragEnd={end} dragging={dragging === id} />
              </Slot>
            ))}
            {!!dragging && target?.col === col && target.index >= ids.length && <div className="db-drop" aria-hidden>{B.dropHere}</div>}
            {!ids.length && !(dragging && target?.col === col) && <p className="db-col__empty">{B.emptyColumn}</p>}
          </div>
        ))}
      </div>
      <p className="db-sr" aria-live="polite">{announce}</p>
    </>
  );
}

function Slot({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <>
      {show && <div className="db-drop" aria-hidden>{B.dropHere}</div>}
      {children}
    </>
  );
}

function GadgetFrame({ id, role, board, col, index, onToggle, onRemove, onMove, onDragStart, onDragEnd, dragging }: {
  id: string;
  role: string;
  board: Board;
  col: number;
  index: number;
  onToggle: () => void;
  onRemove: () => void;
  onMove: (d: Direction) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  const g = gadgetById(id)!;
  const ref = useRef<HTMLElement>(null);
  const collapsed = board.collapsed.includes(id);
  const last = board.columns[col].length - 1;
  const moves: [Direction, string, boolean][] = [
    ['up', B.up, index > 0],
    ['down', B.down, index < last],
    ['left', B.left, col > 0],
    ['right', B.right, col < board.columns.length - 1],
  ];
  return (
    <section ref={ref} className="ds-panel db-gadget" data-gadget={id} data-dragging={dragging ? '' : undefined} aria-labelledby={`gadget-${id}-h`}>
      <header className="ds-panel__head db-gadget__head">
        <span
          className="db-grip"
          draggable
          role="img"
          aria-label={B.drag(g.title)}
          title={B.drag(g.title)}
          onDragStart={(e) => {
            e.dataTransfer.setData(MIME, id);
            e.dataTransfer.effectAllowed = 'move';
            if (ref.current) e.dataTransfer.setDragImage(ref.current, 24, 16);
            onDragStart();
          }}
          onDragEnd={onDragEnd}
        >
          <svg viewBox="0 0 12 16" aria-hidden>
            {[3, 8, 13].flatMap((y) => [<circle key={`a${y}`} cx="3.5" cy={y} r="1.4" />, <circle key={`b${y}`} cx="8.5" cy={y} r="1.4" />])}
          </svg>
        </span>
        <div className="db-gadget__title">
          <h2 id={`gadget-${id}-h`}>{g.title}</h2>
        </div>
        {g.link && <Link to={g.link.to} className="db-gadget__link">{g.link.label}</Link>}
        <GadgetMenu title={g.title} collapsed={collapsed} moves={moves} onToggle={onToggle} onRemove={onRemove} onMove={onMove} />
      </header>
      {!collapsed && (
        <div className="ds-panel__body">
          {g.eyebrow && <p className="db-gadget__sub">{g.eyebrow(role)}</p>}
          <g.Body role={role} />
        </div>
      )}
    </section>
  );
}

function GadgetMenu({ title, collapsed, moves, onToggle, onRemove, onMove }: { title: string; collapsed: boolean; moves: [Direction, string, boolean][]; onToggle: () => void; onRemove: () => void; onMove: (d: Direction) => void }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toggle = () => {
    // 메뉴 높이(항목 6개 ≈ 220px)가 화면 아래에 들어가지 않으면 위로 연다
    const r = box.current?.getBoundingClientRect();
    setUp(!!r && r.bottom + 232 > window.innerHeight && r.top > 232);
    setOpen((x) => !x);
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const run = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };
  return (
    <div className="db-menu" ref={box}>
      <button type="button" className="db-menu__btn" aria-haspopup="menu" aria-expanded={open} aria-label={B.menu(title)} title={B.menu(title)} onClick={toggle}>
        <svg viewBox="0 0 16 4" aria-hidden>
          <circle cx="2" cy="2" r="1.6" />
          <circle cx="8" cy="2" r="1.6" />
          <circle cx="14" cy="2" r="1.6" />
        </svg>
      </button>
      {open && (
        <div className="db-menu__list" role="menu" aria-label={B.menu(title)} data-up={up ? '' : undefined}>
          <button type="button" role="menuitem" onClick={run(onToggle)}>
            {collapsed ? B.expand : B.collapse}
          </button>
          {moves.map(([d, label, ok]) => (
            <button key={d} type="button" role="menuitem" disabled={!ok} onClick={run(() => onMove(d))}>
              {label}
            </button>
          ))}
          <button type="button" role="menuitem" className="db-menu__danger" onClick={run(onRemove)}>
            {B.remove}
          </button>
        </div>
      )}
    </div>
  );
}
