// 부서 인계 문구 조사(P1-12) — '품질팀로'가 아니라 받침을 보고 '으로/로'
import { describe, expect, it } from 'vitest';
import { departments as D, roParticle } from '../copy/departments';
import { DEPARTMENTS } from '../data/departments';

describe('조사 으로/로', () => {
  it('받침이 있으면 으로, 없거나 ㄹ 받침·한글이 아니면 로', () => {
    expect(D.home.to('품질팀')).toBe('품질팀으로');
    expect(D.home.to('관제실')).toBe('관제실로');
    expect(D.home.to('법무')).toBe('법무로');
    expect(roParticle('QA')).toBe('로');
  });

  it('14부서 이름 모두 맞는 조사 — 팀로가 없다', () => {
    for (const d of DEPARTMENTS.departments) expect(D.home.to(d.name)).not.toMatch(/팀로$/);
  });
});
