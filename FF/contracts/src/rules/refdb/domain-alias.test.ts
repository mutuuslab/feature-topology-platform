// 공식 도메인과 ECU.domain 대응표(30-95 §4, D-REF-9)
import { describe, expect, it } from 'vitest';
import { loadDataset } from '../../testing/fixtures';
import { domainAbbrOf, domainOfAbbr, OFFICIAL_DOMAIN_NAMES, officialDomainOf, unmappedEcuDomains } from './domain-alias';

describe('공식 도메인·ECU.domain 대응', () => {
  it('엑셀 B열 도메인 10개, 약어는 서로 다르다', () => {
    expect(OFFICIAL_DOMAIN_NAMES).toHaveLength(10);
    expect(domainAbbrOf('Chassis & Vehicle Dynamics')).toBe('CH');
    expect(domainOfAbbr('PL')).toBe('Vehicle Platform & Base SW');
    expect(new Set(OFFICIAL_DOMAIN_NAMES.map(domainAbbrOf)).size).toBe(10);
  });

  it('설계 예시 — Body → Body & Comfort, ADAS → ADAS & AD, 대소문자·공백은 가리지 않는다', () => {
    expect(officialDomainOf('Body')).toBe('Body & Comfort');
    expect(officialDomainOf('ADAS')).toBe('ADAS & AD');
    expect(officialDomainOf('  adas   DC ')).toBe('ADAS & AD');
    expect(officialDomainOf('Safety')).toBe('Safety');
    expect(officialDomainOf('infotainment & hmi')).toBe('Infotainment & HMI');
    expect(officialDomainOf('Toaster')).toBeNull();
    expect(officialDomainOf('')).toBeNull();
  });

  it('DATASET v0.81 ECU.domain은 모두 공식 도메인으로 대응된다(data:check 경고 0)', () => {
    const ecu = loadDataset().ecuMaster.map((e) => e.domain);
    expect(ecu.length).toBeGreaterThan(0);
    expect(unmappedEcuDomains(ecu)).toEqual([]);
    expect(unmappedEcuDomains(['Body', 'Toaster', 'Toaster', null])).toEqual(['Toaster']);
  });
});
