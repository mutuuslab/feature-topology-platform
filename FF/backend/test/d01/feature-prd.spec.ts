import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp, withRef } from '../helpers';

describe('Feature 문서 본문 기존 계약의 실제 저장·조회', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({ app, http } = await bootApp()));
  afterAll(() => app.close());
  const author = actor('prd.author', 'FEATURE_AUTHOR');
  const draft = (name: string, description: string) => withRef({ name, description, country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS기획팀', asil: 'B', requirementIds: ['REQ-PRD-9001'], controlPoints: ['Flag'] });

  it('2000자 다중행 문서를 PROPOSED0.1.0으로 저장하고 상세API가 원문을 그대로 돌려준다', async () => {
    const prefix = '[배경과 문제]\n직접 작성한 기능 문서\n[기대 동작]\n';
    const description = prefix + '가'.repeat(1999 - prefix.length) + '끝';
    expect(description).toHaveLength(2000);
    const created = await http().post('/api/features').set(author).send(draft('PRD 본문 왕복 검증', description)).expect(201);
    expect(created.body).toMatchObject({ version: '0.1.0', lifecycle: 'PROPOSED', baselineId: null });
    const detail = await http().get(`/api/features/${created.body.featureId}/versions/0.1.0`).expect(200);
    expect(detail.body.feature.description).toBe(description);
    expect(detail.body.feature.ownerId).toBe('ADAS기획팀');
    expect(detail.body.feature.featureRefs.filter((ref: { role: string }) => ref.role === 'PRIMARY')).toHaveLength(1);
  });

  it('2001자 문서는400으로 거부하며 저장되는 척하거나 잘라 저장하지 않는다', async () => {
    const name = 'PRD 한도 초과 거부 검증';
    const rejected = await http().post('/api/features').set(author).send(draft(name, '가'.repeat(2001))).expect(400);
    expect(rejected.body.error.details.some((field: { path: string }) => field.path === 'description')).toBe(true);
    const list = await http().get('/api/features').query({ q: name }).expect(200);
    expect(list.body.items.some((feature: { name: string }) => feature.name === name)).toBe(false);
  });
});
