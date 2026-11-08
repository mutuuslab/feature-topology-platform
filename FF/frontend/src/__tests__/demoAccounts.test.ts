// 데모 계정(담당자 웨이브 2026-11-05) — contracts 역할 표의 계정마다 화면 이름·행위자 ID가 있고, 부서 계정은 역할 전환기에 있다
import { DEMO_PERSONAS } from '@ff/contracts';
import { describe, expect, it } from 'vitest';
import { actorFor } from '../api/actor';
import { DEMO_ACCOUNTS } from '../data/demoAccounts';
import { DEPARTMENTS } from '../data/departments';
import { permMatrix, roleLabel, roles } from '../data/refdata';
import { roleHome } from '../store';

describe('데모 계정 12', () => {
  it('역할 표(DEMO_PERSONAS)의 계정마다 이름·라벨·usr-<계정> ID가 있고, 역할 전환기 목록과 같다', () => {
    expect([...roles].sort()).toEqual(Object.keys(DEMO_PERSONAS).sort());
    for (const k of Object.keys(DEMO_PERSONAS)) {
      const a = DEMO_ACCOUNTS.find((x) => x.key === k);
      expect(a, k).toBeTruthy();
      expect(a!.id).toBe(`usr-${k}`);
      expect(roleLabel(k)).not.toBe(k);
      expect(permMatrix[k], k).toBeTruthy();
      expect(roleHome[k], k).toBeTruthy();
    }
  });

  it('새 계정 — 운영 리더·두 번째 FSM·고객 출시 승인자가 자기 ID로 그 역할을 쓴다', () => {
    expect(actorFor('opslead', ['OPS_LEAD'])).toEqual({ id: 'usr-opslead', role: 'OPS_LEAD' });
    expect(actorFor('safety2', ['SAFETY_OFFICER'])).toEqual({ id: 'usr-safety2', role: 'SAFETY_OFFICER' });
    expect(actorFor('productowner', ['PRODUCT_APPROVER'])).toEqual({ id: 'usr-productowner', role: 'PRODUCT_APPROVER' });
  });

  it('부서 계정은 모두 데모 계정이다 — 배포 및 모니터링 운영 리더, 표준 검토함 두 번째 FSM, 기획 스튜디오 상품 Owner', () => {
    for (const d of DEPARTMENTS.departments) for (const p of d.personas) expect(roles, `${d.id} ${p}`).toContain(p);
    const of = (id: string) => DEPARTMENTS.departments.find((d) => d.id === id)!.personas;
    expect(of('DEP-OPS')).toContain('opslead');
    expect(of('DEP-FS')).toContain('safety2');
    expect(of('DEP-PDP')).toContain('productowner');
  });
});
