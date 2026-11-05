import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FeatureRepo } from '../../src/domains/d01-policy/repos';
import { PolicyRepo } from '../../src/domains/d01-policy/policy-repos';
import { ExtSyncService } from '../../src/domains/d05-ext/api-gateway/ext-sync/ext-sync.service';
import { demoChangeRequestContent, demoRequirementContent } from '../../src/domains/d05-ext/api-gateway/ext-sync/demo-seed-content';
import { bootApp } from '../helpers';

describe('모의 외부 도구의 요구·Epic·CR 상세 자료', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => { b = await bootApp({ at: '2026-11-05T00:00:00.000Z' }); });
  afterAll(() => b.app.close());

  it('실제 명세의 범위·구현·제어점과 시연 담당자 속성을 원문에 넣고 미정 위험·검증과 승인 근거를 구분한다', () => {
    const f = b.get(FeatureRepo).get('FEAT-00022', '1.0.0')!;
    const s = b.get(ExtSyncService);
    const t = s.featureTrace(f.featureId, f.version);
    const req = s.mockItems('CODEBEAMER').find((x) => x.key === t.requirements[0].key)!;
    expect(req.body).toContain(f.description!);
    for (const section of ['기능 정의', '동작 요구', '입력·출력', '수용 기준', '변경 시 재검토', 'FeatureFlag 시연용 요구 정의']) expect(req.body).toContain(section);
    for (const value of [f.country, f.vehicleModel, f.trim, f.version, ...f.controlPoints, ...f.swIds]) expect(req.body).toContain(value);
    for (const fn of f.functions) { expect(req.body).toContain(fn.functionId); expect(req.body).toContain(fn.label); }
    expect(req.body).not.toContain('[object Object]');
    expect(req.body).toContain('TTL 만료 시 safe-off');
    expect(req.body).toContain('실제 검증·승인 Evidence가 아닙니다');
    expect(req.fields).toMatchObject({ submittedBy: 'jung.req', assignedTo: 'jung.req', risk: '미정 — 별도 위험 평가 필요', asil: f.asil, requirementStatus: 'Approved', source: 'DEMO' });
    expect(req.fields.tracker).toContain('요구사항');
    expect(req.fields.release).toContain(f.version);
    expect(req.fields.verificationMethod).toContain('미정');
    expect(t.requirements[0].extra.description).toBe(req.body.slice(0, 2000));
    const epic = s.mockItems('JIRA').find((x) => x.key === t.epic!.key)!;
    expect(epic.fields).toMatchObject({ featureId: f.featureId, version: f.version, assignee: 'park.release', reporter: 'kim.author', scope: { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim } });
    expect(epic.body).toContain(`Feature Platform: ${f.featureId}@${f.version}`);
    expect(epic.body).toContain('플랫폼 Gate·역할·직무 분리');
    const cr = s.mockItems('JIRA', 'CHANGE_REQUEST').find((x) => x.fields.policyId === 'POL-00001')!;
    expect(cr.fields.parentKey).toBe(epic.key);
    expect(cr.fields.assignee).toBe('lee.approver');
    expect(cr.body).toContain(f.vehicleModel);
    expect(cr.body).toContain('care_00022_signal');
    expect(cr.body).toContain('Signal');
    expect(cr.body).toContain(epic.key);
  });

  it('부족한 명세에는 임계값·위험도·검증 성공·원래 변경 사유를 만들어 넣지 않는다', () => {
    const original = b.get(FeatureRepo).get('FEAT-00022', '1.0.0')!;
    const f = { ...original, description: null, swIds: [], swVersions: [], ecuPnos: [], functions: [], upgVc: [], controlPoints: [] };
    const req = demoRequirementContent(f, 'DEMO-REQ-EMPTY');
    expect(req.body).toContain('세부 설명 미정');
    expect(req.body).toContain('미정 — 구현 연결 전');
    expect(req.body).toContain('구체 시험 절차·정량 합격값·검증 방법은 미정');
    expect(req.body).not.toMatch(/\bLOW\b|검증 완료|99\.9|100ms/);
    const p = b.get(PolicyRepo).get('POL-00001')!;
    const cr = demoChangeRequestContent(p, undefined, null);
    expect(cr.body).toContain('미연결');
    expect(cr.body).toContain('Feature 연결 확인 필요');
    expect(cr.body).toContain('변경 전 값·외부 승인 사유가 없는 경우 미정');
  });

  it('첫 codeBeamer 댓글은 같은 본문 투영을 유지해 G2 stale 재검토를 만들지 않는다', async () => {
    const s = b.get(ExtSyncService);
    const before = s.featureTrace('FEAT-00001', '2.1.0');
    const req = before.requirements[0];
    const result = await s.mockAct('CODEBEAMER', { key: req.key, action: 'COMMENT', externalUser: 'jung.req', comment: '시연 요구 정의의 추적 검토 의견', deliver: true });
    expect(result.result).toMatchObject({ outcome: 'IGNORED' });
    const after = s.featureTrace('FEAT-00001', '2.1.0');
    expect(after.stale).toEqual(before.stale);
    expect(after.lifecycle).toBe(before.lifecycle);
    expect(after.requirements[0].extra.description).toBe(before.requirements[0].extra.description);
  });
});
