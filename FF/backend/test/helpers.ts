import { INestApplication, Type } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';

/** 메모리 DB + v0.81 시드로 앱을 띄운다. 테스트마다 독립 DB. */
export async function bootApp(opts: { controllers?: Type<unknown>[]; providers?: Type<unknown>[]; at?: string } = {}) {
  process.env.FF_DB = ':memory:';
  process.env.FF_SEED = 'v0.81';
  // at — 부팅 전에 시계를 고정한다. 부팅 때 잡히는 일정(부팅 동기화 게시본의 회신 기한)이 실제 날짜에 따라 달라지지 않게.
  if (opts.at) process.env.FF_CLOCK_AT = opts.at;
  const mod = await Test.createTestingModule({
    imports: [AppModule],
    controllers: opts.controllers ?? [],
    providers: opts.providers ?? [],
  }).compile();
  // rawBody — main.ts(createApp)와 같이 원문 본문을 보관한다(webhook HMAC·차량 요청 CMAC가 원문 바이트로 확인)
  const app: INestApplication = mod.createNestApplication(new ExpressAdapter(), { logger: false, rawBody: true });
  await app.init();
  delete process.env.FF_CLOCK_AT;
  const http = () => request(app.getHttpServer());
  return { app, http, get: <T>(t: Type<T> | symbol) => app.get<T>(t as any) };
}

export const actor = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });

/** 안전 분류 확정(보고서 v1.1 G2 선행 — Safety Manager 개인 서명). G1 다음 Gate를 PASS로 판정하는 시험 흐름이 먼저 부른다 */
export const confirmSafety = (http: () => request.Agent | ReturnType<typeof request>, featureId: string, version: string) =>
  (http() as ReturnType<typeof request>)
    .post(`/api/features/${featureId}/versions/${version}/safety/confirm`)
    .set(actor('usr-safety', 'SAFETY_OFFICER'))
    .send({ reason: '안전 분류 확정(HARA 검토)' })
    .expect(201);

// ── 긴급 차단 v2 (보고서 v1.1 FFG-PLT-005·DEAC-008) — 요청 1 + 서로 다른 2인 승인, 복원은 차단 승인자와 다른 2인 ──
export const KILL_REQUESTER = actor('usr-ops', 'OPERATOR');
export const KILL_APPROVERS = [actor('usr-safety', 'SAFETY_OFFICER'), actor('usr-opslead', 'OPS_LEAD')] as const;
export const RESTORE_APPROVERS = [actor('usr-safety2', 'SAFETY_OFFICER'), actor('usr-csm', 'SECURITY_OFFICER')] as const;
type Http = () => request.Agent | ReturnType<typeof request>;

/** 요청 → FSM 승인 → 운영 리더 승인(발행). F3 안전 사유의 봉쇄 근거를 기본으로 채운다 */
export async function killV2(http: Http, body: Record<string, unknown>, requester: Record<string, string> = KILL_REQUESTER) {
  const r = await http()
    .post('/api/kill-requests')
    .set(requester)
    .send({ reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', containmentJustification: '원인 분석 전 봉쇄', ...body })
    .expect(201);
  await http().post(`/api/kill-requests/${r.body.killId}/approvals`).set(KILL_APPROVERS[0]).send({}).expect(201);
  return (await http().post(`/api/kill-requests/${r.body.killId}/approvals`).set(KILL_APPROVERS[1]).send({}).expect(201)).body;
}

/** 복원 요청 → 다른 2인 승인(복구 게시) */
export async function restoreV2(http: Http, killId: string, reason = '복구', requester: Record<string, string> = KILL_REQUESTER) {
  await http().post(`/api/kill-requests/${killId}/restore`).set(requester).send({ reason }).expect(201);
  await http().post(`/api/kill-requests/${killId}/restore/approvals`).set(RESTORE_APPROVERS[0]).send({}).expect(201);
  return (await http().post(`/api/kill-requests/${killId}/restore/approvals`).set(RESTORE_APPROVERS[1]).send({}).expect(201)).body;
}

// ── Feature DB 기준 기능 연결(30-95 §6.2) — Feature 등록은 대표 기준 행이 필수다 ──
const FEATURE_DB = join(__dirname, '..', '..', 'data', 'reference', 'feature-db');
type RefJson = { refId: string; status: string; asilRep: string; requires: string[] };
let refPool: Map<string, string[]> | null = null;
const refCursor = new Map<string, number>();
/** 시험용 대표 기준 행 후보 — 활성·선행 없음·선행 대상 아님·시드 Feature가 쓰지 않는 행(같은 범위 중복 409·선행 경고가 나지 않게), ASIL별 */
function pool(): Map<string, string[]> {
  if (refPool) return refPool;
  const refs = JSON.parse(readFileSync(join(FEATURE_DB, 'v1.3', 'refs.json'), 'utf8')) as RefJson[];
  const seed = JSON.parse(readFileSync(join(FEATURE_DB, 'seed-links.json'), 'utf8')) as { links: Record<string, { refId: string }[]>; _missing?: Record<string, { candidates?: string[] }> };
  const used = new Set([...Object.values(seed.links).flat().map((l) => l.refId), ...Object.values(seed._missing ?? {}).flatMap((m) => m.candidates ?? [])]);
  // 다른 행의 선행 대상도 뺀다 — 선행 경고 시험이 그 행을 쓴다
  for (const r of refs) for (const q of r.requires) used.add(q);
  refPool = new Map();
  for (const r of refs) if (r.status === 'ACTIVE' && !r.requires.length && !used.has(r.refId)) refPool.set(r.asilRep, [...(refPool.get(r.asilRep) ?? []), r.refId]);
  return refPool;
}
/** 다음 시험용 기준 행 ID(같은 대표 ASIL) — 부를 때마다 다른 행이라 같은 범위에 여러 Feature를 만들어도 겹치지 않는다 */
export function nextRefId(asil = 'QM'): string {
  const ids = pool().get(asil) ?? [];
  const i = refCursor.get(asil) ?? 0;
  if (i >= ids.length) throw new Error(`시험용 기준 행(ASIL ${asil})이 모자랍니다`);
  refCursor.set(asil, i + 1);
  return ids[i];
}
/** Feature 등록 본문에 대표 기준 행을 붙인다 — 본문 ASIL과 같은 대표 ASIL 행이라 ASIL 사유가 필요 없다 */
export const withRef = <T extends { asil?: string }>(body: T, refId = nextRefId(body.asil ?? 'QM')) => ({ ...body, featureRefs: [{ refId, role: 'PRIMARY' as const }] });
