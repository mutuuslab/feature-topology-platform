// Feature DB 권한·조회 경로 불변식(30-95 §8.1) — 변경 요청 작성 역할, 역할로 응답이 달라지는 조회는 계정 단위(personal), 출처 점검 기록 역할.
import { describe, expect, it } from 'vitest';
import { REFDB_CHANGE_REQUESTERS, ROUTES } from '../routes';
import { HUMAN_ROLES, SOD_RULES } from './access';

const route = (name: string) => ROUTES.find((r) => r.name === name)!;

describe('Feature DB 권한·조회 경로', () => {
  it('변경 요청 작성은 감사 조회자를 뺀 사람 역할 모두 — 차량·시스템 신원은 못 쓴다', () => {
    expect([...REFDB_CHANGE_REQUESTERS].sort()).toEqual(HUMAN_ROLES.filter((r) => r !== 'AUDITOR').sort());
    for (const r of ['SAFETY_OFFICER', 'GATE_JUDGE', 'OPERATOR', 'RELEASE_MANAGER'] as const) expect(REFDB_CHANGE_REQUESTERS).toContain(r);
    for (const r of ['AUDITOR', 'VEHICLE', 'SYSTEM'] as const) expect(REFDB_CHANGE_REQUESTERS).not.toContain(r);
    expect(route('createRefChange').roles).toBe(REFDB_CHANGE_REQUESTERS);
  });

  it('역할로 응답이 달라지는 GET(금액 필드는 산정 역할만)은 계정 단위 조회다 — 행위자 머리글을 붙이고 역할로 캐시한다', () => {
    // 신호가 따로 없으므로 목록을 적고, 요약에 '산정 역할만'을 쓰는 새 GET도 함께 잡는다
    const roleScoped = ['listRefs', 'refDetail', 'listRefChanges', 'refChangeDetail', 'exportRefdb'];
    const bySummary = ROUTES.filter((r) => r.method === 'GET' && r.summary.includes('산정 역할만')).map((r) => r.name);
    for (const name of new Set([...roleScoped, ...bySummary])) {
      const r = route(name);
      expect(r, name).toBeDefined();
      expect(r.method).toBe('GET');
      expect(r.personal, `${name}: 행위자 머리글 없이 열면 관리자도 금액 필드를 못 보고, 역할이 바뀌어도 캐시가 그대로다`).toBe(true);
    }
  });

  it('출처 정기 점검 기록은 Feature DB 관리자만 — 본문 스키마가 있다', () => {
    const r = route('recordSourceReview');
    expect(r).toMatchObject({ method: 'POST', path: '/api/refdb/sources/reviews', roles: ['REFDB_ADMIN'], component: 'D01-01' });
    expect(r.body).toBeDefined();
  });

  it('검토자 ≠ 승인자(SOD-15)가 직무 분리 표에 있다 — Feature DB 규칙은 13·14·15', () => {
    expect(SOD_RULES.filter((r) => r.component === 'D01-01' && /Feature DB/.test(r.subject)).map((r) => r.id)).toEqual(['SOD-13', 'SOD-14', 'SOD-15']);
  });
});
