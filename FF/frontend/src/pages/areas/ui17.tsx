// UI17 사용자 범위와 권한 — 정본 상세 영역 6개 본문.
//
// 이 화면이 지키는 구분:
//  · 표시되는 권한은 안내다 — 실제 권한은 서버가 매 요청 다시 판단한다
//  · 역할·범위 선택은 표시를 바꿀 뿐 권한을 얻지 못한다(요청은 감사 기록으로만 남는다)
//  · 자기 승인과 대행 승인은 같은 principal 에서 성립하지 않는다
//  · 비밀 원문은 어떤 역할에도 표시하지 않는다 — 참조 ID 와 위임만 보여준다
import { useMemo, useState, type ReactNode } from 'react';
import { CanonicalScreen, FIELD, Gated, Reasons, Table, type Kpi } from '../../components/AreaScreen';
import { UlBadge, UlRules, UlTally, ulBlocks, ulWarns, type UlRule } from '../../components/ulRules';
import { useApp, useToast } from '../../store';
import { auditLog, permMatrix, roleKeyOf, roleLabel, roles, users } from '../../data/refdata';
import { SPEC_ROLES } from '../../data/specNav';

/** 데모 기준 시각 — 화면 안에서 만드는 기록의 타임스탬프. */
const NOW = '2026-09-16 20:15';

// ── 정본 상태 (ACTIVE / PENDING / EXPIRED / REVOKED) ─────────────────────
type St = 'ACTIVE' | 'PENDING' | 'EXPIRED' | 'REVOKED';
const ST_ORDER: St[] = ['ACTIVE', 'PENDING', 'EXPIRED', 'REVOKED'];
const ST_KO: Record<St, string> = { ACTIVE: '유효', PENDING: '승인 대기', EXPIRED: '기간 만료', REVOKED: '철회' };
const ST_TONE: Record<St, string> = {
  ACTIVE: 'var(--pass)', PENDING: 'var(--pending)', EXPIRED: 'var(--fail)', REVOKED: 'var(--fail)',
};

// ── 동작류 4종 — 정본 열(조회·편집·검토·승인·운영 실행)의 축 ─────────────
type VC = 'view' | 'edit' | 'approve' | 'run';
const VC_ORDER: VC[] = ['view', 'edit', 'approve', 'run'];
const VC_KO: Record<VC, string> = { view: '조회', edit: '편집', approve: '검토·승인', run: '운영 실행' };
const VERB_OF: Record<VC, string[]> = {
  view: ['view'], edit: ['create', 'edit'], approve: ['approve'],
  run: ['run-engine', 'deploy', 'kill', 'rollback'],
};
const verbsOf = (role: string) => permMatrix[role] || [];
const roleVC = (role: string): VC[] => VC_ORDER.filter(vc => VERB_OF[vc].some(v => verbsOf(role).includes(v)));

// ── 범위(scope) 원천 — OEM · 프로젝트 · 시장 · 환경 ─────────────────────
type ScopeKind = 'OEM' | 'PROJECT' | 'MARKET' | 'ENV';
const SCOPE_KINDS: ScopeKind[] = ['OEM', 'PROJECT', 'MARKET', 'ENV'];
interface ScopeDef { id: string; kind: ScopeKind; label: string; note: string }
const SCOPES: ScopeDef[] = [
  { id: 'OEM:HMC', kind: 'OEM', label: 'HMC 본사', note: 'OEM 조직' },
  { id: 'OEM:SUP-BDC-A', kind: 'OEM', label: '협력사 SUP-BDC-A', note: '공급사 — 조회·제안만' },
  { id: 'PRJ:BDC-2027', kind: 'PROJECT', label: 'BDC-2027', note: 'Body 도메인 프로젝트' },
  { id: 'PRJ:LIGHT-ADAS-2027', kind: 'PROJECT', label: 'LIGHT-ADAS-2027', note: 'ADAS 프로젝트' },
  { id: 'MKT:KR', kind: 'MARKET', label: 'KR', note: '국내 시장' },
  { id: 'MKT:EU', kind: 'MARKET', label: 'EU', note: 'GDPR — 원시 Context 반입 금지' },
  { id: 'ENV:PROD', kind: 'ENV', label: 'PROD', note: '생산 환경 — 이중 통제' },
  { id: 'ENV:STAGE', kind: 'ENV', label: 'STAGE', note: '검증 환경' },
  { id: 'ENV:DEV', kind: 'ENV', label: 'DEV', note: '개발 환경' },
];
const scopeKo = (id: string) => {
  const s = SCOPES.find(x => x.id === id);
  return s ? `${s.kind} · ${s.label}` : id;
};

/** 범위가 막는 동작 — 막는 이유를 그대로 남긴다(서버도 같은 이유로 거부한다). */
const scopeLimit = (scope: string, role: string, vc: VC): string | null => {
  if (scope === 'OEM:SUP-BDC-A' && vc !== 'view') return '협력사 범위 — 조회·제안만, 편집·승인·운영 실행 불가';
  if (scope === 'MKT:EU' && vc === 'run') return 'EU 시장 — 운영 실행은 차량 운영·시스템 연계 역할만';
  if (scope === 'ENV:PROD' && (vc === 'run' || vc === 'approve') && !['operator', 'integrator', 'approver'].includes(role)) {
    return 'PROD 환경 — 승인·운영 실행은 운영·승인·통합 역할만';
  }
  if (scope === 'ENV:DEV' && vc === 'approve') return 'DEV 환경 — 승인 입력 대상이 아니다';
  return null;
};

// ── 접근 표 셀 — 허용/제한/불가와 그 이유 ───────────────────────────────
type Kind = '허용' | '제한' | '불가';
interface Cell { k: Kind; why?: string }
const OK: Cell = { k: '허용' };
const NO = (why: string): Cell => ({ k: '불가', why });
const LIM = (why: string): Cell => ({ k: '제한', why });
const cells = (view: Cell, edit: Cell, approve: Cell, run: Cell): Record<VC, Cell> => ({ view, edit, approve, run });
const pairCell = (role: string, scope: string, vc: VC): Cell => {
  if (!roleVC(role).includes(vc)) return NO(`${roleLabel(role)} 에게 ${VC_KO[vc]} verb 없음`);
  const limit = scopeLimit(scope, role, vc);
  return limit ? LIM(limit) : OK;
};

// ── 부여(권한 원장) ────────────────────────────────────────────────────
interface Grant {
  id: string;
  account: string;
  name: string;
  kind: 'person' | 'service';
  org: string;
  roleKeys: string[];
  scopeIds: string[];
  from: string;
  to: string;
  approver: string;
  state: St;
  reason?: string;
  iam: string;
}
/** 역할별 범위 시드 — 원천 IAM 동기화 값. */
const SEED_SCOPES: Record<string, string[]> = {
  author: ['PRJ:BDC-2027', 'MKT:KR', 'ENV:DEV'],
  approver: ['PRJ:BDC-2027', 'MKT:KR', 'ENV:STAGE'],
  quality: ['PRJ:LIGHT-ADAS-2027', 'MKT:KR', 'ENV:STAGE'],
  operator: ['PRJ:BDC-2027', 'MKT:KR', 'MKT:EU', 'ENV:PROD'],
  steward: ['PRJ:BDC-2027', 'ENV:STAGE'],
  commerce: ['MKT:KR', 'MKT:EU'],
  integrator: ['OEM:HMC', 'OEM:SUP-BDC-A', 'PRJ:BDC-2027', 'PRJ:LIGHT-ADAS-2027', 'MKT:KR', 'MKT:EU', 'ENV:PROD'],
  coordinator: ['PRJ:LIGHT-ADAS-2027', 'MKT:KR'],
  viewer: ['MKT:KR'],
};
const ROLE_GRANTS: Grant[] = SPEC_ROLES.map((r, i) => {
  const st: St = r.key === 'coordinator' ? 'PENDING' : 'ACTIVE';
  return {
    id: `UI17-G-${String(i + 1).padStart(2, '0')}`,
    account: r.id, name: r.name, kind: 'person', org: r.group,
    roleKeys: [r.key], scopeIds: SEED_SCOPES[r.key] || ['MKT:KR'],
    from: '2026-07-01', to: '2026-12-31',
    approver: st === 'PENDING' ? '—' : '이지수 (구성 승인)',
    state: st,
    reason: st === 'PENDING' ? '역할 부여 승인 대기 — 승인자 미지정' : undefined,
    iam: `IAM 연결됨 · ${r.id} · group ${r.group}`,
  };
});
const EXTRA_GRANTS: Grant[] = [
  {
    id: 'UI17-G-10', account: 'usr-sup-qa', name: '권태윤', kind: 'person', org: '협력사 품질 (SUP-BDC-A)',
    roleKeys: ['viewer'], scopeIds: ['OEM:SUP-BDC-A'], from: '2026-03-01', to: '2026-08-31',
    approver: '이지수 (구성 승인)', state: 'EXPIRED',
    reason: '기간 종료 — 재부여는 원천 IAM 에서 다시 신청한다', iam: 'IAM 연결됨 · group SUP-BDC-A/QA',
  },
  {
    id: 'UI17-G-11', account: 'usr-temp-audit', name: '문지원', kind: 'person', org: '감사 (임시)',
    roleKeys: ['viewer'], scopeIds: ['OEM:HMC', 'MKT:KR', 'ENV:PROD'], from: '2026-05-02', to: '2026-06-30',
    approver: '윤도현 (시스템 연계)', state: 'REVOKED',
    reason: '감사 종료 후 철회 — 조회 기록은 보존한다', iam: '미연결 · 로컬 임시 계정 (감사 종료 시 폐기)',
  },
  {
    id: 'UI17-G-12', account: 'svc-unleash-sync', name: 'svc-unleash-sync', kind: 'service', org: '연계 서비스',
    roleKeys: ['integrator'], scopeIds: ['PRJ:BDC-2027', 'ENV:STAGE'], from: '2026-01-05', to: '2026-10-01',
    approver: '윤도현 (시스템 연계)', state: 'ACTIVE',
    iam: 'IAM 연결됨 · 서비스 계정 (사람 principal 아님)',
  },
];
const GRANT_SEED: Grant[] = [...ROLE_GRANTS, ...EXTRA_GRANTS];

/** 부여 하나의 동작류 판정 — 범위가 좁은 쪽이 이긴다. */
const grantCell = (g: Grant, vc: VC): Cell => {
  if (g.state !== 'ACTIVE') return LIM(`${g.state} — ${g.reason || ST_KO[g.state]}`);
  if (!g.roleKeys.some(r => roleVC(r).includes(vc))) {
    return NO(`${g.roleKeys.map(roleLabel).join(' · ')} 에게 ${VC_KO[vc]} verb 없음`);
  }
  for (const s of g.scopeIds) {
    const limit = scopeLimit(s, g.roleKeys[0], vc);
    if (limit) return LIM(limit);
  }
  return OK;
};

// ── 접근 표 공통 (S02·S03·S04·S05 = 정본 동일 열) ──────────────────────
interface AccessRow {
  id: string;
  subject: string;
  sub: string;
  scope: string;
  cells: Record<VC, Cell>;
  state: St;
  valid: string;
}
const ACCESS_COLS = ['주체 또는 역할', 'scope', '조회', '편집', '검토·승인', '운영 실행', '유효성'];
const S01_COLS = ['사용자', '조직', '역할', '범위', '유효기간', '승인자', '상태'];
const S06_COLS = ['시각', '단계', '대상 및 버전', '명령 또는 상관 ID', '결과', '다음 담당'];

function CellText({ c }: { c: Cell }) {
  const tone = c.k === '허용' ? 'var(--pass)' : c.k === '제한' ? 'var(--fail)' : 'var(--muted)';
  return <span title={c.why || c.k} style={{ color: tone, fontWeight: 600 }}>{c.k}</span>;
}

function AccessTable({ rows, pick, onPick, tag }: { rows: AccessRow[]; pick: string; onPick: (id: string) => void; tag?: string }) {
  return (
    <Table head={ACCESS_COLS}>
      {rows.map(r => (
        <tr key={r.id} onClick={() => onPick(r.id)} style={{ cursor: 'pointer', background: r.id === pick ? 'var(--surface-2)' : undefined }}>
          <td><b>{r.subject}</b><div className="small muted">{r.sub}{tag ? ` · ${tag}` : ''}</div></td>
          <td className="small mono">{r.scope}</td>
          {VC_ORDER.map(vc => <td key={vc} style={{ textAlign: 'center' }}><CellText c={r.cells[vc]} /></td>)}
          <td className="small"><span className="pill" style={{ background: ST_TONE[r.state], color: '#fff', borderColor: 'transparent' }}>{r.state}</span><div className="small muted">{r.valid}</div></td>
        </tr>
      ))}
    </Table>
  );
}

/** 선택 행의 막는 이유 — 표에 담기 어려운 사유를 그대로 편다. */
const rowBlocks = (r: AccessRow | undefined, what = '선택된 주체'): string[] => {
  if (!r) return [`${what}가 선택되지 않았다`];
  const out = VC_ORDER.filter(v => r.cells[v].k !== '허용')
    .map(v => `${VC_KO[v]} ${r.cells[v].k} — ${r.cells[v].why || '-'}`);
  if (r.state !== 'ACTIVE') out.push(`유효성 ${r.state} (${ST_KO[r.state]}) — ${r.valid}`);
  return out;
};

const Pill = ({ s, tone }: { s: string; tone?: string }) => (
  <span className="pill" style={{ background: tone || 'var(--surface-2)', color: tone ? '#fff' : 'var(--muted)', borderColor: 'transparent' }}>{s}</span>
);
const Note = ({ children }: { children: ReactNode }) => <p className="small muted" style={{ marginTop: 8 }}>{children}</p>;

function UlTitle({ items }: { items: UlRule[] }) {
  return (
    <span className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
      <span>이 영역에 걸린 검토 항목</span>
      {items.map(i => <UlBadge key={i.ul} ul={i.ul} verdict={i.verdict} />)}
    </span>
  );
}

// ═══════════════════ S03 직무 분리와 대행 시드 ═══════════════════
const SOD_SEED: (AccessRow & { owner: string; req: string })[] = [
  {
    id: 'SOD-01', subject: '박유진 (품질 검토)', sub: '독립 검증 — 대상 작성자와 다른 principal', owner: '품질 검토',
    scope: 'PRJ:LIGHT-ADAS-2027 · ENV:STAGE', req: '없음',
    cells: cells(OK, LIM('검증 독립성 — 검증 대상 편집 불가'), OK, NO('품질 검토 역할에 운영 실행 verb 없음')),
    state: 'ACTIVE', valid: '2026-07-01 ~ 2026-12-31',
  },
  {
    id: 'SOD-02', subject: '정수빈 (협의와 개발 이관)', sub: '요청자 = 승인자 후보 1건', owner: 'Feature 조정',
    scope: 'PRJ:LIGHT-ADAS-2027', req: 'REQ-2026-0918 (본인 작성)',
    cells: cells(OK, OK, LIM('자기 승인 금지 — 동일 principal 이 요청한 건의 승인'), OK),
    state: 'PENDING', valid: '2026-09-02 ~ 2026-12-31',
  },
  {
    id: 'SOD-03', subject: '서준호 (차량 운영)', sub: '운영 실행과 승인 동시 보유', owner: 'Feature 운영',
    scope: 'PRJ:BDC-2027 · ENV:PROD', req: '없음',
    cells: cells(OK, OK, LIM('운영 실행 역할은 승인 입력을 대신하지 않는다 — 승인은 구성 승인 역할'), OK),
    state: 'ACTIVE', valid: '2026-07-01 ~ 2026-12-31',
  },
  {
    id: 'DLG-01', subject: '대행 이지수 → 박유진', sub: '대행자 이지수 · 위임자 박유진', owner: '구성 승인',
    scope: 'PRJ:LIGHT-ADAS-2027 · ENV:STAGE', req: '대행 승인 요청 1건',
    cells: cells(OK, OK, LIM('대행은 승인 입력까지 넘기지 않는다 — 승인은 위임자 계정으로만'), NO('운영 실행 대행 금지')),
    state: 'ACTIVE', valid: '2026-09-16 ~ 2026-09-23',
  },
  {
    id: 'DLG-02', subject: '대행 김민영 → 윤도현', sub: '대행자 김민영 · 위임자 윤도현', owner: '시스템 연계',
    scope: 'MKT:KR · ENV:DEV', req: '대행 승인 요청 1건 (승인자 미지정)',
    cells: cells(OK, LIM('승인 전 — 편집 범위 확정 안 됨'), NO('승인 전 — 승인 입력 불가'), LIM('승인 전 — 운영 실행 불가')),
    state: 'PENDING', valid: '요청 2026-09-15 · 승인 대기',
  },
  {
    id: 'DLG-03', subject: '대행 문지원 → 나지현', sub: '철회된 대행 · 사유 기록 있음', owner: '기준정보 운영',
    scope: 'PRJ:BDC-2027', req: '없음',
    cells: cells(LIM('철회 — 조회도 부여 원장 기준으로만'), LIM('철회'), LIM('철회'), LIM('철회')),
    state: 'REVOKED', valid: '2026-06-01 ~ 2026-06-30 (철회 2026-06-18)',
  },
];

// ═══════════════════ S04 세션과 SSO 시드 ═══════════════════
interface SessionRow extends AccessRow {
  idp: string;
  mfa: string;
  device: string;
  idle: string;
  abs: string;
  reauthNote: string;
}
const SESSION_SEED: SessionRow[] = [
  {
    id: 'SES-8841', subject: '서준호 (차량 운영)', sub: '세션 SES-8841 · OIDC', scope: 'PRJ:BDC-2027 · ENV:PROD',
    cells: cells(OK, OK, OK, OK), state: 'ACTIVE', valid: '2026-09-16 08:12 발급 · 절대 만료 20:12',
    idp: 'HMC IdP (OIDC)', mfa: 'MFA 통과 (TOTP)', device: '관리자 PC · KR-서울',
    idle: '유휴 12분 / 30분', abs: '잔여 0시간 00분', reauthNote: '재인증 불필요',
  },
  {
    id: 'SES-8837', subject: '윤도현 (시스템 연계)', sub: '세션 SES-8837 · OIDC', scope: 'OEM:HMC · ENV:PROD',
    cells: cells(OK, OK, OK, OK), state: 'ACTIVE', valid: '2026-09-16 07:40 발급 · 절대 만료 19:40',
    idp: 'HMC IdP (OIDC)', mfa: 'MFA 통과 (FIDO2)', device: '통합 운영 콘솔 · KR-서울',
    idle: '유휴 4분 / 30분', abs: '잔여 0시간 00분', reauthNote: '재인증 불필요',
  },
  {
    id: 'SES-8830', subject: '박유진 (품질 검토)', sub: '세션 SES-8830 · OIDC', scope: 'PRJ:LIGHT-ADAS-2027 · ENV:STAGE',
    cells: cells(LIM('재인증 전 — 조회만 가능'), NO('재인증 전 — 편집 불가'), NO('재인증 전 — 승인 입력 불가'), NO('재인증 전 — 운영 실행 불가')),
    state: 'PENDING', valid: '유휴 한계 초과 (32분 / 30분) · 재인증 대기',
    idp: 'HMC IdP (OIDC)', mfa: '재인증 필요 (세션 만료)', device: '검증 노트북 · KR-화성',
    idle: '유휴 32분 / 30분', abs: '잔여 3시간 41분', reauthNote: '다음 동작 전 재인증 필요',
  },
  {
    id: 'SES-8722', subject: '최지훈 (조회)', sub: '세션 SES-8722 · SAML', scope: 'MKT:KR',
    cells: cells(LIM('만료 — 어떤 동작도 보장되지 않는다'), LIM('만료'), LIM('만료'), LIM('만료')),
    state: 'EXPIRED', valid: '2026-09-15 18:05 절대 만료',
    idp: 'HMC IdP (SAML)', mfa: '만료로 무효', device: '외부 열람 단말 · KR-서울',
    idle: '—', abs: '만료', reauthNote: '만료 — 재로그인 필요',
  },
  {
    id: 'SES-SVC-004', subject: 'svc-unleash-sync (서비스)', sub: '세션 SES-SVC-004 · 서비스 토큰 인증', scope: 'PRJ:BDC-2027 · ENV:STAGE',
    cells: cells(OK, OK, NO('서비스 계정은 승인 입력 불가 — 승인은 사람 principal 만'), LIM('토큰 범위 밖 — 운영 실행 불가')),
    state: 'REVOKED', valid: '2026-09-10 토큰 교체로 종료',
    idp: '토큰 인증 (OIDC 아님)', mfa: '해당 없음', device: '연계 워커 · KR-서울',
    idle: '—', abs: '종료', reauthNote: '토큰 교체로 종료 — 재사용 불가',
  },
];

/** IdP 그룹 → FP 역할 매핑 (SSO·SCIM 동기화 범위). */
const SSO_ROWS = [
  { group: 'HMC-FP-AUTHOR', role: 'author', scope: 'PRJ:BDC-2027 · ENV:DEV', auto: 'viewer (최소권한, 승인 전)', sync: '2026-09-16 06:10', state: '동기화 정상' },
  { group: 'HMC-FP-APPROVER', role: 'approver', scope: 'PRJ:BDC-2027 · ENV:STAGE', auto: 'viewer (최소권한, 승인 전)', sync: '2026-09-16 06:10', state: '동기화 정상' },
  { group: 'HMC-FP-QUALITY', role: 'quality', scope: 'PRJ:LIGHT-ADAS-2027 · ENV:STAGE', auto: 'viewer (최소권한, 승인 전)', sync: '2026-09-16 06:11', state: '동기화 정상' },
  { group: 'HMC-FP-OPERATOR', role: 'operator', scope: 'MKT:KR · MKT:EU · ENV:PROD', auto: 'viewer (최소권한, 승인 전)', sync: '2026-09-16 06:11', state: '동기화 정상' },
  { group: 'SUP-BDC-A/QA', role: 'viewer', scope: 'OEM:SUP-BDC-A', auto: 'viewer', sync: '2026-09-16 06:12', state: '미매핑 그룹 1건 — 역할 부여는 수동' },
];

// ═══════════════════ S05 서비스 자격과 키 참조 시드 ═══════════════════
interface CredRow extends AccessRow {
  token: string;
  secretRef: string;
  delegate: string;
  rotateDue: string;
  plain: string;
}
const CRED_SEED: CredRow[] = [
  {
    id: 'SVC-UNLEASH-SYNC', subject: 'svc-unleash-sync', sub: 'endpoint/project 환경 동기화', scope: 'PRJ:BDC-2027 · ENV:STAGE',
    cells: cells(OK, OK, NO('서비스 계정은 승인 입력 불가'), LIM('토글 실행은 지정 endpoint 범위만')),
    state: 'ACTIVE', valid: '2026-01-05 ~ 2026-10-01',
    token: 'pat-••••41ab', secretRef: 'vault:kvv2/fp/unleash#token', delegate: 'Unleash provider (OpenFeature)',
    rotateDue: '2026-10-01 (잔여 15일)', plain: '미보관 — 참조만',
  },
  {
    id: 'SVC-IAM-SCIM', subject: 'svc-iam-scim', sub: 'SCIM 사용자·그룹 동기화', scope: 'OEM:HMC',
    cells: cells(OK, LIM('사용자·그룹 속성만 — 권한 부여는 불가'), NO('서비스 계정은 승인 입력 불가'), NO('운영 실행 verb 없음')),
    state: 'ACTIVE', valid: '2026-02-01 ~ 2027-02-01',
    token: 'scim-••••7c02', secretRef: 'vault:kvv2/fp/scim#token', delegate: 'HMC IdP (관리자 API)',
    rotateDue: '2027-02-01 (잔여 138일)', plain: '미보관 — 참조만',
  },
  {
    id: 'SVC-PKI-SIGNER', subject: 'svc-pki-signer', sub: '차량 발행 서명 (HSM 위임)', scope: 'PRJ:BDC-2027 · MKT:KR',
    cells: cells(OK, NO('서명만 — 정책 편집 불가'), LIM('서명 결과는 승인 입력이 아니다'), LIM('배포 실행 불가 — 서명 전용')),
    state: 'ACTIVE', valid: '2026-01-20 ~ 2027-01-20',
    token: '해당 없음 (HSM 키 참조)', secretRef: 'hsm:fp-signer/slot-3', delegate: 'PKI 서명 서비스 (키는 HSM 밖으로 나가지 않음)',
    rotateDue: '2027-01-20 (잔여 126일)', plain: 'HSM 밖으로 나가지 않음',
  },
  {
    id: 'SVC-OTA-PUBLISH', subject: 'svc-ota-publish', sub: 'OTA 전달 접수', scope: 'MKT:KR · ENV:PROD',
    cells: cells(OK, NO('회전 대기 — 편집 중단'), LIM('승인 입력 불가'), LIM('회전 완료 전 운영 실행 중단')),
    state: 'PENDING', valid: '2026-09-14 회전 요청 · 완료 대기',
    token: 'rot-••••0d19', secretRef: 'vault:kvv2/fp/ota#token', delegate: 'OTA 플랫폼',
    rotateDue: '회전 진행 중 (요청 2026-09-14)', plain: '미보관 — 참조만',
  },
  {
    id: 'SVC-LEGACY-ADMIN', subject: 'svc-legacy-admin', sub: 'deprecated Admin 토큰', scope: 'OEM:HMC · ENV:PROD',
    cells: cells(LIM('EXPIRED — 폐기 절차 진행 중'), LIM('폐기 대상'), LIM('폐기 대상'), LIM('폐기 대상')),
    state: 'EXPIRED', valid: '2026-08-31 만료 · 재발급 없음',
    token: 'adm-••••(폐기)', secretRef: 'vault:kvv2/fp/legacy-admin#old', delegate: '—',
    rotateDue: '중단 (deprecated)', plain: '폐기 절차 진행',
  },
  {
    id: 'SVC-MCP-READONLY', subject: 'svc-mcp-readonly', sub: '개발 지원 도구 조회 (MCP)', scope: 'PRJ:BDC-2027 · ENV:DEV',
    cells: cells(OK, NO('조회 전용 — 생산 권한 없음'), NO('승인 입력 불가'), NO('생산 권한 없음')),
    state: 'ACTIVE', valid: '2026-08-01 ~ 2026-11-01',
    token: 'mcp-••••22f0', secretRef: 'vault:kvv2/fp/mcp#token', delegate: '개발 지원 도구 (조회 후보)',
    rotateDue: '2026-11-01 (잔여 46일)', plain: '미보관 — 참조만',
  },
  {
    id: 'SVC-SUP-EXPORT', subject: 'svc-sup-export', sub: '협력사 내보내기 (조회+내보내기)', scope: 'OEM:SUP-BDC-A',
    cells: cells(OK, NO('협력사 범위 — 편집 불가'), NO('승인 입력 불가'), NO('운영 실행 불가')),
    state: 'REVOKED', valid: '2026-06-18 계약 종료로 철회',
    token: 'sup-••••(철회)', secretRef: 'vault:kvv2/fp/sup-export#old', delegate: '—',
    rotateDue: '중단 (철회)', plain: '철회 — 재사용 불가',
  },
];

/** 비밀 참조 — 원문 대신 참조와 위임만 남긴다. */
const KEY_REFS = [
  { id: 'vault:kvv2/fp/unleash#token', kind: 'Vault KV v2 참조', delegate: 'Unleash provider', cycle: '90일', exp: '2026-10-01', plain: '미보관 (참조만)' },
  { id: 'vault:kvv2/fp/scim#token', kind: 'Vault KV v2 참조', delegate: 'HMC IdP 관리자 API', cycle: '365일', exp: '2027-02-01', plain: '미보관 (참조만)' },
  { id: 'hsm:fp-signer/slot-3', kind: 'HSM 키 슬롯 (PKI 위임)', delegate: 'PKI 서명 서비스', cycle: '12개월', exp: '2027-01-20', plain: 'HSM 밖으로 나가지 않음' },
  { id: 'vault:kvv2/fp/ota#token', kind: 'Vault KV v2 참조', delegate: 'OTA 플랫폼', cycle: '180일', exp: '회전 진행 중', plain: '미보관 (참조만)' },
  { id: 'vault:kvv2/fp/legacy-admin#old', kind: 'deprecated Admin PAT', delegate: '—', cycle: '중단', exp: '2026-08-31 만료', plain: '폐기 절차 진행' },
];

// ═══════════════════ S06 보존과 감사 시드 ═══════════════════
interface TlRow { ts: string; step: string; target: string; corr: string; result: string; next: string; ok: boolean }
const TIMELINE_SEED: TlRow[] = [
  { ts: '2026-09-16 09:41', step: '접수', target: 'FEAT-BDC-001@1.1.0', corr: 'cmd-7f3a21', result: '권한 검사 통과 — PRJ:BDC-2027 · ENV:PROD', next: '서버 처리', ok: true },
  { ts: '2026-09-16 09:41', step: '처리', target: 'FEAT-BDC-001@1.1.0', corr: 'cmd-7f3a21', result: 'ACTIVE 부여 확인 · 세션 SES-8841 유효', next: '결과 회신', ok: true },
  { ts: '2026-09-16 09:42', step: '결과', target: 'FEAT-BDC-001@1.1.0', corr: 'cmd-7f3a21', result: '적용 완료 · 재판단 불필요', next: '—', ok: true },
  { ts: '2026-09-16 08:57', step: '접수', target: 'POLICY-LIGHT-WELCOME@1.0', corr: 'cmd-51cd08', result: '거부 — 403 · 역할 viewer 에게 approve verb 없음', next: '권한 재부여 검토', ok: false },
  { ts: '2026-09-16 07:20', step: '감사', target: 'UI17-G-12 (svc-unleash-sync)', corr: 'cmd-audi-03', result: '토큰 회전 예정 — 잔여 15일', next: '연계 담당', ok: true },
  { ts: '2026-09-15 18:05', step: '결과', target: 'SES-8722 (최지훈)', corr: 'cmd-audi-02', result: '세션 만료 — 이후 요청 전부 거부', next: '조회자 재로그인', ok: false },
  { ts: '2026-09-15 14:30', step: '처리', target: 'DLG-01 (대행 이지수)', corr: 'cmd-audi-01', result: '대행 활성 · 2026-09-16 ~ 2026-09-23 · 승인 대행 불가', next: '요청 처리', ok: true },
  { ts: '2026-09-14 11:02', step: '감사', target: 'UI17-G-10 (usr-sup-qa)', corr: 'cmd-audi-04', result: '기간 만료로 조회 거부 — 재부여는 원천 IAM 신청', next: '협력사 담당', ok: false },
];
const RETENTION = [
  { id: 'RP-ACCESS-KR', region: 'KR', period: '5년', target: '권한 부여·변경·접근 거부 기록', export: '승인 후 마스킹 내보내기', expires: '2031-09-16', state: 'ACTIVE' },
  { id: 'RP-ACCESS-EU', region: 'EU', period: '3년', target: '권한 부여·변경 기록', export: '승인 후 마스킹 내보내기', expires: '2029-09-16', state: 'ACTIVE' },
  { id: 'RP-SESSION-KR', region: 'KR', period: '1년', target: '세션·재인증·철회 기록', export: '내보내기 불가', expires: '2027-09-16', state: 'ACTIVE' },
  { id: 'RP-RAW-CTX-EU', region: 'EU', period: '30일', target: '원시 Context (개인정보)', export: '내보내기 금지 — 반입 0건', expires: '2026-10-16', state: 'ACTIVE' },
];

// ═══════════════════ Unleash/OSS 검토 항목 (UL) ═══════════════════
const s01Rules: UlRule[] = [
  {
    ul: 'UL-041', rule: '관리 동작을 resource/action/scope 로 매핑하고 역할 사전 하나로만 부여한다', verdict: 'PASS',
    evidence: `역할 ${roles.length} · 동작류 ${VC_ORDER.length} · scope ${SCOPES.length} · 매핑 없는 동작 0 · 원천 IAM 사용자 ${users.length} 연결`,
  },
  {
    ul: 'UL-077', rule: '화면 ID·빵부스러기·탭은 기존 화면 ID 체계를 그대로 유지한다', verdict: 'PASS',
    evidence: `UI17-S01 동작 3건(상세 패널 UI17-S01-D) · 화면 ID 재사용 · 메뉴 이름 변경 0`,
  },
];
const s02Rules: UlRule[] = [
  {
    ul: 'UL-005', rule: 'OEM·협력사·프로젝트별 권한을 서버에서 따로 검사하고 scope 간 데이터 누설을 막는다', verdict: 'PASS',
    evidence: `scope ${SCOPES.length}개 · 협력사 범위(OEM:SUP-BDC-A) 편집·승인·운영 3동작 차단 · 다른 scope 노출 0건`,
  },
  {
    ul: 'UL-028', rule: '전역 범위 편집·삭제도 승인 통제를 우회하지 못하고 사용처를 노출하지 않는다', verdict: 'WARN',
    evidence: '전역(모든 프로젝트) 편집 요청 경로 1건 — 승인 결속 미구현 · 사용처 조회는 마스킹만 적용',
  },
];
const s03Rules: UlRule[] = [
  {
    ul: 'UL-039', rule: '동일 principal 의 자기 승인·대행 승인을 막고 긴급 예외는 이중 통제로만 연다', verdict: 'FAIL',
    evidence: '요청자 = 승인자 후보 1건(SOD-02 정수빈 · REQ-2026-0918) · break-glass 이중 통제 미구현',
  },
];
const s04Rules: UlRule[] = [
  {
    ul: 'UL-042', rule: 'SSO·SCIM 그룹 매핑은 최소 권한으로만 부여하고 세션 만료를 강제한다', verdict: 'PASS',
    evidence: `IdP 그룹 ${SSO_ROWS.length} · 자동 가입 기본 권한 viewer · 세션 ${SESSION_SEED.length}건 중 재인증 필요 1건 · 만료 1건`,
  },
  {
    ul: 'UL-080', rule: '권한 부족·빈 결과·미저장 변경 상태를 화면이 설명한다', verdict: 'WARN',
    evidence: '빈 결과 안내 문구 미정의 · 미저장 변경 보존은 범위 변경 요청에만 적용',
  },
];
const s05Rules: UlRule[] = [
  {
    ul: 'UL-043', rule: '토큰 종류를 endpoint·project·environment 로 구분하고 비밀 원문을 보관·표시하지 않는다', verdict: 'PASS',
    evidence: `자격 ${CRED_SEED.length}건 · 비밀 참조 ${KEY_REFS.length}건 · 화면 원문 노출 0건 · deprecated 1건 폐기`,
  },
  {
    ul: 'UL-067', rule: '도구 token 인증과 차량 발행 서명 identity 를 분리하고 키 회수 절차를 둔다', verdict: 'WARN',
    evidence: '서명 identity 위임 슬롯 1건(hsm:fp-signer/slot-3) — 회수 후 재서명 절차 미정의',
  },
  {
    ul: 'UL-075', rule: 'MCP·AI·개발 도구에는 생산 권한을 주지 않고 조회 후보로만 관리한다', verdict: 'PASS',
    evidence: '개발 지원 자격 1건(SVC-MCP-READONLY) — 조회만 · 생산 권한 부여 0건',
  },
];
const s06Rules: UlRule[] = [
  {
    ul: 'UL-072', rule: '원시 Context·개인정보는 최소 필드·지역 저장·보존 기간을 지키고 내보내기를 제한한다', verdict: 'PASS',
    evidence: `RetentionProfile ${RETENTION.length}건 · EU 원시 30일 · 내보내기 금지 1건 · 원시 반입 0건`,
  },
];

/** 영역별 배치 — 11개 검토 항목이 어느 영역 본문에 있는지 화면이 스스로 밝힌다. */
const RULES_BY_AREA: { area: string; items: UlRule[] }[] = [
  { area: 'UI17-S01', items: s01Rules },
  { area: 'UI17-S02', items: s02Rules },
  { area: 'UI17-S03', items: s03Rules },
  { area: 'UI17-S04', items: s04Rules },
  { area: 'UI17-S05', items: s05Rules },
  { area: 'UI17-S06', items: s06Rules },
];
const ALL_UL: UlRule[] = RULES_BY_AREA.flatMap(r => r.items);
const AREA_OF_UL: Record<string, string> = {};
RULES_BY_AREA.forEach(r => r.items.forEach(i => { AREA_OF_UL[i.ul] = r.area; }));

/** 화면 머리 요약 — 배정된 검토 항목 11건 전부를 영역과 판정까지 한 줄로 보여준다. */
function UlStrip() {
  return (
    <div className="card mt" style={{ background: 'var(--surface-2)' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 10 }}>
        <b className="small">배정된 Unleash 운영 항목 {ALL_UL.length}건 — 영역별 배치</b>
        <UlTally items={ALL_UL} />
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {ALL_UL.map(i => (
          <span key={i.ul} className="pill" title={`${i.rule} — ${i.evidence}`}>
            <UlBadge ul={i.ul} verdict={i.verdict} />{' '}
            <span className="small muted">{AREA_OF_UL[i.ul]}</span>
          </span>
        ))}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>FAIL·WARN 항목은 자기 영역에서 실행 버튼의 차단 사유가 된다 — 서버는 화면 판정을 신뢰하지 않고 다시 검사한다.</div>
    </div>
  );
}

interface Req { id: string; target: string; change: string; state: string; at: string }
interface Check { id: string; at: string; role: string; scope: string; vc: VC; verdict: '허용' | '거부'; why: string }

// ═══════════════════════════════ 화면 ═══════════════════════════════
export function AccessScope() {
  const { state, dispatch, can } = useApp();
  const toast = useToast();

  const [grants] = useState<Grant[]>(GRANT_SEED);
  const [f01, setF01] = useState({ org: 'ALL', role: 'ALL', state: 'ALL' });
  const [pick01, setPick01] = useState(GRANT_SEED[0].id);
  const [pick02, setPick02] = useState(GRANT_SEED[0].id);
  const [role02, setRole02] = useState('ALL');
  const [scope02, setScope02] = useState('ALL');
  const [probeScope, setProbeScope] = useState('ENV:PROD');
  const [edit, setEdit] = useState<{ scopes: string[]; vc: VC[] }>({ scopes: ['PRJ:BDC-2027', 'ENV:DEV'], vc: ['view', 'edit'] });
  const [pending, setPending] = useState<Record<string, string>>({});
  const [reqs, setReqs] = useState<Req[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [pick03, setPick03] = useState(SOD_SEED[0].id);
  const [deleg, setDeleg] = useState(SOD_SEED);
  const [sessions, setSessions] = useState<SessionRow[]>(SESSION_SEED);
  const [pick04, setPick04] = useState(SESSION_SEED[0].id);
  const [pick05, setPick05] = useState(CRED_SEED[0].id);
  const [rotateReq, setRotateReq] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');

  const audited = (action: string, target: string, detail: string) =>
    dispatch({ t: 'AUDIT', entry: { ts: NOW, actor: state.role, action, target, detail } });

  const reqId = `REQ-UI17-${String(reqs.length + 1).padStart(3, '0')}`;
  const pushReq = (target: string, change: string, state_: string) =>
    setReqs(list => [...list, { id: `REQ-UI17-${String(list.length + 1).padStart(3, '0')}`, target, change, state: state_, at: NOW }]);

  // ── S01 필터 ────────────────────────────────────────────────────────
  const rows01 = useMemo(() => grants.filter(g =>
    (f01.org === 'ALL' || g.org.includes(f01.org)) &&
    (f01.role === 'ALL' || g.roleKeys.includes(f01.role)) &&
    (f01.state === 'ALL' || g.state === f01.state)), [grants, f01]);
  const cur01 = rows01.find(g => g.id === pick01) || rows01[0] || grants[0];

  // ── S02 행 — 역할·범위 필터가 실제 판정을 바꾼다 ─────────────────────
  const rows02: AccessRow[] = grants
    .filter(g => (role02 === 'ALL' || g.roleKeys.includes(role02)) && (scope02 === 'ALL' || g.scopeIds.includes(scope02)))
    .map(g => ({
      id: g.id, subject: `${g.name} (${g.roleKeys.map(roleLabel).join(' · ')})`,
      sub: `${g.account}${g.kind === 'service' ? ' · 서비스 계정' : ''}`,
      scope: g.scopeIds.map(scopeKo).join(' · '),
      cells: cells(grantCell(g, 'view'), grantCell(g, 'edit'), grantCell(g, 'approve'), grantCell(g, 'run')),
      state: g.state, valid: `${g.from} ~ ${g.to}${g.reason ? ` · ${g.reason}` : ''}`,
    }));
  if (role02 !== 'ALL' && scope02 !== 'ALL' && rows02.length === 0) {
    rows02.push({
      id: 'UI17-S02-NONE', subject: `${roleLabel(role02)} (부여 기록 없음)`, sub: '원천 IAM 신청 필요',
      scope: scopeKo(scope02),
      cells: cells(pairCell(role02, scope02, 'view'), pairCell(role02, scope02, 'edit'), pairCell(role02, scope02, 'approve'), pairCell(role02, scope02, 'run')),
      state: 'PENDING', valid: '부여 없음 — 역할 신청 후 서버 판정',
    });
  }
  const cur02Row = rows02.find(r => r.id === pick02) || rows02[0];
  const cur02 = grants.find(g => g.id === cur02Row?.id);

  // ── S02 현재 actor 재판단 ──────────────────────────────────────────
  const probeRole = state.role;
  const probeCells = VC_ORDER.map(vc => ({ vc, c: pairCell(probeRole, probeScope, vc) }));
  const probeBlocks = probeCells.filter(p => p.c.k !== '허용').map(p => `${VC_KO[p.vc]} ${p.c.k} — ${p.c.why || '-'}`);
  const cur03 = deleg.find(d => d.id === pick03) || deleg[0];
  const cur04 = sessions.find(s => s.id === pick04) || sessions[0];
  const cur05 = CRED_SEED.find(c => c.id === pick05) || CRED_SEED[0];

  const failRules = [...s01Rules, ...s02Rules, ...s03Rules, ...s04Rules, ...s05Rules, ...s06Rules].filter(r => r.verdict !== 'PASS');

  // ── S06 타임라인 — 화면에서 만든 요청·재판단도 같은 흐름에 붙는다 ────
  const tlRows: TlRow[] = [
    ...checks.map(c => ({
      ts: c.at, step: '결과', target: `역할 ${roleLabel(c.role)} · ${scopeKo(c.scope)}`, corr: c.id,
      result: `서버 재판단 — ${VC_KO[c.vc]} ${c.verdict}${c.why ? ` · ${c.why}` : ''}`,
      next: c.verdict === '허용' ? '요청 처리' : '권한 재부여 검토', ok: c.verdict === '허용',
    })),
    ...reqs.map(r => ({
      ts: r.at, step: '접수', target: r.target, corr: r.id,
      result: `${r.change} — ${r.state}`, next: '권한 관리자', ok: !r.state.includes('거부'),
    })),
    ...state.audit.slice(0, 6).map(a => ({
      ts: a.ts, step: '감사', target: a.target, corr: a.action, result: `${a.actor} · ${a.detail}`, next: '감사 보존', ok: true,
    })),
    ...TIMELINE_SEED,
  ];
  const deniedCount = tlRows.filter(r => !r.ok).length;

  const areas: Record<string, () => ReactNode> = {
    // ═════════════════════ UI17-S01 사용자와 역할 ═════════════════════
    'UI17-S01': () => {
      const roleClass = VC_ORDER.map(vc => {
        const holders = SPEC_ROLES.filter(r => roleVC(r.key).includes(vc)).map(r => r.label);
        return { vc, holders, need: VERB_OF[vc].join(' · '), has: cur01.roleKeys.some(k => roleVC(k).includes(vc)) };
      });
      const missingClasses = roleClass.filter(r => r.holders.length === 0).map(r => `${VC_KO[r.vc]} 담당 역할 없음`);
      const iamUnlinked = cur01.iam.startsWith('미연결');
      const orgs = [...new Set(grants.map(g => g.org))];
      return (
        <div>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="small muted">조직
              <select style={{ ...FIELD, marginTop: 4, minWidth: 180 }} value={f01.org} onChange={e => setF01({ ...f01, org: e.target.value })}>
                <option value="ALL">전체</option>
                {orgs.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label className="small muted">역할
              <select style={{ ...FIELD, marginTop: 4, minWidth: 160 }} value={f01.role} onChange={e => setF01({ ...f01, role: e.target.value })}>
                <option value="ALL">전체</option>
                {roles.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
            </label>
            <label className="small muted">상태
              <select style={{ ...FIELD, marginTop: 4, minWidth: 140 }} value={f01.state} onChange={e => setF01({ ...f01, state: e.target.value })}>
                <option value="ALL">전체</option>
                {ST_ORDER.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <span className="small muted">표시 {rows01.length} / 전체 {grants.length}건 — 필터는 조회 범위만 좁히고 권한을 바꾸지 않는다.</span>
          </div>

          <div className="mt"><Table head={S01_COLS}>
            {rows01.map(g => (
              <tr key={g.id} onClick={() => setPick01(g.id)} style={{ cursor: 'pointer', background: g.id === cur01.id ? 'var(--surface-2)' : undefined }}>
                <td><b>{g.name}</b><div className="small muted mono">{g.account}{g.kind === 'service' ? ' · 서비스 계정' : ''}</div></td>
                <td className="small">{g.org}</td>
                <td className="small">{g.roleKeys.map(roleLabel).join(' · ')}</td>
                <td className="small mono" title={g.scopeIds.join(' · ')}>{g.scopeIds.map(scopeKo).join(' · ')}</td>
                <td className="small mono">{g.from} ~ {g.to}</td>
                <td className="small">{g.approver}</td>
                <td className="small"><Pill s={g.state} tone={ST_TONE[g.state]} /><div className="small muted">{ST_KO[g.state]}</div></td>
              </tr>
            ))}
          </Table></div>
          {rows01.length === 0 && <Note>조건에 맞는 부여가 없다 — 필터를 넓히거나 원천 IAM 에서 부여를 신청한다.</Note>}

          <div className="card mt" style={{ background: 'var(--surface-2)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <b className="mono">UI17-S01-D</b>
              <span className="small muted">상세 패널 — 선택 행의 정확 버전·범위·원천을 편다</span>
            </div>
            <div className="kv mt">
              <div>사용자</div><div className="small">{cur01.name} · <span className="mono">{cur01.account}</span></div>
              <div>조직</div><div className="small">{cur01.org}</div>
              <div>역할</div><div className="small">{cur01.roleKeys.map(roleLabel).join(' · ')} <span className="mono small">({cur01.roleKeys.join(',')})</span></div>
              <div>범위</div><div className="small mono">{cur01.scopeIds.map(scopeKo).join(' · ')}</div>
              <div>유효기간</div><div className="small mono">{cur01.from} ~ {cur01.to}</div>
              <div>승인자</div><div className="small">{cur01.approver}</div>
              <div>상태</div><div className="small">{cur01.state} · {ST_KO[cur01.state]}{cur01.reason ? ` — ${cur01.reason}` : ''}</div>
              <div>원천 IAM</div><div className="small">{cur01.iam}</div>
            </div>

            <div className="mt"><Table head={['동작류', '필요 verb', '이 역할의 부여', '판정']}>
              {roleClass.map(r => (
                <tr key={r.vc}>
                  <td>{VC_KO[r.vc]}</td>
                  <td className="small mono">{r.need}</td>
                  <td className="small">{r.holders.join(' · ') || '—'}</td>
                  <td className="small" style={{ color: r.has ? 'var(--pass)' : 'var(--fail)', fontWeight: 600 }}>{r.has ? '있음' : '없음'}</td>
                </tr>
              ))}
            </Table></div>

            <div className="row mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Gated label="역할·조직 조회 (UI17-S01-D)" reasons={can('view') ? [] : ['현재 역할에 view verb 없음']}
                onClick={() => { audited('ACCESS_VIEW', cur01.account, `역할 ${cur01.roleKeys.join('·')} · 범위 ${cur01.scopeIds.length}개 · 상세 패널 표시`); toast(`${cur01.name} 부여를 상세 패널로 폈다`); }} />
              <Gated label="조회·편집·승인·운영 역할 구분" reasons={missingClasses}
                onClick={() => { audited('ROLE_CLASS_CHECK', cur01.account, `동작류 4종 담당 역할 확인 · 누락 0건`); toast('4 동작류에 담당 역할이 모두 있다'); }} />
              <Gated label="원천 IAM 사용자와 연결" reasons={iamUnlinked ? ['원천 IAM 연결 기록 없음 — 계정 대조 필요'] : []}
                onClick={() => { audited('IAM_LINK_CHECK', cur01.account, cur01.iam); toast(`IAM 원천 대조 — ${cur01.account}`); }} />
              <Gated label="역할 사전 변경 요청" reasons={can('admin') ? [] : [`현재 역할 ${roleLabel(state.role)} 에게 admin verb 없음 — 요청만 기록된다`]}
                onClick={() => { pushReq('역할 사전', `${cur01.roleKeys.join('·')} 범위 조정`, '접수 · 서버 재판단 대기'); audited('ROLE_DICT_CHANGE_REQUEST', cur01.account, '역할 사전 변경 요청 기록 — 화면은 권한을 바꾸지 않는다'); toast('변경 요청 접수 — 권한은 서버가 재판단한다'); }} />
            </div>
            <Note>역할 구분은 조회·편집·승인·운영 네 동작류의 담당이 서로 다른 역할로 채워져 있는지만 본다 — 부여는 언제나 원천 IAM 한 곳에서 온다.</Note>

            <div className="mt"><Table head={['IAM 사용자', 'IAM 역할', 'FP 역할 매핑', '조직', '연결 상태']}>
              {users.map(u => (
                <tr key={u.id}>
                  <td className="mono small">{u.id}</td>
                  <td className="small">{u.role}</td>
                  <td className="small">{roleLabel(roleKeyOf(u.role))}</td>
                  <td className="small">{u.org}</td>
                  <td className="small">{u.status === 'active' ? '연결됨' : '초대 상태 — 역할 미확정'}</td>
                </tr>
              ))}
            </Table></div>

            <div className="mt"><UlRules items={s01Rules} title={<UlTitle items={s01Rules} />} /></div>
          </div>
        </div>
      );
    },

    // ═════════════════════ UI17-S02 범위와 권한 ═════════════════════
    'UI17-S02': () => {
      const changed = !!cur02 && (
        edit.scopes.slice().sort().join('|') !== cur02.scopeIds.slice().sort().join('|') ||
        edit.vc.slice().sort().join('|') !== roleVC(cur02.roleKeys[0]).slice().sort().join('|')
      );
      const pendingNote = cur02 ? pending[cur02.id] : undefined;
      const scopeBlocks = cur02
        ? VC_ORDER.filter(v => grantCell(cur02, v).k !== '허용')
          .map(v => `${VC_KO[v]} ${grantCell(cur02, v).k} — ${grantCell(cur02, v).why || '-'}`)
        : ['선택된 주체가 없다'];
      const editReasons = [
        !cur02 ? '선택된 주체가 없다' : '',
        !changed ? '변경된 범위·동작류가 없다' : '',
        edit.scopes.length === 0 ? '범위를 하나도 선택하지 않았다' : '',
        edit.vc.length === 0 ? '동작류를 하나도 선택하지 않았다' : '',
        !can('edit') ? `현재 역할 ${roleLabel(state.role)} 에게 edit verb 없음` : '',
      ].filter(Boolean) as string[];
      return (
        <div>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="small muted">역할
              <select style={{ ...FIELD, marginTop: 4, minWidth: 170 }} value={role02} onChange={e => setRole02(e.target.value)}>
                <option value="ALL">전체 역할</option>
                {roles.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
            </label>
            <label className="small muted">scope
              <select style={{ ...FIELD, marginTop: 4, minWidth: 220 }} value={scope02} onChange={e => setScope02(e.target.value)}>
                <option value="ALL">전체 scope</option>
                {SCOPES.map(s => <option key={s.id} value={s.id}>{s.kind} · {s.label}</option>)}
              </select>
            </label>
            <span className="small muted">행 {rows02.length}건 — 같은 사람이라도 scope 마다 판정이 다르다.</span>
            <Gated label="OEM 프로젝트 시장 환경 범위 확인" reasons={can('view') ? [] : ['view verb 없음']}
              onClick={() => {
                audited('SCOPE_CATALOG_VIEW', `scope ${SCOPES.length}개`, `${SCOPE_KINDS.join(' · ')} · 부여 행 ${rows02.length}건`);
                toast(`scope 범주 ${SCOPE_KINDS.length}종 · ${SCOPES.length}개 확인`);
              }} />
            <Gated label="객체별 권한 및 금지 사유 표시" reasons={can('view') ? [] : ['view verb 없음']}
              onClick={() => {
                audited('DENY_REASON_VIEW', cur02Row?.subject || '—', `제한 동작 ${scopeBlocks.length}건 · ${scopeBlocks[0] || '차단 조건 없음'}`);
                toast('금지 사유 표시 — 실제 판정은 서버가 다시 한다');
              }} />
          </div>

          <div className="mt row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {SCOPE_KINDS.map(k => (
              <span key={k} className="pill">{k} {SCOPES.filter(s => s.kind === k).length}</span>
            ))}
            {SCOPES.map(s => <span key={s.id} className="pill" title={s.note}>{s.id}</span>)}
          </div>

          <div className="mt"><AccessTable rows={rows02} pick={cur02Row?.id || ''} onPick={setPick02} tag={pendingNote ? '변경 요청 접수' : undefined} /></div>

          <div className="card mt" style={{ background: 'var(--surface-2)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <b className="mono">UI17-S02-D</b>
              <span className="small muted">권한 안내 · 금지 사유 · 서버 재판단</span>
            </div>
            <div className="kv mt">
              <div>주체</div><div className="small">{cur02Row?.subject || '—'}</div>
              <div>범위</div><div className="small mono">{cur02Row?.scope || scopeKo(scope02)}</div>
              <div>유효성</div><div className="small">{cur02Row ? `${cur02Row.state} · ${cur02Row.valid}` : '부여 없음'}</div>
              <div>부여 원장</div><div className="small">{cur02 ? `${cur02.id} · 승인자 ${cur02.approver}` : '부여 기록 없음 — 원천 IAM 신청 필요'}</div>
              {pendingNote && <><div>요청 상태</div><div className="small">{pendingNote}</div></>}
            </div>
            <div className="mt"><Reasons title="이 주체가 막히는 동작" list={scopeBlocks} ok={scopeBlocks.length === 0} /></div>

            <div className="mt">
              <div className="small muted" style={{ marginBottom: 6 }}>범위·동작류 수정 (요청서)</div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {SCOPES.map(s => (
                  <label key={s.id} className="small" title={s.note} style={{ minWidth: 160 }}>
                    <input type="checkbox" checked={edit.scopes.includes(s.id)}
                      onChange={e => setEdit({ ...edit, scopes: e.target.checked ? [...edit.scopes, s.id] : edit.scopes.filter(x => x !== s.id) })} />
                    {' '}{s.kind} · {s.label}
                  </label>
                ))}
              </div>
              <div className="row mt" style={{ gap: 12, flexWrap: 'wrap' }}>
                {VC_ORDER.map(vc => (
                  <label key={vc} className="small">
                    <input type="checkbox" checked={edit.vc.includes(vc)}
                      onChange={e => setEdit({ ...edit, vc: e.target.checked ? [...edit.vc, vc] : edit.vc.filter(x => x !== vc) })} />
                    {' '}{VC_KO[vc]}
                  </label>
                ))}
              </div>
              <div className="row mt" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label className="small muted">요청 사유
                  <input style={{ ...FIELD, marginTop: 4, minWidth: 320 }} value={reason} onChange={e => setReason(e.target.value)} placeholder="예: BDC-2027 검증 참여" />
                </label>
                <Gated label="범위 변경 요청" kind="primary" reasons={editReasons}
                  onClick={() => {
                    if (!cur02) return;
                    setPending({ ...pending, [cur02.id]: `범위 ${edit.scopes.join(' · ')} · 동작류 ${edit.vc.map(v => VC_KO[v]).join('·')} — 접수(서버 재판단 대기)` });
                    pushReq(cur02.account, `범위 ${edit.scopes.length}개 · 동작류 ${edit.vc.length}종`, '접수 · 서버 재판단 대기');
                    audited('SCOPE_CHANGE_REQUEST', cur02.account, `${edit.scopes.join('/')} · ${edit.vc.join('/')} · ${reason.trim() || '사유 미기재'}`);
                    toast('범위 변경 요청 접수 — 화면 값은 안내일 뿐, 권한은 서버가 재판단한다');
                    setReason('');
                  }} />
                <Gated label="요청 취소" reasons={pendingNote ? [] : ['접수된 요청이 없다']}
                  onClick={() => {
                    if (!cur02) return;
                    const p = { ...pending }; delete p[cur02.id]; setPending(p);
                    audited('SCOPE_CHANGE_CANCEL', cur02.account, '요청 취소 — 부여 원장은 그대로다');
                    toast('변경 요청 취소');
                  }} />
                <Gated label="전역 범위 편집 요청" kind="danger" reasons={ulWarns(s02Rules)}
                  onClick={() => {
                    pushReq('전역(모든 프로젝트)', '전역 편집 요청', '거부 — 승인 결속 없음');
                    audited('GLOBAL_SCOPE_REQUEST', '전역(모든 프로젝트)', 'UL-028 WARN — 승인 결속 전에는 전역 편집을 요청할 수 없다');
                    toast('전역 편집 요청 거부 — 검토 항목 UL-028', 'err');
                  }} />
              </div>
              <Note>요청은 접수 기록일 뿐이다 — 표시된 범위·동작류는 서버가 매 요청 다시 판정하고, 화면 값은 그 판정을 대신하지 않는다.</Note>
            </div>

            <div className="mt">
              <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label className="small muted">재판단 범위 (현재 역할 {roleLabel(probeRole)})
                  <select style={{ ...FIELD, marginTop: 4, minWidth: 220 }} value={probeScope} onChange={e => setProbeScope(e.target.value)}>
                    {SCOPES.map(s => <option key={s.id} value={s.id}>{s.kind} · {s.label}</option>)}
                  </select>
                </label>
                <Gated label="서버 권한 재판단 실행" kind="primary" reasons={can('view') ? [] : ['view verb 없음 — 재판단 요청도 보낼 수 없다']}
                  onClick={() => {
                    const base = checks.length;
                    setChecks([...checks, ...VC_ORDER.map((vc, i) => {
                      const c = pairCell(probeRole, probeScope, vc);
                      return {
                        id: `cmd-recheck-${String(base + i + 1).padStart(2, '0')}`, at: NOW, role: probeRole, scope: probeScope, vc,
                        verdict: (c.k === '허용' ? '허용' : '거부') as '허용' | '거부', why: c.why || '',
                      };
                    })]);
                    audited('ACCESS_RECHECK', `${probeRole} · ${probeScope}`, `동작류 4종 재판단 · 거부 ${probeBlocks.length}건`);
                    toast(`${scopeKo(probeScope)} 재판단 — 거부 ${probeBlocks.length}건`, probeBlocks.length ? 'warn' : 'ok');
                  }} />
                <span className="small muted">판정 기준: 역할 verb × 범위 규칙 — 서버가 같은 순서로 다시 본다.</span>
              </div>
              <div className="mt"><Table head={['동작류', '화면 판단', '사유', '검사 순서']}>
                {probeCells.map(p => (
                  <tr key={p.vc}>
                    <td>{VC_KO[p.vc]}</td>
                    <td style={{ color: p.c.k === '허용' ? 'var(--pass)' : 'var(--fail)', fontWeight: 600 }}>{p.c.k}</td>
                    <td className="small muted">{p.c.why || '—'}</td>
                    <td className="small mono">역할 verb → scope 규칙 → 서버 재판단</td>
                  </tr>
                ))}
              </Table></div>
              <Reasons title="현재 역할이 이 범위에서 막히는 동작" list={probeBlocks} ok={probeBlocks.length === 0} />
            </div>

            <div className="mt">
              <div className="small muted" style={{ marginBottom: 6 }}>요청 접수 기록 ({reqs.length}건)</div>
              {reqs.length === 0
                ? <p className="small muted">기록 없음 — 변경 요청과 재판단은 감사 기록과 함께만 남는다.</p>
                : <Table head={['요청 ID', '대상', '변경 내용', '상태', '시각']}>
                  {reqs.map(r => (
                    <tr key={r.id}>
                      <td className="mono small">{r.id}</td>
                      <td className="small">{r.target}</td>
                      <td className="small">{r.change}</td>
                      <td className="small" style={{ color: 'var(--pending)', fontWeight: 600 }}>{r.state}</td>
                      <td className="mono small">{r.at}</td>
                    </tr>
                  ))}
                </Table>}
            </div>

            <div className="mt"><UlRules items={s02Rules} title={<UlTitle items={s02Rules} />} /></div>
          </div>
        </div>
      );
    },

    // ═════════════════════ UI17-S03 직무 분리와 대행 ═════════════════════
    'UI17-S03': () => {
      const selfApprove = cur03 && cur03.owner && cur03.sub.includes('요청자');
      const activeDeleg = deleg.filter(d => d.id.startsWith('DLG'));
      return (
        <div>
          <div className="row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span className="small muted">직무 분리 {deleg.filter(d => d.id.startsWith('SOD')).length}건 · 대행 {activeDeleg.length}건 (활성 {activeDeleg.filter(d => d.state === 'ACTIVE').length} · 대기 {activeDeleg.filter(d => d.state === 'PENDING').length} · 철회 {activeDeleg.filter(d => d.state === 'REVOKED').length})</span>
          </div>

          <div className="mt"><AccessTable rows={deleg} pick={pick03} onPick={setPick03} /></div>

          <div className="card mt" style={{ background: 'var(--surface-2)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <b className="mono">UI17-S03-D</b>
              <span className="small muted">대행 기간·철회 상태 · 자기 승인 제한</span>
            </div>
            <div className="kv mt">
              <div>대상</div><div className="small">{cur03.subject}</div>
              <div>직무</div><div className="small">{cur03.owner}</div>
              <div>범위</div><div className="small mono">{cur03.scope}</div>
              <div>요청</div><div className="small">{cur03.req}</div>
              <div>유효성</div><div className="small">{cur03.state} · {cur03.valid}</div>
            </div>
            <div className="mt"><Reasons title="이 주체가 막히는 동작" list={rowBlocks(cur03)} ok={rowBlocks(cur03).length === 0} /></div>

            <div className="row mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Gated label="자기 승인 제한 검증" reasons={selfApprove ? [] : ['요청자 = 승인자 조합이 선택되지 않았다 — 자기 승인 제한을 확인할 대상이 없다']}
                onClick={() => { audited('SOD_SELF_APPROVE_CHECK', cur03.id, '요청자 = 승인자 — 승인 입력 차단'); toast(`${cur03.id} 자기 승인 차단 확인`, 'err'); }} />
              <Gated label="품질과 운영 승인 분리" reasons={cur03.owner === '품질 검토' ? [] : ['품질 검토 직무가 선택되지 않았다']}
                onClick={() => { audited('SOD_QUALITY_OPS_SPLIT', cur03.id, `품질 ${cur03.subject} · 운영 승인은 다른 역할`); toast('품질 평가와 운영 승인 분리 확인'); }} />
              <Gated label="대행 기간과 철회 상태 조회" reasons={can('view') ? [] : ['view verb 없음']}
                onClick={() => { audited('DELEGATION_VIEW', cur03.id, `${cur03.state} · ${cur03.valid}`); toast(`${cur03.id} 대행 상태 조회`); }} />
              <Gated label="대행 승인 요청" kind="primary" reasons={[...ulBlocks(s03Rules), !can('approve') ? `현재 역할 ${roleLabel(state.role)} 에게 approve verb 없음` : '', cur03.state !== 'ACTIVE' ? `대상 상태 ${cur03.state} — 활성 대행에만 적용할 수 있다` : ''].filter(Boolean) as string[]}
                onClick={() => { pushReq(cur03.id, '대행 승인 요청', '접수 · 서버 재판단 대기'); audited('DELEGATION_APPROVE_REQUEST', cur03.id, '대행 승인 요청 기록'); toast('대행 승인 요청 접수'); }} />
              <Gated label="대행 철회" kind="danger" reasons={[cur03.state !== 'ACTIVE' ? `대상 상태 ${cur03.state} — 활성 대행만 철회할 수 있다` : '', !reason.trim() ? '철회 사유가 없다' : '', !can('edit') ? `현재 역할 ${roleLabel(state.role)} 에게 edit verb 없음` : ''].filter(Boolean) as string[]}
                onClick={() => {
                  setDeleg(list => list.map(d => (d.id === cur03.id ? { ...d, state: 'REVOKED', valid: `${d.valid} (철회 ${NOW.slice(0, 10)})`, cells: cells(LIM('철회'), LIM('철회'), LIM('철회'), LIM('철회')) } : d)));
                  audited('DELEGATION_REVOKE', cur03.id, `철회 · ${reason.trim()}`);
                  toast(`${cur03.id} 대행 철회 — 감사 기록에 남았다`, 'err');
                  setReason('');
                }} />
              <label className="small muted">사유
                <input style={{ ...FIELD, marginTop: 4, minWidth: 260 }} value={reason} onChange={e => setReason(e.target.value)} />
              </label>
            </div>

            <div className="mt"><Table head={['검사', '대상', '결과', '사유']}>
              <tr>
                <td>자기 승인</td>
                <td className="small mono">SOD-02</td>
                <td className="small" style={{ color: 'var(--fail)', fontWeight: 600 }}>차단</td>
                <td className="small muted">동일 principal 이 요청한 REQ-2026-0918 — 승인 입력 차단</td>
              </tr>
              <tr>
                <td>대행 승인</td>
                <td className="small mono">DLG-01</td>
                <td className="small" style={{ color: 'var(--fail)', fontWeight: 600 }}>차단</td>
                <td className="small muted">대행은 승인 입력까지 넘기지 않는다 — 승인은 위임자 계정으로만</td>
              </tr>
              <tr>
                <td>긴급 break-glass</td>
                <td className="small mono">예외 경로</td>
                <td className="small" style={{ color: 'var(--pending)', fontWeight: 600 }}>미구현</td>
                <td className="small muted">사유·기간·이중 통제 없는 일반 토글로 열지 않는다</td>
              </tr>
              <tr>
                <td>품질·운영 승인 분리</td>
                <td className="small mono">SOD-01 · SOD-03</td>
                <td className="small" style={{ color: 'var(--pass)', fontWeight: 600 }}>충족</td>
                <td className="small muted">품질 평가자와 운영 승인자가 서로 다른 역할</td>
              </tr>
            </Table></div>

            <div className="mt"><UlRules items={s03Rules} title={<UlTitle items={s03Rules} />} /></div>
          </div>
        </div>
      );
    },

    // ═════════════════════ UI17-S04 세션과 SSO 연결 ═════════════════════
    'UI17-S04': () => {
      const needReauth = sessions.filter(s => s.state === 'PENDING');
      const expired = sessions.filter(s => s.state === 'EXPIRED');
      return (
        <div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <span className="pill">세션 {sessions.length}</span>
            <span className="pill">ACTIVE {sessions.filter(s => s.state === 'ACTIVE').length}</span>
            <span className="pill" style={{ color: 'var(--pending)' }}>재인증 필요 {needReauth.length}</span>
            <span className="pill" style={{ color: 'var(--fail)' }}>만료 {expired.length}</span>
            <span className="small muted">실제 인증은 세션 쿠키·IdP 가 정한다 — 이 화면의 역할 선택은 표시만 바꾼다.</span>
          </div>

          <div className="mt"><AccessTable rows={sessions} pick={pick04} onPick={setPick04} tag={cur04.reauthNote} /></div>

          <div className="card mt" style={{ background: 'var(--surface-2)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <b className="mono">UI17-S04-D</b>
              <span className="small muted">세션 만료·재인증 · SSO·SCIM 동기화 범위</span>
            </div>
            <div className="kv mt">
              <div>주체</div><div className="small">{cur04.subject}</div>
              <div>IdP</div><div className="small">{cur04.idp}</div>
              <div>인증 강도</div><div className="small">{cur04.mfa}</div>
              <div>단말</div><div className="small">{cur04.device}</div>
              <div>유휴</div><div className="small">{cur04.idle}</div>
              <div>절대 만료</div><div className="small">{cur04.abs}</div>
              <div>유효성</div><div className="small">{cur04.state} · {cur04.valid}</div>
            </div>
            <div className="mt"><Reasons title="이 세션에서 막히는 동작" list={rowBlocks(cur04, '세션')} ok={rowBlocks(cur04, '세션').length === 0} /></div>

            <div className="row mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Gated label="세션 만료와 재인증 안내" reasons={needReauth.length === 0 ? ['재인증이 필요한 세션이 없다'] : []}
                onClick={() => {
                  pushReq(needReauth.map(s => s.id).join(' · '), '재인증 안내 발송', '접수 · 사용자 재인증 대기');
                  audited('SESSION_REAUTH_NOTICE', needReauth[0].id, `재인증 안내 · 유휴 ${needReauth[0].idle}`);
                  toast('재인증 안내 기록 — 재인증은 사용자가 IdP 에서 해야 성립한다');
                }} />
              <Gated label="세션 즉시 종료 요청" kind="danger" reasons={can('admin') ? [] : [`현재 역할 ${roleLabel(state.role)} 에게 admin verb 없음 — 세션 종료는 통합 관리자만 요청한다`]}
                onClick={() => {
                  audited('SESSION_TERMINATE_REQUEST', cur04.id, '즉시 종료 요청 — 서버가 세션 상태를 다시 본다');
                  toast('세션 종료 요청 접수');
                }} />
              <Gated label="SSO 그룹 매핑 저장" reasons={ulWarns(s04Rules)}
                onClick={() => { audited('SSO_GROUP_SAVE_BLOCKED', 'SSO 그룹 매핑', 'UL-080 WARN — 빈 결과·미저장 변경 안내 미구현으로 저장 차단'); toast('저장 차단 — 검토 항목 UL-080', 'err'); }} />
              <Gated label="SSO SCIM 및 사용자 동기화 범위 확인" reasons={can('view') ? [] : ['view verb 없음']}
                onClick={() => {
                  const unmapped = SSO_ROWS.filter(r => r.state.includes('미매핑')).length;
                  audited('SSO_SCIM_SCOPE_VIEW', `IdP 그룹 ${SSO_ROWS.length}개`, `마지막 동기화 ${SSO_ROWS[0].sync} · 미매핑 그룹 ${unmapped}건`);
                  toast(`그룹 ${SSO_ROWS.length}개 · 미매핑 ${unmapped}건 — 자동 부여는 viewer 까지만`);
                }} />
              <Gated label="검토용 역할 선택과 실제 인증 구분" reasons={can('view') ? [] : ['view verb 없음']}
                onClick={() => { audited('REVIEW_ROLE_VS_AUTH', state.role, `표시 역할 ${roleLabel(state.role)} · 인증 주체는 서버 세션의 actor`); toast(`표시 역할 ${roleLabel(state.role)} — 인증 주체는 서버가 안다`); }} />
            </div>

            <div className="mt"><Table head={['IdP 그룹', '매핑 역할', '동기화 범위', '자동 가입 기본 권한', '마지막 동기화', '상태']}>
              {SSO_ROWS.map(r => (
                <tr key={r.group}>
                  <td className="mono small">{r.group}</td>
                  <td className="small">{roleLabel(r.role)}</td>
                  <td className="small mono">{r.scope}</td>
                  <td className="small">{r.auto}</td>
                  <td className="mono small">{r.sync}</td>
                  <td className="small" style={{ color: r.state === '동기화 정상' ? 'var(--pass)' : 'var(--pending)' }}>{r.state}</td>
                </tr>
              ))}
            </Table></div>
            <Note>자동 가입은 최소 권한(viewer)으로만 시작하고, 역할 부여는 승인자를 거쳐야 한다 — SSO 그룹이 곧 권한은 아니다.</Note>

            <div className="mt"><UlRules items={s04Rules} title={<UlTitle items={s04Rules} />} /></div>
          </div>
        </div>
      );
    },

    // ═════════════════════ UI17-S05 서비스 자격과 키 참조 ═════════════════════
    'UI17-S05': () => {
      const rows05: CredRow[] = CRED_SEED.map(c => (
        rotateReq[c.id] ? { ...c, state: 'PENDING' as St, valid: `${rotateReq[c.id]} · 회전 진행 중` } : c
      ));
      const cur05v = rows05.find(c => c.id === pick05) || rows05[0];
      const noPlain = CRED_SEED.every(c => !/[0-9a-f]{6}/.test(c.token.replace(/•/g, '')) || c.token.includes('해당 없음'));
      return (
        <div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <span className="pill">자격 {rows05.length}</span>
            <span className="pill">ACTIVE {rows05.filter(c => c.state === 'ACTIVE').length}</span>
            <span className="pill" style={{ color: 'var(--pending)' }}>회전·승인 대기 {rows05.filter(c => c.state === 'PENDING').length}</span>
            <span className="pill" style={{ color: 'var(--fail)' }}>만료·철회 {rows05.filter(c => c.state === 'EXPIRED' || c.state === 'REVOKED').length}</span>
            <span className="small muted">자격은 endpoint·project·environment 로만 나뉜다 — 승인 입력은 사람 principal 만 한다.</span>
          </div>

          <div className="mt"><AccessTable rows={rows05} pick={pick05} onPick={setPick05} tag={rows05.find(c => c.id === pick05)?.rotateDue} /></div>

          <div className="card mt" style={{ background: 'var(--surface-2)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <b className="mono">UI17-S05-D</b>
              <span className="small muted">승인 범위 · secret reference · PKI·HSM 위임</span>
            </div>
            <div className="kv mt">
              <div>자격</div><div className="small mono">{cur05v.subject}</div>
              <div>토큰</div><div className="small mono">{cur05v.token}</div>
              <div>비밀 참조</div><div className="small mono">{cur05v.secretRef}</div>
              <div>위임</div><div className="small">{cur05v.delegate}</div>
              <div>회전</div><div className="small">{cur05v.rotateDue}</div>
              <div>원문</div><div className="small">{cur05v.plain}</div>
              <div>유효성</div><div className="small">{cur05v.state} · {cur05v.valid}</div>
            </div>
            <div className="mt"><Reasons title="이 자격이 막히는 동작" list={rowBlocks(cur05v, '자격')} ok={rowBlocks(cur05v, '자격').length === 0} /></div>

            <div className="row mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Gated label="서비스 계정의 승인 범위 조회" reasons={can('view') ? [] : ['view verb 없음']}
                onClick={() => { audited('SVC_APPROVAL_SCOPE_VIEW', cur05v.subject, `${cur05v.scope} · 승인 입력 불가 확인`); toast('승인 범위 조회 — 서비스 계정은 승인 입력을 하지 않는다'); }} />
              <Gated label="secret reference·PKI HSM 위임 확인" reasons={can('view') ? [] : ['view verb 없음']}
                onClick={() => { audited('SECRET_REF_VIEW', cur05v.secretRef, `위임 ${cur05v.delegate} · 원문 ${cur05v.plain}`); toast(`참조 확인 — ${cur05v.secretRef}`); }} />
              <Gated label="회전 요청" kind="primary" reasons={[cur05v.state === 'REVOKED' ? '철회된 자격은 회전할 수 없다' : '', cur05v.state === 'PENDING' && !rotateReq[cur05v.id] ? '이미 회전이 진행 중이다' : '', !can('run-engine') ? `현재 역할 ${roleLabel(state.role)} 에게 run-engine verb 없음` : ''].filter(Boolean) as string[]}
                onClick={() => {
                  setRotateReq({ ...rotateReq, [cur05v.id]: `회전 요청 ${NOW}` });
                  pushReq(cur05v.subject, '자격 회전 요청', '접수 · 서버 재판단 대기');
                  audited('CRED_ROTATE_REQUEST', cur05v.subject, `회전 요청 · ${cur05v.secretRef}`);
                  toast(`${cur05v.subject} 회전 요청 접수 — 완료는 서버가 확인한다`);
                }} />
              <Gated label="자격 폐기 요청" kind="danger" reasons={[!can('admin') ? `현재 역할 ${roleLabel(state.role)} 에게 admin verb 없음 — 폐기는 통합 관리자만 요청한다` : '', !reason.trim() ? '폐기 사유가 없다' : ''].filter(Boolean) as string[]}
                onClick={() => { audited('CRED_REVOKE_REQUEST', cur05v.subject, `폐기 요청 · ${reason.trim()}`); toast('폐기 요청 접수'); setReason(''); }} />
              <Gated label="서명 키 위임 갱신" reasons={ulWarns(s05Rules.filter(r => r.ul === 'UL-067'))}
                onClick={() => { audited('PKI_DELEGATE_RENEW_BLOCKED', 'hsm:fp-signer/slot-3', 'UL-067 WARN — 회수 후 재서명 절차 미정의로 갱신 차단'); toast('갱신 차단 — 검토 항목 UL-067', 'err'); }} />
              <Gated label="비밀 원문 노출 금지 검증" reasons={noPlain ? [] : ['자격 표에 원문이 남아 있다 — 즉시 폐기하고 참조로 바꾼다']}
                onClick={() => { audited('SECRET_PLAINTEXT_CHECK', 'UI17-S05', `자격 ${rows05.length}건 · 원문 노출 0건 · 참조 ${KEY_REFS.length}건`); toast('원문 노출 0건 — 참조 ID 만 남는다', 'ok'); }} />
              <Gated label="비밀 원문 보기" kind="danger" reasons={['정책 A04: 비밀 원문은 어떤 역할에도 표시하지 않는다 — 참조 ID 와 위임만 보여준다']}
                onClick={() => { /* 차단: 사유가 있으면 실행되지 않는다 */ }} />
              <label className="small muted">사유
                <input style={{ ...FIELD, marginTop: 4, minWidth: 240 }} value={reason} onChange={e => setReason(e.target.value)} />
              </label>
            </div>

            <div className="mt"><Table head={['비밀 참조', '종류', '위임', '회전 주기', '만료', '원문']}>
              {KEY_REFS.map(k => (
                <tr key={k.id}>
                  <td className="mono small">{k.id}</td>
                  <td className="small">{k.kind}</td>
                  <td className="small">{k.delegate}</td>
                  <td className="small">{k.cycle}</td>
                  <td className="mono small">{k.exp}</td>
                  <td className="small" style={{ color: k.plain.includes('보관') || k.plain.includes('나가지') ? 'var(--pass)' : 'var(--pending)' }}>{k.plain}</td>
                </tr>
              ))}
            </Table></div>

            <div className="mt"><UlRules items={s05Rules} title={<UlTitle items={s05Rules} />} /></div>
          </div>
        </div>
      );
    },

    // ═════════════════════ UI17-S06 보존과 감사 ═════════════════════
    'UI17-S06': () => (
      <div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span className="pill">기록 {tlRows.length}</span>
          <span className="pill" style={{ color: 'var(--fail)' }}>거부·만료 {deniedCount}</span>
          <span className="pill">상관 ID {new Set(tlRows.map(r => r.corr)).size}</span>
          <span className="small muted">같은 상관 ID 의 접수·처리·결과를 시간순으로 붙여 읽는다.</span>
        </div>

        <div className="mt"><Table head={S06_COLS}>
          {tlRows.map((r, i) => (
            <tr key={`${r.corr}-${i}`}>
              <td className="mono small">{r.ts}</td>
              <td className="small">{r.step}</td>
              <td className="small mono">{r.target}</td>
              <td className="small mono">{r.corr}</td>
              <td className="small" style={{ color: r.ok ? 'var(--ink)' : 'var(--fail)' }}>{r.result}</td>
              <td className="small muted">{r.next}</td>
            </tr>
          ))}
        </Table></div>

        <div className="mt"><Table head={['보존 프로필', '지역', '보존 기간', '대상', '내보내기', '만료 예정', '상태']}>
          {RETENTION.map(r => (
            <tr key={r.id}>
              <td className="mono small">{r.id}</td>
              <td className="small">{r.region}</td>
              <td className="small">{r.period}</td>
              <td className="small">{r.target}</td>
              <td className="small">{r.export}</td>
              <td className="mono small">{r.expires}</td>
              <td className="small"><Pill s={r.state} tone={ST_TONE[r.state as St]} /></td>
            </tr>
          ))}
        </Table></div>

        <div className="row mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Gated label="RetentionProfile의 기간·지역 확인" reasons={can('view') ? [] : ['view verb 없음']}
            onClick={() => { audited('RETENTION_VIEW', 'RetentionProfile', `프로필 ${RETENTION.length}건 · KR 5년 / EU 3년 / 원시 30일`); toast('보존 프로필 확인 — 지역별 기간이 다르다'); }} />
          <Gated label="권한 변경·접근 거부 감사" reasons={can('view') ? [] : ['view verb 없음']}
            onClick={() => {
              const changed = reqs.length + checks.length;
              audited('ACCESS_AUDIT_VIEW', 'UI17 감사', `권한 변경 요청 ${reqs.length} · 재판단 ${checks.length} · 거부 ${deniedCount}`);
              toast(`감사 기록 — 변경 ${changed}건 · 거부 ${deniedCount}건`, deniedCount ? 'warn' : 'ok');
            }} />
          <Gated label="개인정보 처리 제한 참조" reasons={can('view') ? [] : ['view verb 없음']}
            onClick={() => { audited('PRIVACY_LIMIT_VIEW', 'RP-RAW-CTX-EU', '원시 Context 30일 · EU 지역 저장 · 반입 0건 · 내보내기 금지'); toast('개인정보 처리 제한 참조 — 원시 반입 0건'); }} />
          <Gated label="보존 기간 변경 요청" kind="primary" reasons={[!can('admin') ? `현재 역할 ${roleLabel(state.role)} 에게 admin verb 없음 — 보존 기간 변경은 통합 관리자만 요청한다` : '', !reason.trim() ? '변경 사유가 없다' : ''].filter(Boolean) as string[]}
            onClick={() => {
              pushReq('RetentionProfile', `보존 변경 · ${reason.trim()}`, '접수 · 서버 재판단 대기');
              audited('RETENTION_CHANGE_REQUEST', 'RetentionProfile', `변경 요청 · ${reason.trim()}`);
              toast('보존 기간 변경 요청 접수'); setReason('');
            }} />
          <label className="small muted">사유
            <input style={{ ...FIELD, marginTop: 4, minWidth: 260 }} value={reason} onChange={e => setReason(e.target.value)} />
          </label>
        </div>
        <Note>감사 기록은 요청·재판단·거부를 모두 담는다 — 화면에서 만든 요청도 권한을 바꾸지 않고 기록만 남긴다.</Note>

        <div className="mt"><UlRules items={s06Rules} title={<UlTitle items={s06Rules} />} /></div>
      </div>
    ),
  };

  const kpis: Kpi[] = [
    { v: grants.length, l: '사용자·서비스 계정' },
    { v: grants.filter(g => g.state === 'ACTIVE').length, l: '유효 부여 (ACTIVE)' },
    { v: grants.filter(g => g.state === 'EXPIRED' || g.state === 'REVOKED').length, l: '만료·철회' },
    { v: `${sessions.filter(s => s.state === 'ACTIVE').length} / ${sessions.length}`, l: '활성 세션' },
    { v: failRules.length, l: '주의·차단 검토 항목' },
    { v: tlRows.length, l: '감사 기록' },
  ];

  return <CanonicalScreen screenId="UI17" core="C11 RBAC" kpis={kpis} head={<UlStrip />} areas={areas} />;
}
