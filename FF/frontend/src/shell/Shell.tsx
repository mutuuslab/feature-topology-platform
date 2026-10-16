// 앱 셸 — 상단바(검색·⌘K·역할·내 역할 필터·시연 모드·테마·모션·알림) + 아이콘 레일(8그룹) + 그룹 패널 + 본문.
// 운영·안전 그룹 화면은 본문을 어두운 관제실 톤(data-zone="ops")으로 바꿔 운영 모드임을 분명히 한다.
import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { STATIC_MODE } from '../api/client';
import { ko } from '../copy/ko';
import { profileOf, roleLabel, roles } from '../data/refdata';
import { Button, Icon } from '../design';
import { useMotion } from '../state/motion';
import { roleHome, useAppApi, useAppShell } from '../store';
import { GROUPS, MENU, ROUTES, rolesOf, routeOf, trailOf, type GroupKey } from '../routes';
import { GuideDock, RuleDrawer } from './GuideDock';
import { FeaturePeek } from './FeaturePeek';
import { learnStore, useExplain, useLearn } from './learn';
import { NotificationBell } from './NotificationBell';
import './shell.css';

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

export function Shell({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const loc = useLocation();
  const { role, theme, lang } = useAppShell();
  const { dispatch } = useAppApi();
  const motion = useMotion();
  const current = routeOf(loc.pathname);
  const [group, setGroup] = useState<GroupKey>(current?.group ?? 'home');
  const [present, setPresent] = usePersistent(LS_PRESENT, false);
  const [myRole, setMyRole] = usePersistent(LS_MYROLE, false);
  const [panelOpen, setPanelOpen] = usePersistent(LS_PANEL, true);
  const [q, setQ] = useState('');
  // 따라하기 진행 중이면 오른쪽에 가이드 패널 열(접으면 떠 있는 버튼만) · 표준 설명 모드는 html[data-explain]
  const learning = useLearn();
  const explain = useExplain();
  useEffect(() => {
    document.documentElement.setAttribute('data-explain', explain ? 'on' : 'off');
  }, [explain]);

  useEffect(() => {
    if (current) setGroup(current.group);
  }, [current]);

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
          <button type="button" role="switch" className="sh-switch" aria-checked={myRole} title={ko.shell.myRole} onClick={() => setMyRole(!myRole)}>
            <span className="sh-switch__track" aria-hidden><span /></span>
            <span>{ko.shell.myRole}</span>
          </button>
          <div className="sh-user" title={`${me.name} · ${me.empNo} · ${me.org}`}>
            <span className="sh-user__avatar" aria-hidden>{me.name.slice(0, 1)}</span>
            <select aria-label={ko.shell.role} value={role} onChange={(e) => changeRole(e.target.value)}>
              {roles.map((r) => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
          </div>
          <Button variant="ghost" icon="book" aria-pressed={explain} aria-label={ko.learn.explain.label} title={ko.learn.explain.hint} onClick={() => learnStore.setExplain(!explain)} />
          <Button variant="ghost" icon="present" aria-pressed={present} aria-label={present ? ko.shell.presentOn : ko.shell.presentOff} title={present ? ko.shell.presentOn : ko.shell.presentOff} onClick={() => setPresent(!present)} />
          <Button variant="ghost" icon={motion.running ? 'pause' : 'play'} aria-pressed={motion.running} aria-label={ko.shell.motion} title={ko.shell.motion} onClick={() => motion.setLive(!motion.live)} />
          <Button variant="ghost" icon={theme === 'light' ? 'moon' : 'sun'} aria-label={ko.shell.theme} title={ko.shell.theme} onClick={() => dispatch({ t: 'THEME', theme: theme === 'light' ? 'dark' : 'light' })} />
          <Button variant="ghost" className="sh-lang" aria-label={ko.shell.language} title={ko.shell.language} onClick={() => dispatch({ t: 'LANG', lang: lang === 'ko' ? 'en' : 'ko' })}>
            {lang.toUpperCase()}
          </Button>
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

      <aside className="sh-panel" aria-label={GROUPS.find((g) => g.key === group)!.ko} data-zone={GROUPS.find((g) => g.key === group)?.zone}>
        <div className="sh-panel__head">
          <span className="ds-eyebrow">{String(GROUPS.findIndex((g) => g.key === group) + 1).padStart(2, '0')}</span>
          <h2>{GROUPS.find((g) => g.key === group)!.ko}</h2>
        </div>
        <ul className="sh-panel__list">
          {items.map((r) => (
            <li key={r.path}>
              <NavLink to={r.menu!} end={r.menu === '/'} className={() => (current && (current.path === r.path || isUnder(current.path, r.path)) ? 'active' : '')}>
                {r.title}
              </NavLink>
            </li>
          ))}
        </ul>
        {items.length === 0 && <p className="sh-panel__empty">{ko.shell.noItems}</p>}
      </aside>

      <main className="sh-main" id="main" data-zone={zone}>
        {STATIC_MODE && (
          <div className="ds-stale" role="status" data-static-demo>
            <Icon name="alert" size={16} />
            {ko.page.readOnly}
          </div>
        )}
        {trail.length > 0 && (
          <nav className="sh-trail" aria-label="breadcrumb">
            <ol>
              {trail.map((t, i) => (
                <li key={i}>{t.to ? <Link to={t.to}>{t.title}</Link> : <span aria-current={i === trail.length - 1 ? 'page' : undefined}>{t.title}</span>}</li>
              ))}
            </ol>
          </nav>
        )}
        <Suspense fallback={<div className="ds-skel" data-state="loading"><span /><span /><span /></div>}>{children}</Suspense>
      </main>
      <GuideDock />
      <RuleDrawer />
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

