// 법규 담당자의 실행 업무는 형식승인 영향 판단이다. Gate 판정 권한을 추가하지 않고 실제 분석 기록으로 대기열을 닫는다.
import { describe, expect, it } from 'vitest';
import { actor, bootApp, withRef } from '../helpers';

describe('형식승인 영향 판단 대기열', () => {
  it('분석 전 최신 Version만 대기하며, 법규 담당자가 서명하면 빠지고 Gate 판정 권한은 늘지 않는다', async () => {
    const b = await bootApp({ at: '2026-11-05T01:00:00.000Z' });
    try {
      const http = b.http;
      const f = (await http().post('/api/features').set(actor('usr-author', 'FEATURE_AUTHOR')).send(withRef({
        name: '형식승인 영향 대기열 시험', description: '법규 담당자 업무 연결', requirementIds: ['REQ-HOM-01'],
        country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS기획팀', asil: 'QM', controlPoints: ['Flag'],
      })).expect(201)).body;
      const before = (await http().get('/api/work-queues').expect(200)).body;
      expect(before.homologations).toEqual(expect.arrayContaining([expect.objectContaining({ featureId: f.featureId, version: f.version })]));
      expect(before.homologations.every((x: any) => !['RELEASED', 'DEPRECATED', 'RETIRED'].includes(x.lifecycle))).toBe(true);
      const base = `/api/features/${f.featureId}/versions/${f.version}`;
      await http().post(`${base}/analysis/homologation`).set(actor('usr-steward', 'REGULATORY_OWNER'))
        .send({ regulations: [], decision: 'NO_IMPACT', rxswin: [], reason: '형식승인 영향 확인 완료' }).expect(201);
      const after = (await http().get('/api/work-queues').expect(200)).body;
      expect(after.homologations.some((x: any) => x.featureId === f.featureId)).toBe(false);
      await http().post(`${base}/gates`).set(actor('usr-steward', 'REGULATORY_OWNER'))
        .send({ gate: 'G1', inputResult: 'PASS', rationale: '권한을 추가하지 않는다', evidenceRef: 'EV-HOM-01' }).expect(403);
    } finally {
      await b.app.close();
    }
  });
});
