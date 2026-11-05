import { describe, expect, it } from 'vitest';
import { COMPONENTS, DOMAINS, INTERFACES } from './components.manifest';
import { routeUrl, SNAPSHOT_NAME_MAX, snapshotFile } from './routes';

describe('컴포넌트 manifest (PPT v0.50 42개 + D07-01 SW 개발비 산정)', () => {
  it('정확히 43개(PPT 42 + D07-01)이고 ID·이름이 중복되지 않는다', () => {
    expect(COMPONENTS).toHaveLength(43);
    expect(COMPONENTS.filter((c) => c.domain !== 'D07')).toHaveLength(42);
    expect(new Set(COMPONENTS.map((c) => c.id)).size).toBe(43);
    expect(new Set(COMPONENTS.map((c) => c.ko)).size).toBe(43);
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

  it('D01-01은 Feature DB(30-95) 화면·시험·API를 담는다 — 회귀: 목록·상세·변경 요청 화면과 refdb 시험이 manifest 밖에 있었다', () => {
    const c = COMPONENTS.find((x) => x.id === 'D01-01')!;
    for (const s of ['/master/feature-db', '/master/feature-db/:refId', '/master/feature-db/changes', '/master/feature-db/changes/:id']) expect(c.screens).toContain(s);
    for (const t of ['backend/test/d01/refdb-read.spec.ts', 'contracts/src/schemas/refdb.test.ts', 'frontend/src/__tests__/screensRefdb.test.tsx', 'frontend/src/__tests__/screensPropose.test.tsx', 'e2e/tests/refdb.spec.ts']) expect(c.tests).toContain(t);
    expect(c.endpoints).toContain('GET /api/refdb/refs');
    expect(c.endpoints).toContain('POST /api/refdb/sources/reviews'); // 출처 정기 점검 기록 — ROUTES component D01-01이면 자동
    for (const t of ['backend/test/kernel/refdb-ready.spec.ts', 'contracts/src/rules/access-refdb.test.ts', 'backend/test/d05/epic-ref-ids.spec.ts', 'backend/test/d01/refdb-governance.spec.ts']) expect(c.tests).toContain(t);
    for (const x of COMPONENTS) expect(new Set(x.tests).size, `${x.id} 시험 중복`).toBe(x.tests.length);
  });
});

describe('요청 URL·정적 스냅샷 파일 이름 (프론트·snapshot:api 공용 규칙)', () => {
  it('경로 매개변수를 인코딩하고 빈 질의는 뺀다 (키 순서 유지)', () => {
    expect(routeUrl('featureDetail', { id: 'FEAT-00022', ver: '1.0.0' })).toBe('/api/features/FEAT-00022/versions/1.0.0');
    expect(routeUrl('listFeatures', {}, { q: undefined, lifecycle: 'RELEASED', country: '', latestOnly: true })).toBe('/api/features?lifecycle=RELEASED&latestOnly=true');
    expect(() => routeUrl('featureDetail', { id: 'FEAT-00022' })).toThrow(/ver/);
  });
  it('필수 질의(requiredQuery)가 비면 URL을 만들지 않는다 — flagKey 없는 활성화 판단 요청(정적 데모 스냅샷 누락) 방지', () => {
    expect(routeUrl('activationDecide', {}, { vin: 'ego-01', flagKey: 'care_00022_param' })).toBe('/api/activation/decide?vin=ego-01&flagKey=care_00022_param');
    expect(() => routeUrl('activationDecide', {}, { vin: 'ego-01', flagKey: '' })).toThrow(/flagKey/);
    expect(() => routeUrl('activationDecide', {}, { flagKey: 'x' })).toThrow(/vin/);
  });
  it('파일 이름은 정적 호스팅에 안전한 문자만 쓴다 (%·@·공백·? 제거)', () => {
    const f = snapshotFile(routeUrl('audit', {}, { target: 'FEAT-00022@1.0.0', limit: 100 }));
    expect(f).toBe('api-snapshot/audit_target_FEAT-00022_401.0.0_limit_100.json');
    expect(snapshotFile(routeUrl('productCandidates', {}, { country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' }))).toMatch(/^api-snapshot\/[A-Za-z0-9._-]+\.json$/);
  });
  it('긴 질의는 앞부분 + URL 해시로 줄인다 — 앞부분이 같아도 다른 URL은 다른 파일', () => {
    // 회귀: Feature DB 목록 조회(도메인·컴포넌트 이름 질의)의 파일 이름이 181자라 데스크톱 설치 파일(NSIS)이 경로 길이로 실패했다(2026-11-04)
    const long = (component: string) => routeUrl('listRefs', {}, { domain: 'Vehicle Platform & Base SW', component, cluster: 'AUTOSAR Classic Platform (R24-11) ECU basic software stack' });
    const a = snapshotFile(long('AUTOSAR Classic Platform (R24-11) ECU basic software stack — communication services'));
    const b = snapshotFile(long('AUTOSAR Classic Platform (R24-11) ECU basic software stack — diagnostic services'));
    for (const f of [a, b]) expect(f).toMatch(/^api-snapshot\/[A-Za-z0-9._~-]+\.json$/);
    expect(a.length - 'api-snapshot/'.length - '.json'.length).toBeLessThanOrEqual(SNAPSHOT_NAME_MAX);
    expect(a).not.toBe(b);
    expect(snapshotFile(long('x'))).toBe(snapshotFile(long('x')));
    // 짧은 이름은 그대로(기존 스냅샷 이름 유지)
    expect(snapshotFile('/api/features')).toBe('api-snapshot/features.json');
  });
});
