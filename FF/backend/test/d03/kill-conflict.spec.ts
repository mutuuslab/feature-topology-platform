// 회귀: 5년 운영 재생에서 발견 — 체험이 끝난 차량 한 대의 상업 비활성화(COMMERCIAL)가 있으면 같은 기능의 차량 전체 안전 Kill이
// '이미 차단 중'(409)으로 거부됐다. 이제 진행 중 차단은 대상 차량이 겹칠 때만 막고, 상업 비활성화는 긴급 차단을 막지 않는다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp, KILL_REQUESTER } from '../helpers';

const OPERATOR2 = actor('kang.ops', 'OPERATOR');
const body = (over: Record<string, unknown> = {}) => ({ featureId: 'FEAT-00022', featureVersion: '1.0.0', confirm: 'FEAT-00022', reason: '현장 결함 봉쇄', reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', containmentJustification: '원인 분석 전 봉쇄', ...over });

describe('진행 중 차단과 새 차단 요청 (D03-03)', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' }));
  });
  afterAll(async () => {
    await app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE']) delete process.env[k];
  });

  it('차량 한 대의 상업 비활성화가 대기 중이어도 기능 전체 안전 Kill은 받는다', async () => {
    const c = await http().post('/api/kill-requests').set(KILL_REQUESTER).send(body({ vins: ['ego-01'], reasonCategory: 'COMMERCIAL', reasonCode: 'TRIAL_EXPIRED', reason: '체험 만료', containmentJustification: undefined })).expect(201);
    expect(c.body.reasonCategory).toBe('COMMERCIAL');
    const s = await http().post('/api/kill-requests').set(OPERATOR2).send(body()).expect(201);
    expect(s.body.vins).toContain('ego-01');
  });

  it('겹치는 차량의 같은 종류 차단은 여전히 409 — 중복 안전 Kill, 같은 차량 상업 비활성화 중복', async () => {
    const dup = await http().post('/api/kill-requests').set(KILL_REQUESTER).send(body({ vins: ['KMH-NX4-0001'] })).expect(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    await http().post('/api/kill-requests').set(KILL_REQUESTER).send(body({ vins: ['ego-01'], reasonCategory: 'COMMERCIAL', reasonCode: 'TRIAL_EXPIRED', reason: '체험 만료', containmentJustification: undefined })).expect(409);
  });
});
