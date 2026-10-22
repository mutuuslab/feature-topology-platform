// 앱 셸 — 상단바(검색·⌘K·역할·내 역할 필터·시연 모드·테마·모션·알림) + 아이콘 레일(8그룹) + 그룹 패널 + 본문.
// 운영·안전 그룹 화면은 청록 표식(data-area="ops")으로 운영 모드임을 알린다. 본문만 어둡게 바꾸면 상단바·레일과
// 톤이 반쯤 갈려 의도가 읽히지 않았다(하네스 2판 결함 5) — 테마는 사용자 설정(라이트·다크)을 그대로 따른다.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { STATIC_MODE } from '../api/client';
import { ko } from '../copy/ko';
import { procedures } from '../copy/procedures';
import { profileOf, roleLabel, roles } from '../data/refdata';
import { Button, Icon } from '../design';
import { useMotion } from '../state/motion';
import { roleHome, useAppApi, useAppShell } from '../store';
import { GROUPS, MENU, ROUTES, rolesOf, routeOf, trailOf, type GroupKey } from '../routes';
import { logout } from '../auth';
import { login as L } from '../copy/login';
import { GuideDock, RuleDrawer } from './GuideDock';
import { ProcedureGuideHost } from './ProcedureGuideHost';
import { FeaturePeek } from './FeaturePeek';
import { learnStore, useExplain, useLearn } from './learn';
import { NotificationBell } from './NotificationBell';
import { useProcedureSummary } from '../data/procedureProgress';
import './shell.css';

// 업무 절차 데이터는 패널을 열 때만 불러온다(첫 화면 번들 예산)
const ScreenProcedure = lazy(() => import('./ScreenProcedure'));

const LS_PRESENT = 'ff.present';
const LS_MYROLE = 'ff.myRole';
const LS_PANEL = 'ff.panel';

function usePersistent(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    const s = localStorage.getItem(key);
    return s === null ? initial : s === '1';
  });
  const set = useCallback((x: boolean) => {
    localStorage.setItem(key, x ? '1' : '0');
    setV(x);
  }, [key]);
  return [v, set];
}

/** 그룹 패널이 본문 위 드로어가 되는 폭 — shell.css의 미디어 쿼리와 같은 값 */
const NARROW_QUERY = '(max-width: 1279px)';

/** 좁은 화면인가 — 패널 기본값·스크림·Esc 닫기에 쓴다(jsdom처럼 matchMedia가 없는 환경은 넓은 화면) */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(NARROW_QUERY);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

export function Shell({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const loc = useLocation();
  const { role, theme, lang } = useAppShell();
  const { dispatch } = useAppApi();
  const motion = useMotion();
  const current = routeOf(loc.pathname);
  const narrow = useNarrow();
  const [group, setGroup] = useState<GroupKey>(current?.group ?? 'home');
  const [present, setPresent] = usePersistent(LS_PRESENT, false);
  const [myRole, setMyRole] = usePersistent(LS_MYROLE, false);
  // 좁은 화면에서는 패널이 본문을 덮는 드로어라 기본을 닫아 둔다 — 저장된 값이 있으면 그 값을 따른다
  const [panelOpen, setPanelOpen] = usePersistent(LS_PANEL, !narrow);
  const [q, setQ] = useState('');
  const [procOpen, setProcOpen] = useState(false);
  // 따라하기 진행 중이면 오른쪽에 가이드 패널 열(접으면 떠 있는 버튼만) · 표준 설명 모드는 html[data-explain]
  const learning = useLearn();
  const explain = useExplain();
  useEffect(() => {
    document.documentElement.setAttribute('data-explain', explain ? 'on' : 'off');
  }, [explain]);

  useEffect(() => {
    if (current) setGroup(current.group);
  }, [current]);

  // 좁은 화면 드로어: 화면을 옮기면 닫고 Esc로도 닫는다(넓은 화면은 늘 보이는 패널이라 영향 없음)
  useEffect(() => {
    if (narrow) setPanelOpen(false);
  }, [narrow, loc.pathname, setPanelOpen]);
  useEffect(() => {
    if (!narrow || !panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [narrow, panelOpen, setPanelOpen]);

  // 시연 모드 — <html data-present="on">, 단축키 P (입력 중에는 무시)
  useEffect(() => {
    document.documentElement.setAttribute('data-present', present ? 'on' : 'off');
  }, [present]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'p' || e.metaKey || e.ctrlKey || e.altKey) return;
      // 대상이 window·document일 수도 있다(요소가 아님) — closest가 없는 대상은 입력 중이 아니다
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      setPresent(!present);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [present, setPresent]);

  const zone = GROUPS.find((g) => g.key === current?.group)?.zone;
  const items = useMemo(() => {
    const g = MENU.find((m) => m.key === group)!;
    return myRole ? g.items.filter((r) => { const rs = rolesOf(r); return rs === 'all' || rs.includes(role); }) : g.items;
  }, [group, myRole, role]);
  const trail = trailOf(loc.pathname);
  const me = profileOf(role);
  // 업무 절차 메뉴 배지 — 내가 지금 할 수 있는 활동(할 일 + 검토). 서버가 정본이라 역할을 바꾸면 다시 읽는다.
  const proc = useProcedureSummary(role);
  const procCount = proc ? proc.todo + proc.review : 0;

  const search = () => {
    const v = q.trim();
    if (!v) return;
    nav('/features?q=' + encodeURIComponent(v.toUpperCase().startsWith('FEAT-') ? v.toUpperCase() : v));
    setQ('');
  };
  const changeRole = (r: string) => {
    dispatch({ t: 'ROLE', role: r });
    nav(roleHome[r] || '/');
  };

  return (
    <div className="sh" data-panel={panelOpen && !present ? 'open' : 'closed'} data-guide={learning && !learning.collapsed ? 'open' : undefined}>
      <a className="sh-skip" href="#main">{ko.app.skip}</a>

      <header className="sh-top">
        <Link to="/" className="sh-brand" aria-label={ko.app.name}>
          <span className="sh-brand__mark" aria-hidden>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 21V3.5" /><path d="M6 4h11l-2.5 3.5L17 11H6" /><path d="M3 21h6M10 15v2M13 15v2M16 15v2M19 15v2" /></svg>
          </span>
          <span className="sh-brand__name">{ko.app.name}</span>
          <span className="sh-brand__sub">{ko.app.tagline}</span>
        </Link>

        <form className="sh-search" role="search" onSubmit={(e) => (e.preventDefault(), search())}>
          <Icon name="search" size={16} />
          <input aria-label={ko.shell.search} placeholder={ko.shell.search} value={q} onChange={(e) => setQ(e.target.value)} title={ko.shell.searchHint} />
          <button type="button" className="sh-kbd" aria-label={ko.shell.command} onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}>
            Ctrl K
          </button>
        </form>

        <div className="sh-tools">
          <div className="sh-user" title={`${me.name} · ${me.empNo} · ${me.org}`}>
            <span className="sh-user__avatar" aria-hidden>{me.name.slice(0, 1)}</span>
            <select aria-label={ko.shell.role} value={role} onChange={(e) => changeRole(e.target.value)}>
              {roles.map((r) => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
          </div>
          <Button variant="ghost" icon="layers" aria-label={procedures.panel.button} title={procedures.panel.button} onClick={() => setProcOpen(true)} />
          <Button variant="ghost" icon="book" aria-pressed={explain} aria-label={ko.learn.explain.label} title={ko.learn.explain.hint} onClick={() => learnStore.setExplain(!explain)} />
          <Button variant="ghost" icon="present" aria-pressed={present} aria-label={present ? ko.shell.presentOn : ko.shell.presentOff} title={present ? ko.shell.presentOn : ko.shell.presentOff} onClick={() => setPresent(!present)} />
          <Button variant="ghost" icon={motion.running ? 'pause' : 'play'} aria-pressed={motion.running} aria-label={ko.shell.motion} title={ko.shell.motion} onClick={() => motion.setLive(!motion.live)} />
          <Button variant="ghost" icon={theme === 'light' ? 'moon' : 'sun'} aria-label={ko.shell.theme} title={ko.shell.theme} onClick={() => dispatch({ t: 'THEME', theme: theme === 'light' ? 'dark' : 'light' })} />
          <Button variant="ghost" className="sh-lang" aria-label={ko.shell.language} title={ko.shell.language} onClick={() => dispatch({ t: 'LANG', lang: lang === 'ko' ? 'en' : 'ko' })}>
            {lang.toUpperCase()}
          </Button>
          <Button
            variant="ghost"
            icon="logout"
            className="sh-logout"
            aria-label={L.logout}
            title={L.logout}
            onClick={() => {
              logout();
              nav('/login');
            }}
          />
          <NotificationBell />
        </div>
      </header>

      <nav className="sh-rail" aria-label={ko.app.name}>
        {GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            className="sh-rail__btn"
            data-group-zone={g.zone}
            aria-current={g.key === current?.group ? 'true' : undefined}
            aria-pressed={g.key === group}
            title={g.ko}
            aria-label={g.ko}
            onClick={() => {
              setGroup(g.key);
              if (!panelOpen) setPanelOpen(true);
            }}
          >
            <Icon name={g.icon} size={20} />
            <span aria-hidden>{g.short}</span>
          </button>
        ))}
        <button type="button" className="sh-rail__btn sh-rail__toggle" aria-label={panelOpen ? ko.shell.collapse : ko.shell.expand} title={panelOpen ? ko.shell.collapse : ko.shell.expand} onClick={() => setPanelOpen(!panelOpen)}>
          <Icon name={panelOpen ? 'chevronLeft' : 'chevron'} size={18} />
        </button>
      </nav>

      <aside className="sh-panel" aria-label={GROUPS.find((g) => g.key === group)!.ko} data-area={GROUPS.find((g) => g.key === group)?.zone}>
        {/* 좁은 화면 드로어에서만 보인다 — 레일 토글까지 내려가지 않아도 닫을 수 있게 */}
        <button type="button" className="sh-panel__close" aria-label={ko.action.close} title={ko.action.close} onClick={() => setPanelOpen(false)}>
          <Icon name="close" size={18} />
        </button>
        <div className="sh-panel__head">
          <h2>{GROUPS.find((g) => g.key === group)!.ko}</h2>
          {GROUPS.find((g) => g.key === group)?.zone === 'ops' && <p className="sh-panel__area">{ko.shell.opsArea}</p>}
          {/* 메뉴를 거르는 스위치는 메뉴 머리에 — 상단 막대 조작을 줄인다(3초 테스트) */}
          <button type="button" role="switch" className="sh-switch" aria-checked={myRole} title={ko.shell.myRole} onClick={() => setMyRole(!myRole)}>
            <span className="sh-switch__track" aria-hidden><span /></span>
            <span>{ko.shell.myRole}</span>
          </button>
        </div>
        <ul className="sh-panel__list">
          {items.map((r) => (
            <li key={r.path}>
              <NavLink
                to={r.menu!}
                end={r.menu === '/'}
                aria-label={r.menu === '/procedures' && procCount ? `${r.title} — 내 차례 ${procCount}건` : undefined}
                className={() => (current && (current.path === r.path || isUnder(current.path, r.path)) ? 'active' : '')}
              >
                {r.title}
                {r.menu === '/procedures' && procCount > 0 && (
                  <span className="sh-panel__count" data-overdue={proc && proc.overdue > 0 ? '' : undefined} aria-hidden>
                    {procCount}
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
        {items.length === 0 && <p className="sh-panel__empty">{ko.shell.noItems}</p>}
      </aside>

      {/* 좁은 화면 드로어가 열려 있으면 본문을 가리는 대신 스크림을 둔다 — 바깥을 누르면 닫힌다 */}
      {narrow && panelOpen && !present && <div className="sh-scrim" onClick={() => setPanelOpen(false)} aria-hidden />}

      <main className="sh-main" id="main" data-area={zone}>
        {STATIC_MODE && (
          <div className="ds-stale" role="status" data-static-demo>
            <Icon name="alert" size={16} />
            {ko.page.readOnly}
          </div>
        )}
        {/* 위치는 한 번만(3초 테스트) — 현재 화면 이름은 H1이 말한다. 상위 화면이 있을 때만 그룹·상위까지 */}
        {trail.length > 2 && (
          <nav className="sh-trail" aria-label="breadcrumb">
            <ol>
              {trail.slice(0, -1).map((t, i) => (
                <li key={i}>{t.to ? <Link to={t.to}>{t.title}</Link> : <span>{t.title}</span>}</li>
              ))}
            </ol>
          </nav>
        )}
        <Suspense fallback={<div className="ds-skel" data-state="loading"><span /><span /><span /></div>}>{children}</Suspense>
      </main>
      <GuideDock />
      <ProcedureGuideHost />
      <RuleDrawer />
      {procOpen && (
        <Suspense fallback={null}>
          <ScreenProcedure onClose={() => setProcOpen(false)} />
        </Suspense>
      )}
      <FeaturePeek />
    </div>
  );
}

/** 현재 라우트가 메뉴 항목의 하위(드릴다운)인가 */
function isUnder(path: string, ancestor: string): boolean {
  let cur = ROUTES.find((r) => r.path === path);
  for (let i = 0; cur?.parent && i < 6; i++) {
    if (cur.parent === ancestor) return true;
    cur = ROUTES.find((r) => r.path === cur!.parent);
  }
  return false;
}

