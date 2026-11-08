import { describe, expect, it } from 'vitest';
import { systemBoard, typeDef } from '../screens/home/dashboard/catalog';

describe('업무에 맞는 시스템 대시보드', () => {
  it('운영 리더와 두 번째 안전 담당자도 자신의 운영·검토 업무로 시작한다', () => {
    expect(Object.values(systemBoard('opslead').gadgets).map((g) => g.type)).toContain('kills');
    expect(Object.values(systemBoard('safety2').gadgets).map((g) => g.type)).toContain('assigned');
  });
  it('고객 출시 승인과 시스템 관리의 처리 대기·감사 원천을 제공한다', () => {
    const owner = Object.values(systemBoard('productowner').gadgets);
    expect(owner.map((g) => g.type)).toContain('assigned');
    expect(owner.some((g) => g.type === 'filter' && g.config.source === 'features' && g.config.status === 'VERIFIED')).toBe(true);
    const admin = Object.values(systemBoard('sysadmin').gadgets).map((g) => g.type);
    expect(admin).toContain('activity');
    expect(admin).toContain('assigned');
  });
  it('할당됨 가젯의 새로고침은 업무·사후검토·기준변경·Lake 보조 큐도 다시 읽는다', () => {
    const apis = typeDef('assigned')!.apis({});
    for (const name of ['workQueues', 'killPostReviews', 'listRefChanges', 'lakeModels', 'featureHealth', 'canaryOverview', 'procedureInbox']) expect(apis).toContain(name);
    expect(new Set(apis).size).toBe(apis.length);
  });
});
