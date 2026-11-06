// ADS 요구사항(harness/ads/catalog.json) 결함 기록 → 회귀 시험. readiness: RD-FN-01 — 기록한 결함(F036·F019·F059·F007·ORCA-HT06)은 모두 고쳤다.
// 각 시험은 "요구되는 올바른 동작"을 단언한다. 새 결함은 it.fails로 기록하고 harness/ads/review.json에 defect를 단다.
// 시험마다 앱을 새로 띄운다 — 한 결함의 재현 단계(차단·복원·재-HARA 요청)가 다른 결함 기록에 새지 않게.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal', CARLA_RUNNER: require('node:path').resolve(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'), FF_EVIDENCE_DIR: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'ff-ads-')) });
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { statusAuthCanonical, type KillCommandV2 } from '@ff/contracts';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { Scheduler } from '../../src/kernel/scheduler';
import { VehicleRuntimeService } from '../../src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service';
import { RuntimeRepo } from '../../src/domains/d06-qsec/secure-deploy/publication.repo';
import { AuditService } from '../../src/kernel/audit.service';
import { HsmService } from '../../src/domains/d06-qsec/pki-kms/hsm.service';
import { actor, bootApp, confirmSafety, KILL_REQUESTER, killV2, RESTORE_APPROVERS, restoreBody, restoreV2 } from '../helpers';
import { registerTestApprovers, signApprovals } from '../approver-keys';

const OPS = actor('usr-ops', 'OPERATOR');
const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const POLICY_AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const POLICY_APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');
const RELEASE = actor('usr-coordinator', 'RELEASE_MANAGER');
const AT = '2026-10-12T01:00:00.000Z';
const KILL = { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01', 'lead-01'], reason: 'ADS 결함 기록', confirm: 'FEAT-00022' };
const EX = join(__dirname, '..', '..', '..', 'harness', 'guide', 'schema', 'examples');

/** 부팅 동기화까지 흘려 보낸 앱 + 시계·스케줄러를 함께 미는 advance */
async function boot(at = AT) {
  const b = await bootApp({ at });
  b.app.get(Scheduler).flush();
  const clock = b.get(Clock);
  const advance = (ms: number) => {
    const until = clock.now().getTime() + ms;
    b.get(Scheduler).flush(ms);
    clock.set(new Date(until));
  };
  return { ...b, advance, db: b.get<Db>(DB) };
}

describe('ADS 요구사항 결함 기록 — 종료·해제·명령 전달·승인', () => {
  afterAll(() => {
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE', 'CARLA_RUNNER', 'FF_EVIDENCE_DIR']) delete process.env[k];
  });

  it('FFP-F036 해제와 활성화 분리 — 승인된 복원 뒤 다음 시동에서도 차량은 저절로 ACTIVE가 되지 않는다', async () => {
    const { app, http, advance } = await boot();
    try {
      const k = await killV2(http, KILL);
      advance(8_000); // DC2 인계 4 s + 램프 3 s → DISABLED
      expect((await http().get('/api/vehicles/ego-01/status').expect(200)).body.features[0]).toMatchObject({ featureId: 'FEAT-00022', state: 'DISABLED' });
      await restoreV2(http, k.killId); // 차단 승인자와 다른 2인
      advance(1_000); // 복원 게시본 전달(회신 지연) — 차량 Guard가 받아들여 RESTORE_PENDING
      expect((await http().get('/api/vehicles/ego-01/status').expect(200)).body.features[0].state).toBe('RESTORE_PENDING');
      advance(3_000); // 다음 시동
      const st = (await http().get('/api/vehicles/ego-01/status').expect(200)).body.features[0];
      // 요구: 해제는 활성화가 아니다 — ODD·형상·사용자 절차를 새로 통과하기 전까지 ACTIVE로 가지 않는다
      expect(st.state).not.toBe('ACTIVE');
    } finally {
      await app.close();
    }
  });

  it('FFP-F036 집계(ADS-BE03) — 복원 뒤 활성화 명령 없이 온 2.0 ACTIVE 보고는 복원 확인에 넣지 않고 "재판정 근거 없음"으로 따로 센다', async () => {
    const { app, http, advance, get } = await boot();
    try {
      const k = await killV2(http, KILL);
      advance(8_000);
      await restoreV2(http, k.killId);
      advance(1_000); // RESTORE_PENDING
      const last = (await http().get('/api/vehicles/ego-01/status').expect(200)).body.features[0].report;
      expect(last.state).toBe('RESTORE_PENDING');
      // 차량(다른 구현)이 다음 시동에서 재판정 없이 곧바로 ACTIVE를 보고한다 — 정상 서명
      const { state_auth: _a, ...base } = last;
      const active = { ...base, state: 'ACTIVE', request_result: 'NONE', hmi: 'NONE', edr_aligned_state: 'AVAILABLE', feature_weight_permille: 1000, reason: { ...base.reason, source: 'STARTUP' }, report_seq: last.report_seq + 1 };
      const signed = { ...active, state_auth: get(HsmService).cmac('ego-01', active.key_epoch, Buffer.from(statusAuthCanonical(active))) };
      expect((await http().post('/vehicle/v1/ego-01/status').set({ 'X-Vehicle-Id': 'ego-01' }).send(signed).expect(200)).body).toMatchObject({ accepted: true });
      const restore = (await http().get(`/api/kill-requests/${k.killId}`).expect(200)).body.restore;
      expect(restore.confirmed).toBe(0); // Active 집계 0 — 복원 확인은 INACTIVE(차단 해제)만
      expect(restore.activeWithoutRedecision).toBe(1); // 재판정 근거 없음 1
    } finally {
      await app.close();
    }
  });

  it('FFP-F019 명령 멱등성 — 같은 command_id 봉투를 그대로 다시 보내면 앞 결과를 돌려주고 보안 이벤트·전이는 없다', async () => {
    const { app, http, advance, db } = await boot();
    try {
      const k = await killV2(http, KILL);
      advance(8_000);
      const env: KillCommandV2 = (await http().get(`/api/kill-requests/${k.killId}/envelopes`).expect(200)).body.envelopes.find((e: KillCommandV2) => e.scope.vehicle_ids[0] === 'ego-01');
      const securityEvents = () => db.get<{ n: number }>("SELECT COUNT(*) AS n FROM security_event WHERE event_id = 'REPLAY_SEQUENCE'")!.n;
      const before = securityEvents();
      // 네트워크 재시도 — 차량 Guard가 같은 봉투(같은 command_id·내용)를 다시 받는다
      app.get(VehicleRuntimeService).guard('ego-01', k.publicationId, 'KILL', env, ['FEAT-00022']);
      const st = (await http().get('/api/vehicles/ego-01/status').expect(200)).body.features[0];
      expect(st.report.request_result).not.toBe('REJECTED'); // 요구: 멱등 ACK(앞 결과)
      expect(securityEvents()).toBe(before); // 요구: 재시도는 보안 이벤트가 아니다
      expect(st.state).toBe('DISABLED'); // 두 번째 전이 없음
    } finally {
      await app.close();
    }
  });

  // 5년 운영 재생 결정 ① — 안전 프로파일에 sbomRef가 없는 Feature(FEAT-00025 EU·FEAT-00028 US)는 긴급 차단 뒤 복원이 FFG-PLT-010에서 막혔다.
  // 코디네이터 결정(2026-11-06): 복원은 차단 전에 배포돼 있던 기능을 되살린다 — 그 Feature Version의 마지막 정책 배포 게시본 SBOM을
  // BOM-Link(urn:cdx:<serial>/<version>)로 참조한다. 차단·복원 게시본 자체의 SBOM은 쓰지 않고, 배포 게시본 SBOM이 없으면 복원을 막는다
  const bomLink = (r: { serial: string; doc: string }) => `urn:cdx:${r.serial.replace(/^urn:uuid:/, '')}/${JSON.parse(r.doc).version}`;
  /** 차단 전 배포 — 5년 재생과 같은 경로(정책 작성 → GO 검증 → 승인 → 배포). 카탈로그는 재생 출시 일정(launches.json)의 값 */
  const CATALOG: Record<string, string> = { 'FEAT-00025': 'CAT-00014', 'FEAT-00028': 'CAT-00015' };
  async function deployPolicy(http: () => any, advance: (ms: number) => void, featureId: string) {
    const c = await http().post('/api/policies').set(POLICY_AUTHOR).send({ featureId, featureVersion: '1.0.0', controlPoint: 'Signal', flagKey: `f${featureId.slice(-5)}_signal_launch`, description: '출시 배포', safeDefault: false, entitlementCatalogId: CATALOG[featureId] }).expect(201);
    const pid = c.body.policyId;
    expect((await http().post(`/api/policies/${pid}/validate`).set(POLICY_AUTHOR).send({}).expect(200)).body.run.decision).toBe('GO');
    await http().post(`/api/policies/${pid}/decision`).set(POLICY_APPROVER).send({ decision: 'APPROVE', reason: 'GO 확인' }).expect(200);
    await http().post(`/api/policies/${pid}/deploy`).set(RELEASE).send({ reason: '출시 배포' }).expect(200);
    advance(12_000);
  }
  for (const featureId of ['FEAT-00025', 'FEAT-00028'])
    it(`5년 재생 결정 ① ${featureId} — 프로파일에 sbomRef가 없어도 복원은 마지막 정책 배포 게시본의 SBOM을 참조해 게이트(FFG-PLT-010)를 통과한다(차단 게시본 SBOM이 더 최근이어도)`, async () => {
      const { app, http, advance, db } = await boot();
      try {
        const policySbom = () =>
          db.get<{ serial: string; doc: string; created_at: string }>(
            "SELECT s.serial, s.doc, s.created_at FROM sbom s JOIN publication p ON p.publication_id = s.publication_id WHERE s.feature_id = ? AND s.feature_version = '1.0.0' AND p.kind = 'POLICY' ORDER BY p.created_at DESC, p.sequence DESC LIMIT 1",
            featureId,
          );
        await deployPolicy(http, advance, featureId);
        const deployed = policySbom();
        expect(deployed).toBeTruthy();
        advance(60_000); // 차단 게시본 SBOM이 배포 게시본 SBOM보다 뒤에 생기게
        const k = await killV2(http, { featureId, featureVersion: '1.0.0', reason: '현장 고장 봉쇄', confirm: featureId });
        const killSbom = db.get<{ serial: string; doc: string; created_at: string }>('SELECT serial, doc, created_at FROM sbom WHERE publication_id = ?', k.publicationId)!;
        expect(killSbom.created_at > deployed!.created_at).toBe(true);
        advance(8_000);
        await restoreV2(http, k.killId);
        const kr = (await http().get(`/api/kill-requests/${k.killId}`).expect(200)).body;
        expect(kr.restorePublicationId).toBeTruthy();
        const env: KillCommandV2 = (await http().get(`/api/kill-requests/${k.killId}/envelopes`).expect(200)).body.envelopes.find((e: KillCommandV2) => e.request === 'restore');
        expect(env.evidence.sbom_ref).toBe(bomLink(deployed!)); // 차단 게시본 SBOM이 아니라 배포 게시본 SBOM
        expect(env.evidence.sbom_ref).not.toBe(bomLink(killSbom));
      } finally {
        await app.close();
      }
    });

  it('5년 재생 결정 ① — 정책 배포 게시본 SBOM이 없으면 최근 SBOM(차단 게시본)으로 내려가지 않고 복원을 FFG-PLT-010으로 막는다', async () => {
    const { app, http, advance, db } = await boot();
    try {
      const featureId = 'FEAT-00025';
      // 배포 게시본 SBOM이 없는 상태를 만든다(추가 전용 트리거를 걷고 지운다 — 시험 전용)
      db.run('DROP TRIGGER sbom_no_delete');
      db.run("DELETE FROM sbom WHERE feature_id = ? AND publication_id IN (SELECT publication_id FROM publication WHERE kind = 'POLICY')", featureId);
      const k = await killV2(http, { featureId, featureVersion: '1.0.0', reason: '현장 고장 봉쇄', confirm: featureId });
      advance(8_000);
      const body = await restoreBody(http, k.killId);
      await http().post(`/api/kill-requests/${k.killId}/restore`).set(KILL_REQUESTER).send(body).expect(201);
      await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(RESTORE_APPROVERS[0]).send({}).expect(201);
      await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(RESTORE_APPROVERS[1]).send({});
      const kr = (await http().get(`/api/kill-requests/${k.killId}`).expect(200)).body;
      expect(kr.restorePublicationId).toBeFalsy();
      expect(kr.restoreRequest.gate.failed).toContain('FFG-PLT-010');
    } finally {
      await app.close();
    }
  });

  it('FFP-F014 대상 검증(ADS-BE05) — 대상(payload.targets) 밖 차량은 차단 게시본도 적용하지 않고 TARGET_MISMATCH로 남긴다', async () => {
    const { app, http } = await boot();
    try {
      const k = await killV2(http, KILL);
      const { publication } = (await http().get(`/api/publications/${k.publicationId}`).expect(200)).body;
      const outsider = 'HMA-NX4-0001';
      expect(publication.payload.targets).not.toContain(outsider);
      const before = (await http().get(`/api/vehicles/${outsider}/runtime`).expect(200)).body.runtime;
      try {
        app.get(VehicleRuntimeService).receive(outsider, publication);
      } catch {
        /* 플랫폼 수집기의 대상 밖 회신 거부(2차 방어) */
      }
      const s = (await http().get(`/api/vehicles/${outsider}/runtime`).expect(200)).body.runtime;
      expect(s.kills['FEAT-00022']).toBeUndefined(); // 요구: 잘못된 대상 명령은 적용하지 않는다
      expect(s.featureState['FEAT-00022']).toBe(before.featureState['FEAT-00022']);
      expect(s.log.at(-1)).toMatchObject({ publicationId: k.publicationId, result: 'REJECTED', detail: 'TARGET_MISMATCH' });
      // VIN은 대상 목록의 정본(차량 목록 VIN)과 글자 그대로 맞아야 한다 — 대소문자·공백만 다른 VIN도 대상 밖(정규화로 넓히지 않는다)
      const runtimes = app.get(RuntimeRepo);
      for (const variant of [publication.payload.targets[0].toUpperCase(), ` ${publication.payload.targets[0]}`]) {
        expect(publication.payload.targets).not.toContain(variant);
        app.get(VehicleRuntimeService).receive(variant, publication);
        const v = runtimes.get(variant);
        expect(v.kills['FEAT-00022']).toBeUndefined();
        expect(v.log.at(-1)).toMatchObject({ publicationId: k.publicationId, result: 'REJECTED', detail: 'TARGET_MISMATCH' });
      }
    } finally {
      await app.close();
    }
  });

  it('FFP-F059 일괄 명령 미리보기 — 등록된 승인자 키로 검증되지 않거나 대상 집합에 묶이지 않은 승인 서명의 차단 명령은 게이트가 거부한다', async () => {
    const { app, http, get } = await boot('2026-10-13T00:30:00Z'); // 예시 명령 유효기간 안
    try {
      const example: KillCommandV2 = JSON.parse(readFileSync(join(EX, 'kill_safety_dc2_eu.ok.json'), 'utf8'));
      // D-RD-5 기준선 변경 — 보고서 예시의 자리표시 서명은 이제 FAIL(승인자 키 미등록). PASS 기준선은 등록된 시험 승인자 키로 서명한 명령
      const placeholder = (await http().post('/api/gate/preview').set(OPS).send(example).expect(201)).body;
      expect(placeholder.result).toBe('FAIL');
      expect(placeholder.findings.filter((f: { ok: boolean }) => !f.ok).map((f: { rule: string }) => f.rule)).toEqual(['FFG-PLT-005']);
      registerTestApprovers(get(HsmService), example.approvals.map((a) => a.approver_id));
      const ok = signApprovals(example);
      expect((await http().post('/api/gate/preview').set(OPS).send(ok).expect(201)).body.result).toBe('PASS'); // 기준선
      // 대상 집합과 무관한 임의 문자열 — 어떤 차량에 대해서도 서명이 아니다
      const forged = { ...ok, approvals: ok.approvals.map((a) => ({ ...a, approval_sig: 'x'.repeat(86) })) };
      const v = (await http().post('/api/gate/preview').set(OPS).send(forged).expect(201)).body;
      expect(v.result).toBe('FAIL');
      // 서명 뒤 대상 차량을 늘린 명령 — 서명은 진짜여도 대상 집합이 다르다
      const widened = { ...ok, scope: { ...ok.scope, vehicle_ids: [...ok.scope.vehicle_ids, 'VHC-000125'], max_vehicles: 3 } };
      expect((await http().post('/api/gate/preview').set(OPS).send(widened).expect(201)).body.result).toBe('FAIL');
    } finally {
      await app.close();
    }
  });

  it('FFP-F007 승인 영향 판정 — G8·G9 PASS·Release Sign-off 뒤 열린 재-HARA 요청이 있으면 출시 전이는 거부된다', async () => {
    const { app, http } = await boot('2026-10-18T01:00:00.000Z');
    try {
      const base = '/api/features/FEAT-00001/versions/2.1.0';
      await confirmSafety(http, 'FEAT-00001', '2.1.0');
      for (const gate of ['G8', 'G9']) await http().post(`${base}/gates`).set(JUDGE).send({ gate, inputResult: 'PASS', rationale: '출시 조건 확인', evidenceRef: `EV-${gate}` }).expect(201);
      await http().post(`${base}/release-signoff`).set(AUTHOR).send({ reason: '출시 책임 확인' }).expect(201);
      // 서명 뒤 새 Topology 관계 — 재-HARA 요청(TOPOLOGY)이 열린다.
      // 다른 Feature의 새 Version(초안)이 FEAT-00001@2.1.0에 의존 — 대상 쪽에도 TOPOLOGY 재-HARA 요청이 열린다(rehara.service)
      const src = (await http().post('/api/features/FEAT-00024/versions').set(AUTHOR).send({ baseVersion: '1.0.0', reason: '연동 추가', changes: { description: 'FEAT-00001 연동' } }).expect(201)).body.feature.version;
      await http().post('/api/dependencies').set(AUTHOR).send({ type: 'REQUIRES', sourceFeatureId: 'FEAT-00024', sourceVersion: src, targetFeatureId: 'FEAT-00001', targetVersion: '2.1.0' }).expect(201);
      const open = (await http().get('/api/rehara-requests?featureId=FEAT-00001&featureVersion=2.1.0&status=OPEN').expect(200)).body.items;
      expect(open).toEqual([expect.objectContaining({ condition: 'TOPOLOGY', status: 'OPEN' })]);
      // 요구: 영향 검토(재-HARA) 미완료 변경은 출시·서명 단계로 승격되지 않는다
      const r = await http().post(`${base}/transitions`).set(RELEASE).send({ to: 'RELEASED', reason: '출시' });
      expect(r.status).toBe(422);
      expect(r.body.error.details.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'REHARA_OPEN' })])); // ADS-BE06 같은 사유 코드
    } finally {
      await app.close();
    }
  });

  it('FFP-F007 승인 영향 판정 — 열린 재-HARA 요청이 있으면 Release Sign-off(서명 단계)도 거부된다', async () => {
    const { app, http } = await boot('2026-10-18T01:00:00.000Z');
    try {
      const base = '/api/features/FEAT-00001/versions/2.1.0';
      await confirmSafety(http, 'FEAT-00001', '2.1.0');
      for (const gate of ['G8', 'G9']) await http().post(`${base}/gates`).set(JUDGE).send({ gate, inputResult: 'PASS', rationale: '출시 조건 확인', evidenceRef: `EV-${gate}` }).expect(201);
      const src = (await http().post('/api/features/FEAT-00024/versions').set(AUTHOR).send({ baseVersion: '1.0.0', reason: '연동 추가', changes: { description: 'FEAT-00001 연동' } }).expect(201)).body.feature.version;
      await http().post('/api/dependencies').set(AUTHOR).send({ type: 'REQUIRES', sourceFeatureId: 'FEAT-00024', sourceVersion: src, targetFeatureId: 'FEAT-00001', targetVersion: '2.1.0' }).expect(201);
      const open = (await http().get('/api/rehara-requests?featureId=FEAT-00001&featureVersion=2.1.0&status=OPEN').expect(200)).body.items;
      const r = await http().post(`${base}/release-signoff`).set(AUTHOR).send({ reason: '출시 책임 확인' });
      expect(r.status).toBe(422);
      expect(r.body.error.message).toMatch(/재-HARA/);
      // ADS-BE06 — 출시 전이·서명·Gate PASS가 같은 사유 코드(REHARA_OPEN)로 거부한다
      expect(r.body.error.details.blockers).toEqual([expect.objectContaining({ code: 'REHARA_OPEN', ref: open[0].requestId })]);
      const g = await http().post(`${base}/gates`).set(JUDGE).send({ gate: 'G9', inputResult: 'PASS', rationale: '재판정', evidenceRef: 'EV-G9' });
      expect(g.status).toBe(422);
      expect(g.body.error.details.blockers).toEqual([expect.objectContaining({ code: 'REHARA_OPEN', ref: open[0].requestId })]);
    } finally {
      await app.close();
    }
  });

  // D-RD-6(20-90) — 열린 재-HARA는 정책 배포를 막지 않는다(완화·ODD 축소 정책이 재-HARA 중에도 차량에 나가야 한다).
  // 출시 전이·Release Sign-off만 막는다(위 두 시험). 같은 Feature Version에서 둘을 함께 확인한다.
  it('D-RD-6 열린 재-HARA 요청이 있어도 정책 배포는 된다 — 같은 Version의 출시 전이는 거부된다', async () => {
    const { app, http, advance } = await boot('2026-10-18T01:00:00.000Z');
    try {
      const base = '/api/features/FEAT-00001/versions/2.1.0';
      await confirmSafety(http, 'FEAT-00001', '2.1.0');
      for (const gate of ['G8', 'G9']) await http().post(`${base}/gates`).set(JUDGE).send({ gate, inputResult: 'PASS', rationale: '출시 조건 확인', evidenceRef: `EV-${gate}` }).expect(201);
      await http().post(`${base}/release-signoff`).set(AUTHOR).send({ reason: '출시 책임 확인' }).expect(201);
      const src = (await http().post('/api/features/FEAT-00024/versions').set(AUTHOR).send({ baseVersion: '1.0.0', reason: '연동 추가', changes: { description: 'FEAT-00001 연동' } }).expect(201)).body.feature.version;
      await http().post('/api/dependencies').set(AUTHOR).send({ type: 'REQUIRES', sourceFeatureId: 'FEAT-00024', sourceVersion: src, targetFeatureId: 'FEAT-00001', targetVersion: '2.1.0' }).expect(201);
      const open = (await http().get('/api/rehara-requests?featureId=FEAT-00001&featureVersion=2.1.0&status=OPEN').expect(200)).body.items;
      expect(open).toEqual([expect.objectContaining({ condition: 'TOPOLOGY', status: 'OPEN' })]);
      // 정책 배포 — 재-HARA가 열려 있어도 승인된 정책은 배포된다(완화 정책이 막히지 않게)
      const c = await http().post('/api/policies').set(POLICY_AUTHOR).send({ featureId: 'FEAT-00001', featureVersion: '2.1.0', controlPoint: 'Flag', flagKey: 'f00001_flag_rehara', description: '재-HARA 중 완화 정책', safeDefault: false, entitlementCatalogId: 'CAT-00001' }).expect(201);
      const pid = c.body.policyId;
      expect((await http().post(`/api/policies/${pid}/validate`).set(POLICY_AUTHOR).send({}).expect(200)).body.run.decision).toBe('GO');
      await http().post(`/api/policies/${pid}/decision`).set(POLICY_APPROVER).send({ decision: 'APPROVE', reason: 'GO 확인' }).expect(200);
      const d = await http().post(`/api/policies/${pid}/deploy`).set(RELEASE).send({ reason: '재-HARA 중 완화 배포' });
      expect(d.status).toBe(200);
      expect(d.body.publicationId).toBeTruthy();
      advance(12_000);
      // 같은 Version의 출시 전이는 재-HARA 때문에 거부된다
      const r = await http().post(`${base}/transitions`).set(RELEASE).send({ to: 'RELEASED', reason: '출시' });
      expect(r.status).toBe(422);
      expect(JSON.stringify(r.body)).toMatch(/재-HARA/);
    } finally {
      await app.close();
    }
  });

  // FFP-F060(감사 체인 끝 삭제 미탐지)은 고쳤다 — 회귀 시험은 test/kernel/audit-chain.spec.ts(출시 준비 RD-SEC-13)

  it('ORCA-HT06 시각 신뢰도 — 발생 시각 없이 접수한 사건은 발생 시각을 비워 두고 수신 시각으로 채우지 않는다', async () => {
    const { app, http } = await boot();
    try {
      const r = (await http().post('/api/incidents').set(OPS).send({ source: 'FIELD', vin: 'ego-01', category: 'OTHER', severity: 'WARNING', summary: '발생 시각 미상 사건' }).expect(201)).body;
      // 요구: 누락을 정상값으로 대체하지 않는다 — 발생 시각 미상은 미상으로 남는다
      expect(r.occurredAt).toBeNull();
    } finally {
      await app.close();
    }
  });
});
