import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { users, roles, verbs, permMatrix, roleKeyOf, orgs, domains, uiActions, uiRoles, uiPermMatrix, profileOf, roleLabel } from '../data/refdata';
import { SPEC_ROLES } from '../data/specNav';
import { screensOfOwner } from '../data/specMenu';
import { implementedPaths } from '../data/uiLinks';
import { RightPanel, EmptyState } from '../components/patterns';
import { Breadcrumb } from '../components/Breadcrumb';
import { useApp, useAppShell, useToast, roleHome as ROLE_HOME } from '../store';

/** 데모 기준일 — 만료 임박 판정에 쓴다(시뮬레이터 시계와 별개인 달력 기준). */
const DEMO_TODAY = '2026-06-05';
const daysUntil = (date: string) => Math.round((Date.parse(date) - Date.parse(DEMO_TODAY)) / 86400000);

export function UsersRoles() {
  const [sel, setSel] = useState<any>(null);
  const roleKey = roleKeyOf;
  return (
    <div>
      <Breadcrumb />
      <h1 className="page-title">Users &amp; Roles</h1>
      <p className="page-sub">행 클릭 → 사용자 권한 상세</p>
      <div className="card"><div className="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Org</th><th>Status</th></tr></thead>
        <tbody>{users.map(u => (<tr key={u.id} role="button" tabIndex={0} onClick={() => setSel(u)} onKeyDown={e => { if (e.key === 'Enter') setSel(u); }}><td>{u.name}</td><td>{u.role}</td><td>{u.org}</td>
          <td><span className="badge" style={{ background: u.status === 'active' ? 'var(--pass)' : 'var(--pending)' }}>{u.status}</span></td></tr>))}</tbody></table></div></div>
      <RightPanel open={!!sel} onClose={() => setSel(null)} title={sel?.name || ''}>
        {sel && <div>
          <div className="kv"><div>Role</div><div>{sel.role}</div><div>Org</div><div>{sel.org}</div><div>Status</div><div>{sel.status}</div></div>
          <p className="mt small"><b>권한(verb)</b></p>
          <div>{verbs.map(v => <span key={v} className="pill" style={{ marginRight: 4, opacity: (permMatrix[roleKey(sel.role)] || []).includes(v) ? 1 : 0.3 }}>{v}</span>)}</div>
        </div>}
      </RightPanel>
    </div>
  );
}

export function PermissionsMatrix() {
  const { role } = useAppShell();
  const mine = permMatrix[role] || [];
  return (
    <div>
      <Breadcrumb />
      <h1 className="page-title">Permissions Matrix (Role × Verb)</h1>
      <p className="page-sub">현재 역할 <b>{roleLabel(role)}</b> — 자기 열을 확인하고, 변경은 감사 로그로 남긴다</p>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table><thead><tr><th>Role \ Verb</th>{verbs.map(v=><th key={v}>{v}</th>)}</tr></thead>
          <tbody>{roles.map(r=>(<tr key={r} style={{ background: r === role ? 'rgba(11,95,255,.06)' : undefined }}><td><b>{roleLabel(r)}</b></td>{verbs.map(v=>(
            <td key={v} style={{textAlign:'center'}}>{permMatrix[r]?.includes(v)?'✅':'−'}</td>))}</tr>))}</tbody></table>
      </div>
      <p className="small muted">domain-scoped 오버라이드 · 검증 P4 approve=Verification Gate only · 변경은 감사 로그</p>

      <h2 className="mt" style={{ fontSize: 16 }}>화면 행동 권한 · Action × Role</h2>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table><thead><tr><th>Role \ Action</th>{uiActions.map(a => <th key={a}>{a}</th>)}</tr></thead>
          <tbody>{uiRoles.map(r => (<tr key={r}><td><b>{r}</b></td>{uiActions.map(a => (
            <td key={a} style={{ textAlign: 'center' }}>{uiPermMatrix[r]?.includes(a) ? '✅' : '−'}</td>))}</tr>))}</tbody></table>
        <p className="small muted mt">내 역할의 verb: {verbs.map(v => <span key={v} className="pill" style={{ marginRight: 4, opacity: mine.includes(v) ? 1 : .3 }}>{v}</span>)}</p>
        <p className="small muted">Audit Event: who·when·object·before/after·reason·evidence_link · 원칙: Evidence-first / No silent write / Explainable decision</p>
      </div>
    </div>
  );
}

export function OrgDomains() {
  const { state } = useApp();
  const rows = useMemo(() => SPEC_ROLES.map(r => {
    const screens = screensOfOwner(r.key);
    return {
      ...r,
      verbs: permMatrix[r.key] || [],
      screenCount: screens.length,
      impl: screens.reduce((n, id) => n + implementedPaths(id).length, 0),
      home: ROLE_HOME[r.key] || '—',
    };
  }), []);
  return (
    <div>
      <Breadcrumb />
      <h1 className="page-title">Org &amp; Domains</h1>
      <p className="page-sub">조직 · 역할군 · 담당 업무 영역과 적용 범위(scope)의 원천은 역할 정의 하나다</p>
      <div className="row">
        <div className="col card"><b>Orgs</b>
          <table className="mt"><thead><tr><th>조직</th><th>사용자</th></tr></thead>
            <tbody>{orgs.map(o => <tr key={o}><td>{o}</td><td>{users.filter(u => u.org === o).length}</td></tr>)}</tbody></table>
        </div>
        <div className="col card"><b>Domains</b><div className="row">{domains.map(d=><span key={d} className="pill">{d}</span>)}</div>
          <p className="small muted mt">Domain 은 Feature Taxonomy 의 최상위 축이다. 접근 범위는 역할 scope 가 정한다.</p>
          <b className="mt" style={{ display: 'block' }}>Scope</b>
          <div className="row mt">{[...new Set(SPEC_ROLES.flatMap(r => r.scopes))].sort().map(s => <span key={s} className="pill">{s}</span>)}</div>
        </div>
      </div>

      <h2 className="mt" style={{ fontSize: 16 }}>역할군 · 담당 업무 영역 · 기본 화면</h2>
      <div className="card"><div className="table-wrap">
        <table><thead><tr><th>역할</th><th>담당자</th><th>조직</th><th>Scope</th><th>verb</th><th>담당 영역</th><th>구현 화면</th><th>기본 착지</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.key}>
              <td><b>{r.label}</b><span className="muted small"> · {r.key}</span></td>
              <td>{r.name}<span className="muted small"> ({profileOf(r.key).empNo})</span></td>
              <td className="small">{r.group}</td>
              <td className="small">{r.scopes.join(' · ')}</td>
              <td className="small">{r.verbs.join(' · ')}</td>
              <td className="small">{r.screenCount}개</td>
              <td className="small">{r.impl}</td>
              <td className="mono small">{r.home}</td>
            </tr>
          ))}</tbody></table>
      </div></div>
      <p className="small muted mt">이 역할 체계가 Feature 등록 Revision {state.revisions.length}건 · BOM 기준선 {state.bomBaselines.length}건 · 정책 {state.policies.length}건의 명령 권한을 통제한다.</p>
    </div>
  );
}

interface InboxItem { kind: string; id: string; target: string; owner: string; gate: string; to: string; act?: () => void }

/**
 * 검토함 — 승인 대기 큐를 저장소의 실제 미결 객체에서 파생한다.
 * 각 행은 소유 화면으로 넘기고, 이 화면에서 끝낼 수 있는 명령만 여기서 실행한다.
 */
export function ApprovalWorkflow() {
  const { state, dispatch } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const role = state.role;
  const canApprove = (permMatrix[role] || []).includes('approve');

  const items = useMemo<InboxItem[]>(() => {
    const out: InboxItem[] = [];
    state.crs.filter(c => c.status !== 'Approved').forEach(c => out.push({
      kind: '변경요청', id: c.id, target: c.feature, owner: c.owner,
      gate: `${c.status} · 위험도 ${c.risk}`, to: `/change/cr/${c.id}`,
      act: c.status === 'Reviewed' ? () => { dispatch({ t: 'SET_CR_STATUS', id: c.id, status: 'Approved' }); toast(`${c.id} 승인 — 감사 로그에 기록`); } : undefined,
    }));
    state.bomBaselines.filter(b => b.state === 'IN_REVIEW').forEach(b => out.push({
      kind: 'BOM 기준선', id: `${b.id}@${b.version}`, target: b.memberSetRef || b.id, owner: b.author,
      gate: '검토 중 — 내용 hash 에 결속된 승인 필요', to: '/master/bom',
    }));
    state.revisions.filter(r => r.state === 'IN_REVIEW').forEach(r => out.push({
      kind: 'Feature 등록 심사', id: `${r.id}@${r.version}`, target: r.name || r.id, owner: r.actor,
      gate: `동시성 Revision #${r.recordRevision}`, to: '/master/define',
    }));
    state.policies.filter(p => p.stage === 'Review').forEach(p => out.push({
      kind: '정책 발행', id: p.id, target: p.feature, owner: p.approver !== '-' ? p.approver : '미지정',
      gate: 'Review — 품질 확인 후 G+M 허가', to: '/ops/policy',
      act: canApprove ? () => { dispatch({ t: 'PROMOTE_POLICY', id: p.id, actor: role }); toast(`${p.id} 승인 단계로 발행`); } : undefined,
    }));
    state.exceptions.filter(e => e.active).forEach(e => out.push({
      kind: '예외 정책', id: e.id, target: e.feature, owner: e.approver,
      gate: `만료 ${e.expiry} · 사유 ${e.reason}`, to: '/policy/exception',
      act: () => { dispatch({ t: 'EXC_REVOKE', id: e.id }); toast(`${e.id} 해제 — 감사 로그에 기록`); },
    }));
    state.supplierAcceptance.filter(s => s.status === 'pending').forEach(s => out.push({
      kind: '협력사 인수', id: s.item, target: s.feature, owner: s.owner === 'OEM' ? 'OEM' : '협력사',
      gate: '인수 확인 대기', to: '/decisions/supplier',
      act: () => { dispatch({ t: 'ACCEPT_SUPPLIER', feature: s.feature, item: s.item }); toast(`${s.item} 인수 완료`); },
    }));
    state.security.vulns.filter(v => v.status === 'open').forEach(v => out.push({
      kind: '보안 취약점', id: v.id, target: v.feature, owner: '보안 담당',
      gate: v.title, to: '/admin/security',
      act: () => { dispatch({ t: 'ACK_VULN', id: v.id, status: 'ack' }); toast(`${v.id} 확인 처리`); },
    }));
    state.incidents.filter(i => i.status !== 'closed').forEach(i => out.push({
      kind: '장애 대응', id: i.id, target: i.feature, owner: i.severity,
      gate: `${i.status} · ${i.title}`, to: '/ops/incident',
    }));
    return out;
  }, [state, dispatch, role, toast, canApprove]);

  const byKind = useMemo(() => {
    const m: Record<string, number> = {};
    items.forEach(i => { m[i.kind] = (m[i.kind] || 0) + 1; });
    return m;
  }, [items]);
  const actionable = items.filter(i => i.act).length;

  return (
    <div>
      <Breadcrumb />
      <h1 className="page-title">검토함</h1>
      <p className="page-sub">내 판단을 기다리는 미결 객체 — 현재 역할 <b>{roleLabel(role)}</b> · {canApprove ? '승인 권한 있음' : '승인 권한 없음(조회만)'}</p>
      <div className="kpis">
        <div className="kpi"><div className="v">{items.length}</div><div className="l">검토 대기</div></div>
        <div className="kpi"><div className="v" style={{ color: 'var(--fail)' }}>{byKind['장애 대응'] || 0}</div><div className="l">장애 대응</div></div>
        <div className="kpi"><div className="v" style={{ color: 'var(--pending)' }}>{byKind['변경요청'] || 0}</div><div className="l">변경요청</div></div>
        <div className="kpi"><div className="v">{byKind['BOM 기준선'] || 0}</div><div className="l">BOM 기준선</div></div>
        <div className="kpi"><div className="v">{byKind['Feature 등록 심사'] || 0}</div><div className="l">등록 심사</div></div>
        <div className="kpi"><div className="v">{actionable}</div><div className="l">이 화면에서 처리</div></div>
      </div>

      <div className="card mt">
        {items.length === 0 ? <EmptyState title="검토 대기 0건 — 모든 판단이 끝났다" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>구분</th><th>ID</th><th>대상</th><th>담당</th><th className="wrap">게이트 조건</th><th>행동</th></tr></thead>
              <tbody>
                {items.map(i => (
                  <tr key={i.kind + i.id}>
                    <td><span className="pill">{i.kind}</span></td>
                    <td className="mono small">{i.id}</td>
                    <td className="small">{i.target}</td>
                    <td className="small">{i.owner}</td>
                    <td className="small wrap">{i.gate}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <button className="btn" onClick={() => nav(i.to)}>화면 열기 →</button>
                        {i.act ? <button className="btn primary" onClick={() => i.act && i.act()}>승인</button> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="small muted mt">
        대기 목록은 <b>파생</b>이다 — 따로 저장하지 않으므로 원천 객체가 바뀌면 즉시 따라온다.
        승인은 작성자와 다른 주체가 현재 내용 hash 에 대해 남긴다.
      </p>
    </div>
  );
}

export function Settings() {
  const { state, dispatch } = useApp();
  const { role, navMode, lang, theme } = useAppShell();
  const nav = useNavigate();
  const toast = useToast();

  const MODES: [typeof navMode, string, string][] = [
    ['function', '기능별', '업무 그룹 × 업무 영역 — 기준 메뉴 순서'],
    ['dept', '부서별', '현재 역할이 담당하는 업무 영역만'],
    ['plane', 'Plane별', '4 Plane 산출물 경계'],
  ];
  return (
    <div>
      <Breadcrumb />
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">이 설정은 즉시 셸에 적용된다 — 테마·언어는 상단 아이콘과 같은 값을 공유한다</p>

      <div className="row">
        <div className="col card">
          <b>테마</b>
          <div className="row mt" style={{ gap: 6 }}>
            {(['light', 'dark'] as const).map(t => (
              <button key={t} className={'btn' + (theme === t ? ' primary' : '')} onClick={() => dispatch({ t: 'THEME', theme: t })}>{t === 'light' ? '☀ 라이트' : '🌙 다크'}</button>
            ))}
          </div>
          <p className="small muted mt">현재: <b>{theme === 'light' ? '라이트' : '다크'}</b></p>
        </div>
        <div className="col card">
          <b>언어</b>
          <div className="row mt" style={{ gap: 6 }}>
            {(['ko', 'en'] as const).map(l => (
              <button key={l} className={'btn' + (lang === l ? ' primary' : '')} onClick={() => dispatch({ t: 'LANG', lang: l })}>{l === 'ko' ? '한국어' : 'English'}</button>
            ))}
          </div>
          <p className="small muted mt">현재: <b>{lang.toUpperCase()}</b> · 라벨 원천은 셸 사전과 업무 영역 이름</p>
        </div>
      </div>

      <div className="card mt">
        <b>기본 내비게이션</b>
        <div className="row mt" style={{ gap: 6 }}>
          {MODES.map(([m, label, desc]) => (
            <button key={m} className={'btn' + (navMode === m ? ' primary' : '')} title={desc} onClick={() => dispatch({ t: 'SET_NAV_MODE', mode: m })}>{label}</button>
          ))}
        </div>
        <p className="small muted mt">{MODES.find(m => m[0] === navMode)?.[2]}</p>
      </div>

      <div className="card mt">
        <b>접속 역할과 기본 화면</b>
        <p className="small muted">역할을 바꾸면 그 역할이 실제로 쓰는 화면으로 이동한다.</p>
        <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
          {roles.map(r => (
            <button key={r} className={'btn' + (r === role ? ' primary' : '')} onClick={() => { dispatch({ t: 'ROLE', role: r }); toast(`${roleLabel(r)} 로 전환`); nav(ROLE_HOME[r] || '/'); }}>
              {roleLabel(r)} <span className="muted small">{ROLE_HOME[r]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card mt">
        <div className="kv">
          <div>테넌트</div><div>HMC-Global</div>
          <div>접속자</div><div>{profileOf(role).name} · 사번 {profileOf(role).empNo}</div>
          <div>소속</div><div>{profileOf(role).org}</div>
          <div>로케일</div><div>한국어 (KO-primary) + English</div>
          <div>저장 계층</div><div>브라우저 저장소 (서버 연계는 LOCAL_UI_ONLY)</div>
          <div>감사 기록</div><div>{state.audit.length}건</div>
          <div>홈 위젯</div><div>{state.homeWidgets.filter(w => w.on).length} / {state.homeWidgets.length} 켜짐 <button className="btn" style={{ marginLeft: 8 }} onClick={() => nav('/home/customize')}>홈에서 편집 →</button></div>
        </div>
      </div>
    </div>
  );
}

export function NotificationsCenter() {
  const { state } = useApp();
  const nav = useNavigate();
  const [filter, setFilter] = useState<'all' | 'alert' | 'task' | 'info'>('all');
  const items = useMemo(() => {
    const out: { ts: string; type: 'alert' | 'task' | 'info'; text: string; to: string }[] = [];
    state.incidents.filter(i => i.status !== 'closed').forEach(i => out.push({
      ts: i.id, type: 'alert', text: `${i.feature} ${i.severity} 장애 — ${i.title}`, to: '/ops/incident',
    }));
    if (state.live.failRate > 5) out.push({ ts: `tick ${state.live.tick}`, type: 'alert', text: `활성화 실패율 ${state.live.failRate}% — 임계 초과`, to: '/ops/telemetry' });
    state.security.certs.filter(c => daysUntil(c.expiry) < 180).forEach(c => out.push({
      ts: `${daysUntil(c.expiry)}일 남음`, type: 'alert', text: `${c.name} 만료 ${c.expiry}`, to: '/admin/security',
    }));
    state.crs.filter(c => c.status === 'Reviewed').forEach(c => out.push({
      ts: c.id, type: 'task', text: `${c.id} 승인 대기 (담당 ${c.owner})`, to: `/change/cr/${c.id}`,
    }));
    state.bomBaselines.filter(b => b.state === 'IN_REVIEW').forEach(b => out.push({
      ts: b.id, type: 'task', text: `${b.id}@${b.version} 기준선 승인 대기`, to: '/master/bom',
    }));
    state.exceptions.filter(e => e.active).forEach(e => out.push({
      ts: e.expiry, type: 'task', text: `${e.id} 예외 유효 — 만료 전 재심의`, to: '/policy/exception',
    }));
    state.syncLogs.filter(l => l.status !== 'ok').forEach(l => out.push({
      ts: l.ts, type: 'info', text: `${l.conn} ${l.event}`, to: '/integration/sync',
    }));
    const last = state.pipeline.logs[state.pipeline.logs.length - 1];
    if (last) out.push({ ts: `stage ${state.pipeline.stage + 1}`, type: 'info', text: last, to: '/release/cicd' });
    return out;
  }, [state]);
  const shown = filter === 'all' ? items : items.filter(i => i.type === filter);
  const tone = (t: string) => (t === 'alert' ? 'var(--fail)' : t === 'task' ? 'var(--brand)' : '#6B7280');

  return (
    <div>
      <Breadcrumb />
      <h1 className="page-title">Notifications</h1>
      <p className="page-sub">운영 중인 객체에서 파생한 알림 — 목록을 따로 저장하지 않으므로 원천이 바뀌면 즉시 따라온다</p>
      <div className="row mt" style={{ gap: 6 }}>
        {(['all', 'alert', 'task', 'info'] as const).map(f => (
          <button key={f} className={'btn' + (filter === f ? ' primary' : '')} onClick={() => setFilter(f)}>
            {f === 'all' ? '전체' : f} {f === 'all' ? items.length : items.filter(i => i.type === f).length}
          </button>
        ))}
      </div>
      <div className="card mt">
        {shown.length === 0 ? <EmptyState title="알림 없음" /> : shown.map((n, i) => (
          <div className="evt" key={n.type + n.ts + i} role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') nav(n.to); }}
            onClick={() => nav(n.to)}>
            <span className="pill" style={{ background: tone(n.type), color: '#fff' }}>{n.type}</span>
            <span>{n.text}</span>
            <span className="muted small" style={{ marginLeft: 'auto' }}>{n.ts}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
