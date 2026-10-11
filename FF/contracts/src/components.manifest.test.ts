import { describe, expect, it } from 'vitest';
import { COMPONENTS, DOMAINS, INTERFACES } from './components.manifest';

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

  it('참조하는 IF는 IF-01~IF-13 안에 있다', () => {
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
