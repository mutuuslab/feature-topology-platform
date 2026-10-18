import { describe, expect, it } from 'vitest';
import { COMPONENTS, DOMAINS, INTERFACES } from './components.manifest';
import { routeUrl, snapshotFile } from './routes';

describe('42 컴포넌트 manifest (PPT v0.50)', () => {
  it('정확히 42개이고 ID·이름이 중복되지 않는다', () => {
    expect(COMPONENTS).toHaveLength(42);
    expect(new Set(COMPONENTS.map((c) => c.id)).size).toBe(42);
    expect(new Set(COMPONENTS.map((c) => c.ko)).size).toBe(42);
  });

  it('도메인별 개수가 Module View와 일치한다 (10·3·4·6·7·12)', () => {
    const count = (d: string) => COMPONENTS.filter((c) => c.domain === d).length;
    expect([count('D01'), count('D02'), count('D03'), count('D04'), count('D05'), count('D06')]).toEqual([10, 3, 4, 6, 7, 12]);
    for (const c of COMPONENTS) expect(DOMAINS[c.domain]).toBeDefined();
  });

  it('참조하는 IF는 IF-01~IF-14 안에 있다', () => {
    for (const c of COMPONENTS) for (const i of c.ifs) expect(INTERFACES[i], `${c.id} → ${i}`).toBeDefined();
  });

  it('implemented 항목은 endpoints·screens·tests를 하나 이상 가진다', () => {
    for (const c of COMPONENTS.filter((x) => x.status === 'implemented')) {
      expect(c.endpoints.length, c.id).toBeGreaterThan(0);
      expect(c.screens.length, c.id).toBeGreaterThan(0);
      expect(c.tests.length, c.id).toBeGreaterThan(0);
    }
  });
});

describe('요청 URL·정적 스냅샷 파일 이름 (프론트·snapshot:api 공용 규칙)', () => {
  it('경로 매개변수를 인코딩하고 빈 질의는 뺀다 (키 순서 유지)', () => {
    expect(routeUrl('featureDetail', { id: 'FEAT-00022', ver: '1.0.0' })).toBe('/api/features/FEAT-00022/versions/1.0.0');
    expect(routeUrl('listFeatures', {}, { q: undefined, lifecycle: 'RELEASED', country: '', latestOnly: true })).toBe('/api/features?lifecycle=RELEASED&latestOnly=true');
    expect(() => routeUrl('featureDetail', { id: 'FEAT-00022' })).toThrow(/ver/);
  });
  it('파일 이름은 정적 호스팅에 안전한 문자만 쓴다 (%·@·공백·? 제거)', () => {
    const f = snapshotFile(routeUrl('audit', {}, { target: 'FEAT-00022@1.0.0', limit: 100 }));
    expect(f).toBe('api-snapshot/audit_target_FEAT-00022_401.0.0_limit_100.json');
    expect(snapshotFile(routeUrl('productCandidates', {}, { country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' }))).toMatch(/^api-snapshot\/[A-Za-z0-9._-]+\.json$/);
  });
});
