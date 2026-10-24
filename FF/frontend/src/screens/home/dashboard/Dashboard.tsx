// Jira(Atlassian) 대시보드 — 머리(이름·바꾸기·별·편집·더 보기·새로 고침), 보기 모드와 편집 모드, 가젯 인스턴스·구성.
//  · 보기 모드: 손잡이 없는 깨끗한 카드. 제목 줄 ⋯ 메뉴로 새로 고침·최소화·최대화·구성·삭제
//  · 편집 모드: '편집 중' 띠(완료) · 레이아웃 썸네일 · 열마다 점선 놓을 자리 · 오른쪽 가젯 디렉터리
//  · 끌기를 못 쓰면 가젯 메뉴의 이동(위·아래·왼쪽·오른쪽 열) — WCAG 2.5.7. 바뀐 배치는 aria-live로 알린다
// 가젯 본문·디렉터리·구성 양식·창은 필요할 때 읽는다(첫 화면 묶음 예산). 저장은 store.ts(서버 우선, 정적 데모는 이 브라우저).
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState, type ComponentType, type CSSProperties, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type LazyExoticComponent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ROLE_LABEL } from '@ff/contracts';
import { dashboard } from '../../../copy/dashboard';
import { ErrorNote, PageHeader, type KeyMessageSpec } from '../../../design';
import { gadgetTitle, typeDef, type BodyModule } from './catalog';
import { Glyph, LayoutThumb } from './icons';
import { addGadget, configureGadget, COLUMN_COUNT, dropIndex, LAYOUTS, locate, move, moveBy, removeGadget, setLayout, setRefresh, toggleMinimized, type Board, type Direction, type Gadget, type GadgetConfig, type LayoutKind, type Refresh } from './layout';
import { useDashboards, type Dash, type DashboardsApi } from './store';
import '../../../design/lozenge.css';
import './Dashboard.css';

const B = dashboard.board;
const G = B.gadget;
const MIME = 'application/x-ff-gadget';

// ── 필요할 때 읽는 묶음 ──
const BODIES: Record<BodyModule, LazyExoticComponent<ComponentType<GadgetBodyProps>>> = {
  lists: lazy(() => import('./bodies-lists')),
  charts: lazy(() => import('./bodies-charts')),
  ops: lazy(() => import('./bodies-ops')),
};
const GadgetConfigForm = lazy(() => import('./GadgetConfig'));
const Directory = lazy(() => import('./Directory'));
const DashboardDialog = lazy(() => import('./DashboardDialogs'));

export interface GadgetBodyProps {
  gadget: Gadget;
  role: string;
  /** 본문이 넓게(최대화) 그려지는가 */
  wide: boolean;
}

export type DialogKind = 'create' | 'copy' | 'rename' | 'share' | 'remove' | 'reset';

/** 몇 분 전 — 30초마다 다시 센다 */
function useMinutesSince(at: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.floor((now - at) / 60_000));
}

/** 가젯이 읽는 조회를 다시 읽는다 — 가젯·대시보드 새로 고침과 자동 새로 고침이 쓴다 */
function useRefreshApis() {
  const qc = useQueryClient();
  return useCallback((names: string[]) => Promise.all([...new Set(names)].map((n) => qc.invalidateQueries({ queryKey: [n] }))).then(() => undefined), [qc]);
}

// ───────── 메뉴(⋯·바꾸기) — 화살표·Home/End·Escape, 바깥을 누르면 닫고 단추로 초점을 돌린다 ─────────

const MenuCtx = createContext<() => void>(() => undefined);

function Menu({ label, button, children, className = 'jd-iconbtn', align = 'end', id }: { label: string; button: ReactNode; children: ReactNode; className?: string; align?: 'start' | 'end'; id?: string }) {
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const open = pos !== null;
  const close = useCallback((focus = true) => {
    setPos(null);
    if (focus) btn.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    // 첫 항목 초점은 화면을 굴리지 않는다 — 굴리면 아래의 '화면이 움직이면 닫기'가 바로 메뉴를 닫았다(화면 아래쪽 가젯)
    list.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    const out = (e: MouseEvent) => !list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node) && close(false);
    // 펼친 채로 화면이 움직이면 단추에서 떨어진다 — 닫는다. 초점이 메뉴 안에 있었으면 단추로 돌려 초점을 잃지 않게
    const away = (e: Event) => !list.current?.contains(e.target as Node) && close(!!list.current?.contains(document.activeElement));
    document.addEventListener('mousedown', out);
    window.addEventListener('resize', away);
    document.addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('mousedown', out);
      window.removeEventListener('resize', away);
      document.removeEventListener('scroll', away, true);
    };
  }, [open, close]);
  const toggle = () => {
    if (open) return close(false);
    // 메뉴는 문서 끝에 그린다(카드 경계에 잘리지 않게) — 단추 아래, 화면 아래가 모자라면 위로
    const r = btn.current!.getBoundingClientRect();
    const up = r.bottom + 320 > window.innerHeight && r.top > 320;
    const side = align === 'end' ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.max(8, r.left) };
    setPos({ position: 'fixed', ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }), ...side });
  };
  const keys = (e: ReactKeyboardEvent) => {
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? items[0] : items.at(-1))?.focus();
    } else if (e.key === 'Tab') close();
  };
  return (
    <span className="jd-menu">
      <button ref={btn} type="button" id={id} className={className} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={toggle}>
        {button}
      </button>
      {open &&
        createPortal(
          <div className="jd-menu__list" role="menu" aria-label={label} ref={list} style={pos} onKeyDown={keys}>
            <MenuCtx.Provider value={close}>{children}</MenuCtx.Provider>
          </div>,
          document.body,
        )}
    </span>
  );
}

function MenuItem({ onSelect, disabled, danger, children, checked, title }: { onSelect: () => void; disabled?: boolean; danger?: boolean; children: ReactNode; checked?: boolean; title?: string }) {
  const close = useContext(MenuCtx);
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      disabled={disabled}
      title={title}
      className={danger ? 'jd-menu__item jd-menu__item--danger' : 'jd-menu__item'}
      onClick={() => {
        close();
        onSelect();
      }}
    >
      {checked !== undefined && <span className="jd-menu__check">{checked && <Glyph name="check" size={14} />}</span>}
      {children}
    </button>
  );
}

function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="jd-menu__group">
      <p className="jd-menu__label" aria-hidden>
        {label}
      </p>
      {children}
    </div>
  );
}

// ───────── 대시보드 화면 ─────────

export function DashboardPage({ role, message, lead }: { role: string; message: KeyMessageSpec; lead?: string }) {
  const api = useDashboards(role);
  const { current } = api;
  const [editing, setEditing] = useState(false);
  const [directory, setDirectory] = useState(false);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [maximized, setMaximized] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<Set<string>>(() => new Set());
  const [announce, setAnnounce] = useState('');
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now());
  const minutes = useMinutesSince(refreshedAt);
  const refreshApis = useRefreshApis();
  const editBtn = useRef<HTMLButtonElement>(null);
  const editHead = useRef<HTMLHeadingElement>(null);
  const [focusGadget, setFocusGadget] = useState<string | null>(null);
  // 남의 판(시스템·공유)에서 최소화는 이 화면에서만(저장하지 않는다)
  const [localMin, setLocalMin] = useState<Set<string>>(() => new Set());
  const [forDash, setForDash] = useState(current.id);
  if (forDash !== current.id) {
    setForDash(current.id);
    setMaximized(null);
    setConfiguring(new Set());
    setLocalMin(new Set());
    if (!current.mine) setEditing(false);
  }
  const board = current.board;

  const say = (text: string) => setAnnounce(text);
  const titleOf = (id: string) => {
    const g = board.gadgets[id];
    return g ? gadgetTitle(g.type, g.config) : id;
  };

  const refreshAll = () => {
    void refreshApis(Object.values(board.gadgets).flatMap((g) => typeDef(g.type)?.apis(g.config) ?? []));
    setRefreshedAt(Date.now());
  };

  /** 편집 — 내 판이 아니면 사본을 먼저 만든다(Jira: 시스템 대시보드는 사본으로) */
  const startEdit = async () => {
    if (!current.mine) {
      const name = B.copyName(current.name);
      await api.create(name, current.board);
      say(B.copied(name));
    } else say(B.enteredEdit);
    setEditing(true);
    setDirectory(true);
    requestAnimationFrame(() => editHead.current?.focus());
  };
  const finishEdit = () => {
    setEditing(false);
    setDirectory(false);
    say(B.leftEdit);
    requestAnimationFrame(() => editBtn.current?.focus());
  };

  const add = (type: string) => {
    const def = typeDef(type);
    if (!def) return;
    const r = addGadget(board, type, def.defaults, { configured: !def.needsConfig });
    api.updateBoard(() => r.board);
    if (def.needsConfig) setConfiguring((s) => new Set(s).add(r.id));
    setFocusGadget(r.id);
    say(G.added(gadgetTitle(type, def.defaults)));
  };

  const removeOne = (id: string) => {
    const title = titleOf(id);
    const at = locate(board, id);
    const next = removeGadget(board, id);
    api.updateBoard(() => next);
    setConfiguring((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    if (maximized === id) setMaximized(null);
    say(G.removed(title));
    // 초점은 같은 열의 다음(없으면 앞) 가젯 제목으로, 열이 비면 편집 띠로
    const col = at ? next.columns[at.col] : [];
    const neighbour = at ? (col[at.index] ?? col[at.index - 1]) : undefined;
    requestAnimationFrame(() => (neighbour ? document.getElementById(`gadget-${neighbour}-h`) : editing ? editHead.current : editBtn.current)?.focus());
  };

  const saveConfig = (id: string, config: GadgetConfig, refresh: Refresh) => {
    api.updateBoard((b) => setRefresh(configureGadget(b, id, config), id, refresh));
    setConfiguring((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    say(G.configured(gadgetTitle(board.gadgets[id]?.type ?? id, config)));
    requestAnimationFrame(() => document.getElementById(`gadget-${id}-h`)?.focus());
  };
  const cancelConfig = (id: string) => {
    const g = board.gadgets[id];
    if (g && !g.configured) return removeOne(id);
    setConfiguring((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    requestAnimationFrame(() => document.getElementById(`gadget-${id}-h`)?.focus());
  };

  const toggleMin = (id: string) => {
    if (current.mine) api.updateBoard((b) => toggleMinimized(b, id));
    else
      setLocalMin((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
  };

  const moveTo = (id: string, next: Board) => {
    if (next === board) return;
    api.updateBoard(() => next);
    const at = locate(next, id);
    if (at) say(G.moved(titleOf(id), at.col + 1, at.index + 1));
  };

  const frame = (g: Gadget, col: number, index: number, opts: { maxed?: boolean } = {}) => (
    <GadgetCard
      key={g.id}
      gadget={g}
      role={role}
      editing={editing}
      editable={current.mine}
      col={col}
      index={index}
      board={board}
      minimized={current.mine ? g.minimized : localMin.has(g.id)}
      maximized={!!opts.maxed}
      configuring={!g.configured || configuring.has(g.id)}
      autoFocus={focusGadget === g.id}
      onFocused={() => setFocusGadget(null)}
      onMove={(d) => moveTo(g.id, moveBy(board, g.id, d))}
      onToggleMin={() => toggleMin(g.id)}
      onMaximize={() => setMaximized(opts.maxed ? null : g.id)}
      onConfigure={() => setConfiguring((s) => new Set(s).add(g.id))}
      onSave={(c, r) => saveConfig(g.id, c, r)}
      onCancel={() => cancelConfig(g.id)}
      onRemove={() => removeOne(g.id)}
      refreshApis={refreshApis}
    />
  );

  const maxedGadget = maximized ? board.gadgets[maximized] : undefined;

  return (
    <div className="ds-screen jd" data-mode={editing ? 'edit' : 'view'}>
      <PageHeader
        title={
          <>
            {current.name}
            <TitleTools api={api} onCreate={() => setDialog('create')} />
          </>
        }
        message={message}
        lead={lead}
        meta={<DashboardMeta api={api} />}
        actions={!editing ? <HeaderActions api={api} minutes={minutes} onRefresh={refreshAll} onEdit={() => void startEdit()} onDialog={setDialog} editBtn={editBtn} /> : undefined}
      />
      {editing && (
        <div className="jd-editbar" role="region" aria-labelledby="jd-editbar-h">
          <h2 id="jd-editbar-h" ref={editHead} tabIndex={-1}>
            {B.editing}
          </h2>
          <p className="jd-editbar__hint">{B.editingHint}</p>
          <LayoutPicker value={board.layout} onChange={(l) => api.updateBoard((b) => setLayout(b, l, measureGadgets()))} />
          <button type="button" className="jd-btn" aria-pressed={directory} onClick={() => setDirectory((x) => !x)}>
            <Glyph name="plus" />
            {B.addGadget}
          </button>
          <button type="button" className="jd-btn jd-btn--primary" onClick={finishEdit}>
            {B.done}
          </button>
        </div>
      )}
      {api.saveError && (
        <div className="jd-save-error">
          <ErrorNote error={api.saveError} />
        </div>
      )}
      {api.listError && <ErrorNote error={api.listError} />}
      <div className="jd-stage" data-directory={editing && directory ? '' : undefined}>
        {api.loading ? (
          <div className="ds-skel" data-state="loading" aria-busy="true">
            <span />
            <span />
            <span />
          </div>
        ) : maxedGadget ? (
          <div className="jd-maxed">
            <button type="button" className="jd-btn jd-btn--subtle" onClick={() => setMaximized(null)}>
              {G.back}
            </button>
            {frame(maxedGadget, locate(board, maxedGadget.id)?.col ?? 0, locate(board, maxedGadget.id)?.index ?? 0, { maxed: true })}
          </div>
        ) : (
          <BoardGrid board={board} editing={editing} onMove={moveTo} render={frame} empty={!Object.keys(board.gadgets).length} />
        )}
        {editing && directory && (
          <Suspense fallback={<aside className="jd-directory" aria-busy="true" />}>
            <Directory board={board} onAdd={add} onClose={() => setDirectory(false)} />
          </Suspense>
        )}
      </div>
      <p className="ds-sr" aria-live="polite">
        {announce}
      </p>
      {dialog && (
        <Suspense fallback={null}>
          <DashboardDialog kind={dialog} api={api} onClose={() => setDialog(null)} onDone={say} />
        </Suspense>
      )}
    </div>
  );
}

/** 이름 옆 — 별·바꾸기(H1 글자는 이름만: 페이지 제목·3초 테스트) */
function TitleTools({ api, onCreate }: { api: DashboardsApi; onCreate: () => void }) {
  const { current } = api;
  const mine = api.items.filter((d) => d.mine);
  const shared = api.items.filter((d) => !d.mine);
  const starred = [api.system, ...api.items].filter((d) => d.favourite);
  const row = (d: Dash) => (
    <MenuItem key={`${d.id}`} checked={d.id === current.id} onSelect={() => api.select(d.id)}>
      <span className="jd-menu__name">{d.name}</span>
      {d.favourite && (
        <span className="jd-menu__star" aria-hidden>
          <Glyph name="star" size={12} />
        </span>
      )}
    </MenuItem>
  );
  return (
    <span className="jd-titletools">
      <button type="button" className="jd-iconbtn jd-star" aria-pressed={current.favourite} aria-label={B.star(current.name, current.favourite)} title={B.star(current.name, current.favourite)} onClick={() => void api.favourite(current)}>
        <Glyph name="star" />
      </button>
      <Menu label={B.switcher} button={<Glyph name="chevronDown" />} align="start" id="jd-switcher">
        {starred.length > 0 && <MenuGroup label={B.groups.starred}>{starred.map(row)}</MenuGroup>}
        {mine.length > 0 && <MenuGroup label={B.groups.mine}>{mine.map(row)}</MenuGroup>}
        {shared.length > 0 && <MenuGroup label={B.groups.shared}>{shared.map(row)}</MenuGroup>}
        <MenuGroup label={B.groups.system}>{row(api.system)}</MenuGroup>
        <hr className="jd-menu__sep" />
        <MenuItem onSelect={onCreate}>{B.actions.create}</MenuItem>
      </Menu>
    </span>
  );
}

function DashboardMeta({ api }: { api: DashboardsApi }) {
  const { current } = api;
  const shared = current.sharedRoles.map((r) => ROLE_LABEL[r] ?? r).join(', ');
  const owner = current.system ? B.owner.system : current.mine ? B.owner.me : B.owner.of(current.ownerId);
  return (
    <p className="jd-meta">
      {current.system && <span className="ds-lozenge">{B.systemTag}</span>}
      {!current.system && !current.mine && <span className="ds-lozenge" data-appearance="inprogress">{B.sharedTag}</span>}
      <span>{owner}</span>
      {current.mine && <span>{shared ? B.shareState.to(shared) : B.shareState.none}</span>}
      {api.local && <span>{B.localNote}</span>}
      {api.saveState === 'saving' && <span aria-live="polite">{B.saving}</span>}
    </p>
  );
}

function HeaderActions({ api, minutes, onRefresh, onEdit, onDialog, editBtn }: { api: DashboardsApi; minutes: number; onRefresh: () => void; onEdit: () => void; onDialog: (d: DialogKind) => void; editBtn: RefObject<HTMLButtonElement | null> }) {
  const mine = api.current.mine;
  return (
    <div className="jd-actions">
      <button type="button" className="jd-btn jd-btn--subtle jd-refresh" onClick={onRefresh} title={B.refresh}>
        <Glyph name="refresh" />
        <span>{B.refreshed(minutes)}</span>
      </button>
      <button type="button" ref={editBtn} className="jd-btn" onClick={onEdit} title={mine ? undefined : B.editCopyHint} data-ui="dashboard-edit">
        <Glyph name="edit" />
        {B.edit}
      </button>
      <Menu label={B.more} button={<Glyph name="more" />} className="jd-btn jd-btn--icon">
        <MenuItem onSelect={() => onDialog('create')}>{B.actions.create}</MenuItem>
        <MenuItem onSelect={() => onDialog('copy')}>{B.actions.copy}</MenuItem>
        <MenuItem onSelect={() => onDialog('rename')} disabled={!mine}>
          {B.actions.rename}
        </MenuItem>
        <MenuItem onSelect={() => onDialog('share')} disabled={!mine}>
          {B.actions.share}
        </MenuItem>
        <MenuItem onSelect={() => onDialog('reset')} disabled={!mine}>
          {B.actions.reset}
        </MenuItem>
        <hr className="jd-menu__sep" />
        <MenuItem onSelect={() => onDialog('remove')} disabled={!mine} danger>
          {B.actions.remove}
        </MenuItem>
      </Menu>
    </div>
  );
}

/** 레이아웃 고르기 — 썸네일 단추(라디오 묶음) */
function LayoutPicker({ value, onChange }: { value: LayoutKind; onChange: (l: LayoutKind) => void }) {
  const move = (e: ReactKeyboardEvent, i: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const n = LAYOUTS[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + LAYOUTS.length) % LAYOUTS.length];
    onChange(n);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`.jd-layouts [data-layout="${n}"]`)?.focus());
  };
  return (
    <div className="jd-layouts" role="radiogroup" aria-label={B.layout}>
      <span className="jd-layouts__label" aria-hidden>
        {B.layout}
      </span>
      {LAYOUTS.map((l, i) => (
        <button key={l} type="button" role="radio" aria-checked={l === value} tabIndex={l === value ? 0 : -1} data-layout={l} aria-label={B.layouts[l]} title={B.layouts[l]} className="jd-layout" onClick={() => onChange(l)} onKeyDown={(e) => move(e, i)}>
          <LayoutThumb layout={l} />
        </button>
      ))}
    </div>
  );
}

/** 지금 그려진 가젯 높이 — 열을 늘릴 때 높이로 나누는 데 쓴다 */
const measureGadgets = () => Object.fromEntries([...document.querySelectorAll<HTMLElement>('.jd-board [data-gadget]')].map((el) => [el.dataset.gadget!, el.offsetHeight || 1]));

function BoardGrid({ board, editing, onMove, render, empty }: { board: Board; editing: boolean; onMove: (id: string, next: Board) => void; render: (g: Gadget, col: number, index: number) => ReactNode; empty: boolean }) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<{ col: number; index: number } | null>(null);
  const cols = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const start = (e: Event) => setDragging((e as CustomEvent<string>).detail);
    const stop = () => {
      setDragging(null);
      setTarget(null);
    };
    window.addEventListener('jd:dragstart', start);
    window.addEventListener('jd:dragend', stop);
    return () => {
      window.removeEventListener('jd:dragstart', start);
      window.removeEventListener('jd:dragend', stop);
    };
  }, []);

  const over = (col: number) => (e: DragEvent) => {
    if (!editing || !e.dataTransfer.types.includes(MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // 놓는 자리 — 끌고 있는 가젯을 뺀 가젯들의 세로 가운데와 비교한다(자리 표시가 흔들리지 않게)
    const items = [...(cols.current[col]?.querySelectorAll<HTMLElement>(':scope > [data-gadget]') ?? [])];
    const mids = items.map((el) => (el.dataset.gadget === dragging ? Number.NaN : el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2));
    let index = dropIndex(mids.filter((m) => !Number.isNaN(m)), e.clientY);
    const self = items.findIndex((el) => el.dataset.gadget === dragging);
    if (self >= 0 && index >= self) index++;
    if (!target || target.col !== col || target.index !== index) setTarget({ col, index });
  };
  const drop = (col: number) => (e: DragEvent) => {
    const id = e.dataTransfer.getData(MIME);
    e.preventDefault();
    if (id && target?.col === col) onMove(id, move(board, id, col, target.index));
    setDragging(null);
    setTarget(null);
  };

  if (empty && !editing)
    return (
      <div className="jd-empty">
        <p className="jd-empty__title">{B.emptyBoard}</p>
        <p>{B.emptyBoardHint}</p>
      </div>
    );

  return (
    <div className="jd-board" data-layout={board.layout} data-dragging={dragging ? '' : undefined} style={{ ['--jd-cols' as string]: COLUMN_COUNT[board.layout] }}>
      {board.columns.map((ids, col) => (
        <div key={col} className="jd-col" data-col={col} data-over={dragging && target?.col === col ? '' : undefined} ref={(el) => void (cols.current[col] = el)} onDragOver={over(col)} onDrop={drop(col)} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setTarget(null)}>
          {ids.map((id, index) => {
            const g = board.gadgets[id];
            if (!g) return null;
            return (
              <Slot key={id} show={!!dragging && target?.col === col && target.index === index}>
                {render(g, col, index)}
              </Slot>
            );
          })}
          {!!dragging && target?.col === col && target.index >= ids.length && (
            <div className="jd-drop" aria-hidden>
              {B.dropHere}
            </div>
          )}
          {editing && !ids.length && !(dragging && target?.col === col) && <p className="jd-col__empty">{B.emptyColumn}</p>}
        </div>
      ))}
    </div>
  );
}

function Slot({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <>
      {show && (
        <div className="jd-drop" aria-hidden>
          {B.dropHere}
        </div>
      )}
      {children}
    </>
  );
}

// 가로로 넘치는 본문(절차 지도) — 오른쪽에 더 있으면 data-more를 달아 끝을 흐린다
function useMoreRight(on: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const check = () => el.toggleAttribute('data-more', el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', check);
      ro?.disconnect();
    };
  });
  return ref;
}

function GadgetCard(p: {
  gadget: Gadget;
  role: string;
  editing: boolean;
  editable: boolean;
  col: number;
  index: number;
  board: Board;
  minimized: boolean;
  maximized: boolean;
  configuring: boolean;
  autoFocus: boolean;
  onFocused: () => void;
  onMove: (d: Direction) => void;
  onToggleMin: () => void;
  onMaximize: () => void;
  onConfigure: () => void;
  onSave: (c: GadgetConfig, r: Refresh) => void;
  onCancel: () => void;
  onRemove: () => void;
  refreshApis: (names: string[]) => Promise<void>;
}) {
  const { gadget: g, editing, board } = p;
  const def = typeDef(g.type);
  const title = gadgetTitle(g.type, g.config);
  const hid = `gadget-${g.id}-h`;
  const ref = useRef<HTMLElement>(null);
  const [at, setAt] = useState(() => Date.now());
  const minutes = useMinutesSince(at);
  const [dragging, setDragging] = useState(false);
  const refresh = useCallback(() => {
    void p.refreshApis(def?.apis(g.config) ?? []);
    setAt(Date.now());
  }, [def, g.config, p.refreshApis]);
  // 가젯마다 자동 새로 고침(끔·1·5·15분)
  useEffect(() => {
    if (!g.refresh) return;
    const t = setInterval(refresh, g.refresh * 60_000);
    return () => clearInterval(t);
  }, [g.refresh, refresh]);
  useEffect(() => {
    if (!p.autoFocus) return;
    ref.current?.scrollIntoView?.({ block: 'nearest' });
    p.onFocused();
  }, [p.autoFocus]);

  const last = board.columns[p.col]?.length - 1;
  const moves: [Direction, string, boolean][] = [
    ['up', G.move.up, p.index > 0],
    ['down', G.move.down, p.index < last],
    ['left', G.move.left, p.col > 0],
    ['right', G.move.right, p.col < board.columns.length - 1],
  ];
  const Body = def ? BODIES[def.module] : null;
  const showConfig = p.editable && p.configuring;
  const bodyRef = useMoreRight(g.type === 'procedures' && !showConfig && !p.minimized);

  return (
    <section ref={ref} className="jd-gadget" data-gadget={g.id} data-type={g.type} data-dragging={dragging ? '' : undefined} data-minimized={p.minimized ? '' : undefined} aria-labelledby={hid}>
      <header
        className="jd-gadget__head"
        draggable={editing && !p.maximized}
        title={editing ? G.drag(title) : undefined}
        onDragStart={(e) => {
          if (!editing) return;
          e.dataTransfer.setData(MIME, g.id);
          e.dataTransfer.effectAllowed = 'move';
          if (ref.current) e.dataTransfer.setDragImage(ref.current, 24, 16);
          setDragging(true);
          window.dispatchEvent(new CustomEvent('jd:dragstart', { detail: g.id }));
        }}
        onDragEnd={() => {
          setDragging(false);
          window.dispatchEvent(new CustomEvent('jd:dragend'));
        }}
      >
        {editing && !p.maximized && (
          <span className="jd-grip" aria-hidden>
            <Glyph name="grip" />
          </span>
        )}
        <h2 id={hid} tabIndex={-1}>
          {title}
        </h2>
        <Menu label={G.menu(title)} button={<Glyph name="more" />}>
          <MenuItem onSelect={refresh}>{G.refresh}</MenuItem>
          <MenuItem onSelect={p.onToggleMin}>{p.minimized ? G.restore : G.minimize}</MenuItem>
          <MenuItem onSelect={p.onMaximize}>{p.maximized ? G.unmaximize : G.maximize}</MenuItem>
          {p.editable && <MenuItem onSelect={p.onConfigure}>{G.configure}</MenuItem>}
          {p.editable &&
            editing &&
            !p.maximized &&
            moves.map(([d, label, ok]) => (
              <MenuItem key={d} disabled={!ok} onSelect={() => p.onMove(d)}>
                {label}
              </MenuItem>
            ))}
          {p.editable && (
            <MenuItem onSelect={p.onRemove} danger>
              {G.remove}
            </MenuItem>
          )}
        </Menu>
      </header>
      {!p.minimized && (
        <div className="jd-gadget__body" ref={bodyRef}>
          <Suspense fallback={<GadgetLoading />}>
            {!def || !Body ? (
              <p className="jd-note">{G.unknown}</p>
            ) : showConfig ? (
              <GadgetConfigForm gadget={g} isNew={!g.configured} onSave={p.onSave} onCancel={p.onCancel} />
            ) : (
              <Body gadget={g} role={p.role} wide={p.maximized} />
            )}
          </Suspense>
        </div>
      )}
      {!p.minimized && !showConfig && (
        <footer className="jd-gadget__foot">
          <span>{B.refreshed(minutes)}</span>
          {g.refresh > 0 && <span>{G.autoRefresh(g.refresh)}</span>}
          {def?.link && (
            <Link to={def.link} className="jd-gadget__link">
              {B.body.viewAll}
            </Link>
          )}
        </footer>
      )}
    </section>
  );
}

function GadgetLoading() {
  return (
    <div className="jd-skel" data-state="loading" role="progressbar" aria-busy="true" aria-label={G.loading}>
      <span />
      <span />
      <span />
    </div>
  );
}

export type { Dash };
