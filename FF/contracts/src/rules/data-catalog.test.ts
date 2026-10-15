// 데이터 카탈로그 — FFG-TEL-001 합격: 범주 표시가 없는 필드 0건, 범주 밖 접근 권한 0건
import { describe, expect, it } from 'vitest';
import { ROUTES } from '../routes';
import { StatusReportV2 } from '../schemas/wire';
import { canReadCategory, catalogFindings, DATA_CATEGORIES_13_1, DATA_CATEGORY_ACCESS, TELEMETRY_READS } from './data-catalog';
import { RETENTION_POLICIES } from './retention';

describe('목적별 데이터 범주와 접근 분리 (FFG-TEL-001)', () => {
  it('FFG-TEL-001 실제 ROUTES 감사 — 텔레메트리 읽기 경로는 범주 표시와 범주 역할만 갖는다(발견 0건)', () => {
    expect(catalogFindings(ROUTES)).toEqual([]);
    expect(TELEMETRY_READS.length).toBeGreaterThan(0);
  });

  it('FFG-TEL-001 범주 표시 — 저장소마다 13.1 범주와 보존 기간, 차량 보고는 data_category 필수', () => {
    for (const p of RETENTION_POLICIES) expect(DATA_CATEGORIES_13_1).toContain(p.category);
    expect(Object.keys(DATA_CATEGORY_ACCESS).sort()).toEqual([...DATA_CATEGORIES_13_1].sort());
    expect(StatusReportV2.shape.data_category.isOptional()).toBe(false);
  });

  it('FFG-TEL-001 범주 밖 권한을 넣으면 감사가 찾는다 — 보안 로그를 운영자에게, 범주 표시 없는 읽기 경로', () => {
    expect(canReadCategory('OPERATOR', 'SECURITY_MONITORING')).toBe(false);
    expect(canReadCategory('PRODUCT_AUTHOR', 'SAFETY_OPERATION')).toBe(false);
    const leaked = ROUTES.map((r) => (r.name === 'securityEvents' ? { ...r, roles: [...(r.roles ?? []), 'OPERATOR' as const] } : r));
    expect(catalogFindings(leaked)).toEqual(['securityEvents: OPERATOR는 SECURITY_MONITORING 범주 밖 역할입니다']);
    const unmarked = ROUTES.map((r) => (r.name === 'vehicleStatusView' ? { ...r, dataCategory: undefined, roles: undefined } : r));
    expect(catalogFindings(unmarked)).toEqual(['vehicleStatusView: 범주 표시 없음 ≠ SAFETY_OPERATION', 'vehicleStatusView: 읽기 역할이 없습니다(누구나 읽음)']);
  });
});
