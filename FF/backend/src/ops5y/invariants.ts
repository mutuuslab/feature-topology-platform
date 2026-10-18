// 5년 운영 재생의 불변식 — 재생이 끝난 DB를 다시 읽어 확인한다. 하나라도 어긋나면 재생 데이터를 쓰지 않는다.
// 판정은 저장된 기록(정책·검증 실행·차단 요청·감사·보존 대상 표)만 보고, 재생 엔진의 내부 상태를 믿지 않는다.
import { grantState, inService, JIRA_CR_STATUS, JIRA_EPIC_STATUS, populationAt, retentionCutoff, RETENTION_POLICIES, weightOf, type Entitlement, type KillRequest, type Lifecycle, type Policy, type VehicleProfile } from '@ff/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXT_FIXTURES } from '../adapters/if-mocks/external-systems';
import type { AuditService } from '../kernel/audit.service';
import type { Db } from '../kernel/db';
import type { ReplayReport } from './engine';

export interface InvariantResult {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
}

const docs = <T>(db: Db, sql: string, ...p: (string | number)[]) => db.all<{ doc: string }>(sql, ...p).map((r) => JSON.parse(r.doc) as T);

/** 보존 sweep 대상 표의 시각 열 */
const RETENTION_AT: Record<string, string> = { status_report: 'received_at', readback: 'at', vehicle_request: 'at', security_event: 'at' };

export function checkInvariants(db: Db, audit: AuditService, report: ReplayReport, opts: { populationTolerance?: number } = {}): InvariantResult[] {
  const out: InvariantResult[] = [];
  const add = (id: string, title: string, ok: boolean, detail: string) => out.push({ id, title, ok, detail });

  add('INV-01', '결함(5xx) 0건', report.errors.length === 0, `${report.errors.length}건${report.errors.length ? ` — 첫 건 ${report.errors[0].op}: ${report.errors[0].message}` : ''}`);

  const chain = audit.verifyChain();
  add('INV-02', '감사 해시 체인이 처음부터 끝까지 이어진다', chain.ok, `${chain.verified}행 검증${chain.broken ? `, 끊김 id ${chain.broken.id}(${chain.broken.kind})` : ''}`);

  const policies = docs<Policy & { deployedBy?: string; deployedAt?: string }>(db, 'SELECT doc FROM policy');
  const selfApproved = policies.filter((p) => p.approvedBy && p.approvedBy === p.createdBy);
  add('INV-03', '정책 승인자 ≠ 작성자', selfApproved.length === 0, `승인 ${policies.filter((p) => p.approvedBy).length}건 중 위반 ${selfApproved.length}`);

  const runs = new Map(db.all<{ run_id: string; decision: string; content_hash: string }>('SELECT run_id, decision, content_hash FROM validation_run').map((r) => [r.run_id, r]));
  const deployed = policies.filter((p) => p.deployedAt);
  const ungated = deployed.filter((p) => {
    const run = p.lastValidationId ? runs.get(p.lastValidationId) : undefined;
    return !run || run.decision !== 'GO' || run.content_hash !== p.contentHash;
  });
  add('INV-04', '배포된 정책은 모두 같은 내용 해시의 GO 검증을 거쳤다', ungated.length === 0, `배포 ${deployed.length}건 중 위반 ${ungated.map((p) => p.policyId).join(', ') || 0}`);

  // 단계 확대(효력 넓히기)는 그때의 배포자가 아닌 사람이 — 감사를 시간순으로 따라가며 배포(롤백 재배포 포함)마다 배포자를 바꾼다
  const trail = db.all<{ actor_id: string; action: string; target: string }>("SELECT actor_id, action, target FROM audit WHERE result = 'ALLOWED' AND action IN ('POLICY_DEPLOY', 'ROLLOUT_STAGE') ORDER BY id");
  const deployerNow = new Map<string, string>();
  let stages = 0;
  let sameAsDeployer = 0;
  for (const a of trail) {
    if (a.action === 'POLICY_DEPLOY') deployerNow.set(a.target, a.actor_id);
    else {
      stages++;
      if (deployerNow.get(a.target) === a.actor_id) sameAsDeployer++;
    }
  }
  add('INV-05', '단계 확대자 ≠ 그때의 배포자', sameAsDeployer === 0, `확대 ${stages}건 중 위반 ${sameAsDeployer}`);

  const kills = docs<KillRequest>(db, 'SELECT doc FROM kill_request');
  const killBad = kills.filter((k) => {
    const a = (k.approvals ?? []).map((x) => x.approverId);
    if (k.status === 'REQUESTED' || k.status === 'REJECTED') return a.includes(k.requestedBy);
    const restore = (k.restoreRequest?.approvals ?? []).map((x) => x.approverId);
    return new Set(a).size !== a.length || a.length < 2 || a.includes(k.requestedBy) || restore.some((x) => a.includes(x)) || (k.restoreRequest ? restore.includes(k.restoreRequest.requestedBy) : false);
  });
  add('INV-06', '긴급 차단: 서로 다른 2인 승인, 요청자 제외, 복원 승인자는 차단 승인자와 겹치지 않는다', killBad.length === 0, `차단 ${kills.length}건 중 위반 ${killBad.map((k) => k.killId).join(', ') || 0}`);

  const lastDay = report.end;
  const now = `${lastDay}T12:00:00.000Z`;
  const stale: string[] = [];
  for (const p of RETENTION_POLICIES) {
    const col = RETENTION_AT[p.store];
    const cut = retentionCutoff(p, now);
    if (!col || !cut) continue;
    // 그날 sweep 뒤 남은 행 — 하루 안에 생긴 경계 행은 다음 sweep 몫이라 하루 여유를 둔다
    const margin = new Date(Date.parse(cut) - 86_400_000).toISOString();
    const n = db.get<{ n: number }>(`SELECT count(*) AS n FROM ${p.store} WHERE ${col} < ?`, margin)?.n ?? 0;
    if (n) stale.push(`${p.store} ${n}행`);
  }
  add('INV-07', '보존 기간이 지난 행이 남지 않는다(상태 보고·readback·차량 발신·보안 로그)', stale.length === 0, stale.join(', ') || '없음');

  const grants = docs<Entitlement>(db, "SELECT doc FROM entitlement WHERE source = 'SYNTHETIC'");
  const trials = grants.filter((g) => g.kind === '체험');
  const accepted = trials.filter((g) => g.acceptedAt).length;
  const converted = trials.filter((g) => grantState(g, lastDay).state === 'CONVERTED').length;
  add('INV-08', '체험 깔때기 단조 — 제안 ≥ 수락 ≥ 구매, 구매마다 구독·구매 권한', trials.length >= accepted && accepted >= converted && grants.filter((g) => g.fromTrial).length === converted, `제안 ${trials.length} · 수락 ${accepted} · 구매 ${converted}`);

  const profiles = docs<VehicleProfile>(db, "SELECT doc FROM vehicle_profile WHERE source = 'SYNTHETIC'").filter((p) => p.soldMonth);
  const represented = profiles.filter((p) => inService(p, lastDay)).reduce((s, p) => s + weightOf(p), 0);
  const modelAtEnd = populationAt(report.start, lastDay).funnel.active;
  const tol = opts.populationTolerance ?? 0.15;
  const gap = modelAtEnd ? Math.abs(represented / modelAtEnd - 1) : 0;
  add('INV-09', `등록 표본의 가중 합계가 모집단 모델과 ±${Math.round(tol * 100)}% 안`, represented > 0 && gap <= tol, `표본 ${Math.round(represented).toLocaleString('ko-KR')}대 · 모델 ${Math.round(modelAtEnd).toLocaleString('ko-KR')}대 · 차이 ${(gap * 100).toFixed(1)}%`);

  const offline = db.get<{ n: number }>("SELECT count(*) AS n FROM vehicle WHERE json_extract(doc, '$.fleet') = 'SAMPLE'")?.n ?? 0;
  add('INV-10', '수신 표본이 등록되고 게시본을 받았다', offline > 0 && (db.get<{ n: number }>('SELECT count(*) AS n FROM readback')?.n ?? 0) > 0, `수신 표본 ${offline}대`);
  const expiredKey = db.get<{ n: number }>("SELECT count(*) AS n FROM readback WHERE json_extract(doc, '$.rejectReason') = 'KEY_EXPIRED'")?.n ?? 0;
  add('INV-11', '차량이 서명 키 만료로 거부한 게시본 0건(키 교체 운영)', expiredKey === 0, `KEY_EXPIRED 거부 ${expiredKey}건`);

  const stuck = kills.filter((k) => k.status === 'REQUESTED' && k.expiresAt && k.expiresAt < now).length;
  add('INV-12', '처리되지 않고 유효 시간이 지난 차단·비활성화 요청 0건', stuck === 0, `${stuck}건`);

  // ── GitLab · JIRA · codeBeamer 양방향 연계 ──
  const mock = (system: string, key: string) => {
    const r = db.get<{ doc: string }>('SELECT doc FROM mock_ext_item WHERE system = ? AND ext_key = ?', system, key);
    return r ? (JSON.parse(r.doc) as { status: string; kind: string }) : null;
  };
  const lifecycleOf = new Map(docs<{ featureId: string; version: string; lifecycle: Lifecycle }>(db, 'SELECT doc FROM feature_version').map((f) => [`${f.featureId}@${f.version}`, f.lifecycle]));
  const epicOff: string[] = [];
  for (const l of db.all<{ ext_key: string; entity_id: string }>("SELECT l.ext_key, l.entity_id FROM ext_link l JOIN ext_item i ON i.system = l.system AND i.ext_key = l.ext_key WHERE l.system = 'JIRA' AND l.entity = 'FEATURE' AND i.kind = 'EPIC'")) {
    const lc = lifecycleOf.get(l.entity_id);
    const it = mock('JIRA', l.ext_key);
    if (lc && it && it.status !== JIRA_EPIC_STATUS[lc]) epicOff.push(`${l.ext_key} ${it.status}≠${JIRA_EPIC_STATUS[lc]}`);
  }
  const crExpected: Record<string, string> = { APPROVED: JIRA_CR_STATUS.APPROVED, DEPLOYED: JIRA_CR_STATUS.DEPLOYED };
  const crOff: string[] = [];
  for (const l of db.all<{ ext_key: string; entity_id: string }>("SELECT ext_key, entity_id FROM ext_link WHERE system = 'JIRA' AND entity = 'POLICY'")) {
    const p = policies.find((x) => x.policyId === l.entity_id);
    const it = mock('JIRA', l.ext_key);
    const want = p ? crExpected[p.status] : undefined;
    if (want && it && it.status !== want && !(p!.status === 'DEPLOYED' && it.status === JIRA_CR_STATUS.ROLLED_BACK)) crOff.push(`${l.ext_key} ${it.status}≠${want}`);
  }
  const pendingJobs = db.get<{ n: number }>("SELECT count(*) AS n FROM sync_outbox WHERE status IN ('PENDING', 'FAILED')")?.n ?? 0;
  const openConflicts = db.get<{ n: number }>("SELECT count(*) AS n FROM sync_conflict WHERE status = 'OPEN'")?.n ?? 0;
  add('INV-13', '외부 도구가 주인 규칙대로 수렴 — Epic = Lifecycle, CR = 정책 상태, 보낼 함·충돌 0', !epicOff.length && !crOff.length && pendingJobs === 0 && openConflicts === 0, `Epic 불일치 ${epicOff.length}${epicOff[0] ? ` (${epicOff[0]})` : ''} · CR 불일치 ${crOff.length}${crOff[0] ? ` (${crOff[0]})` : ''} · 남은 작업 ${pendingJobs} · 충돌 ${openConflicts}`);

  const linked = (entity: string, id: string, system: string, kind?: string) =>
    (db.get<{ n: number }>(`SELECT count(*) AS n FROM ext_link l JOIN ext_item i ON i.system = l.system AND i.ext_key = l.ext_key WHERE l.entity = ? AND l.entity_id = ? AND l.system = ?${kind ? ' AND i.kind = ?' : ''}`, ...(kind ? [entity, id, system, kind] : [entity, id, system]))?.n ?? 0) > 0;
  const untraced = deployed.filter((p) => !linked('POLICY', p.policyId, 'JIRA', 'CHANGE_REQUEST') || !linked('FEATURE', `${p.featureId}@${p.featureVersion}`, 'CODEBEAMER') || !linked('FEATURE', `${p.featureId}@${p.featureVersion}`, 'GITLAB', 'MERGE_REQUEST'));
  add('INV-14', '배포된 정책마다 JIRA 변경요청·codeBeamer 요구·GitLab MR 연결', untraced.length === 0, `배포 ${deployed.length}건 중 추적 빠짐 ${untraced.map((p) => p.policyId).join(', ') || 0}`);

  const ids = JSON.parse(readFileSync(join(process.env.FF_EXT_FIXTURES ?? EXT_FIXTURES, 'ext-identities.json'), 'utf8')) as { actorId: string; roles: string[] }[];
  const viaExt = db.all<{ actor_id: string; actor_role: string; action: string; target: string }>("SELECT actor_id, actor_role, action, target FROM audit WHERE result = 'ALLOWED' AND (correlation_id LIKE 'jira:%' OR correlation_id LIKE 'gitlab:%' OR correlation_id LIKE 'codebeamer:%') AND actor_role != 'SYSTEM'");
  const unmapped = viaExt.filter((a) => !ids.some((i) => i.actorId === a.actor_id && i.roles.includes(a.actor_role)));
  const selfViaExt = viaExt.filter((a) => a.action.startsWith('POLICY_DECISION') || a.action.startsWith('POLICY_APPROVE')).filter((a) => policies.find((p) => p.policyId === a.target)?.createdBy === a.actor_id);
  const rejected = db.get<{ n: number }>("SELECT count(*) AS n FROM sync_inbox WHERE outcome IN ('REJECTED', 'UNMAPPED')")?.n ?? 0;
  add('INV-15', '외부에서 들어온 변경으로 직무 분리가 깨진 적 0건 — 매핑된 계정·허용 역할만, 우회 시도는 거부', unmapped.length === 0 && selfViaExt.length === 0, `외부 경유 반영 ${viaExt.length}건 · 매핑 밖 ${unmapped.length} · 자기 승인 ${selfViaExt.length} · 거부·되돌림 ${rejected}건`);
  return out;
}
