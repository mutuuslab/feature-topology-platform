// 보고서 v1.1 플랫폼 규칙 75개 → 기존 42 컴포넌트(components.manifest) 반영 위치와 작업 패키지.
// 보고서 설계는 새 모듈이 아니라 지금까지 만든 컴포넌트 안에 들어간다 — 규칙마다 "어느 컴포넌트가 집행하는가"를 여기서 정한다.
// 하네스(tools/standards.ts): 플랫폼 규칙은 모두 여기 있어야 하고, 컴포넌트 ID는 manifest에 실재해야 한다. 컴포넌트별 반영률은 /arch/components에 보인다.

export type WorkPackage = 'WP0' | 'WP1' | 'WP2' | 'WP3' | 'WP4' | 'WP5' | 'WP6' | 'WP7' | 'WP8' | 'WP9' | 'WP10';

export interface RulePlacement {
  /** 집행 컴포넌트 — 첫 항목이 주 담당 */
  components: readonly string[];
  wp: WorkPackage;
}

export const STANDARDS_MAP: Readonly<Record<string, RulePlacement>> = {
  // 분류·Registry (보고서 5장)
  'FFG-ADS-002': { components: ['D01-01'], wp: 'WP1' },
  'FFG-CLS-001': { components: ['D01-01', 'D01-02'], wp: 'WP1' },
  'FFG-CLS-002': { components: ['D01-01', 'D06-07'], wp: 'WP2' },
  'FFG-CLS-004': { components: ['D01-01'], wp: 'WP1' },
  'FFG-CLS-006': { components: ['D01-01', 'D06-01', 'D01-08', 'D01-07'], wp: 'WP1' }, // D01-07 실험 관리(P10)도 F2 이상 A/B를 막는다
  'FFG-CLS-007': { components: ['D01-05', 'D03-04'], wp: 'WP6' },
  'FFG-CLS-009': { components: ['D01-01', 'D03-02'], wp: 'WP1' },
  'FFG-CODE-020': { components: ['D01-06', 'D01-01'], wp: 'WP1' },
  'FFG-CODE-030': { components: ['D04-01'], wp: 'WP8' },

  // 정책 게이트·주문 원장 (8장, 부록 D)
  'FFG-PLT-001': { components: ['D03-02', 'D04-03'], wp: 'WP3' },
  'FFG-PLT-002': { components: ['D03-02', 'D01-01'], wp: 'WP3' },
  'FFG-PLT-003': { components: ['D03-02', 'D03-03'], wp: 'WP3' },
  'FFG-PLT-004': { components: ['D03-02', 'D03-03'], wp: 'WP3' },
  'FFG-PLT-005': { components: ['D03-02', 'D03-03', 'D03-04'], wp: 'WP3' },
  'FFG-PLT-006': { components: ['D03-02', 'D01-05'], wp: 'WP3' },
  'FFG-PLT-007': { components: ['D03-02'], wp: 'WP3' },
  'FFG-PLT-008': { components: ['D03-02', 'D01-08'], wp: 'WP3' },
  'FFG-PLT-009': { components: ['D03-02', 'D03-01'], wp: 'WP3' },
  'FFG-PLT-010': { components: ['D03-02', 'D04-01'], wp: 'WP3' },
  'FFG-PLT-014': { components: ['D01-06', 'D06-01'], wp: 'WP9' }, // 정책 생성 결정성 Golden — 도구 신뢰성(TCL, PLT-013)과 함께
  'FFG-PLT-017': { components: ['D03-02'], wp: 'WP3' },
  'FFG-SEC-003': { components: ['D03-02', 'D06-10'], wp: 'WP3' },
  'FFG-ADS-010': { components: ['D03-02', 'D03-04'], wp: 'WP3' },

  // Kill·복원 v2 (7·8장)
  'FFG-DEAC-008': { components: ['D03-04'], wp: 'WP4' },
  'FFG-DEAC-010': { components: ['D03-03', 'D04-06'], wp: 'WP4' },
  'FFG-DEAC-011': { components: ['D03-03', 'D01-10'], wp: 'WP4' },
  'FFG-SEC-008': { components: ['D03-03', 'D06-09'], wp: 'WP4' },
  'FFG-VEH-002': { components: ['D06-10', 'D06-08'], wp: 'WP4' },
  'FFG-VEH-013': { components: ['D06-10', 'D02-03'], wp: 'WP4' },
  'FFG-ADS-004': { components: ['D03-04', 'D02-03'], wp: 'WP4' },

  // 차량 연결 v2 (9·13장)
  'FFG-PLT-012': { components: ['D06-08', 'D04-03'], wp: 'WP5' },
  'FFG-TEL-003': { components: ['D04-03', 'D02-03'], wp: 'WP5' }, // 차량 발신 채널(vehicle-requests, c943ea0)의 부팅·순번 대사 위에 쌓는다
  'FFG-DEAC-007': { components: ['D02-03', 'D03-04'], wp: 'WP5' },
  'FFG-DEAC-013': { components: ['D06-12', 'D04-03'], wp: 'WP5' },
  'FFG-SEC-004': { components: ['D03-03', 'D04-03'], wp: 'WP5' },
  'FFG-VEH-006': { components: ['D02-02'], wp: 'WP5' },
  'FFG-VEH-007': { components: ['D02-03', 'D04-03'], wp: 'WP5' },

  // Gate 결정 기록·재-HARA·Retirement (6장)
  'FFG-LCY-001': { components: ['D01-02'], wp: 'WP2' },
  'FFG-LCY-002': { components: ['D01-02'], wp: 'WP2' },
  'FFG-LCY-003': { components: ['D06-05', 'D01-02'], wp: 'WP2' },
  'FFG-LCY-009': { components: ['D01-08', 'D04-01', 'D01-02'], wp: 'WP2' },

  // 시장 Compliance·체험권·리콜 (2·7장)
  'FFG-GEN-001': { components: ['D03-01'], wp: 'WP6' },
  'FFG-GEN-003': { components: ['D03-01', 'D03-02'], wp: 'WP6' },
  'FFG-LCY-008': { components: ['D06-08', 'D01-10'], wp: 'WP6' },
  'FFG-LCY-010': { components: ['D01-05', 'D01-09'], wp: 'WP6' },
  'FFG-DEAC-004': { components: ['D01-05', 'D03-03'], wp: 'WP6' },

  // OpenFeature 경계 (11장)
  'FFG-OFT-001': { components: ['D05-01'], wp: 'WP7' },
  'FFG-OFT-002': { components: ['D05-01'], wp: 'WP7' },
  'FFG-OFT-003': { components: ['D05-01', 'D01-04'], wp: 'WP7' },
  'FFG-OFT-004': { components: ['D05-01', 'D01-10'], wp: 'WP7' },
  'FFG-OFT-005': { components: ['D05-01', 'D01-06'], wp: 'WP7' },
  'FFG-OFT-006': { components: ['D05-01'], wp: 'WP7' },
  'FFG-OFT-007': { components: ['D05-01'], wp: 'WP7' },
  'FFG-PLT-011': { components: ['D05-01'], wp: 'WP7' },

  // SBOM·공급망 (15장)
  'FFG-SBOM-002': { components: ['D04-01'], wp: 'WP8' },
  'FFG-SBOM-003': { components: ['D06-08'], wp: 'WP8' },
  'FFG-SBOM-007': { components: ['D06-11'], wp: 'WP8' },
  'FFG-SEC-006': { components: ['D06-11'], wp: 'WP8' },

  // 가상검증·도구 신뢰성 (12장)
  'FFG-PLT-013': { components: ['D06-03', 'D04-02'], wp: 'WP9' },
  'FFG-TST-003': { components: ['D06-03'], wp: 'WP9' },
  'FFG-TST-009': { components: ['D06-04', 'D06-03'], wp: 'WP9' },

  // 신뢰 기반 (WP0 완료분)
  'FFG-PLT-015': { components: ['D01-10', 'D06-04', 'D04-04'], wp: 'WP0' },
  'FFG-PLT-016': { components: ['D06-09'], wp: 'WP0' },
  'FFG-SEC-002': { components: ['D06-10', 'D06-08'], wp: 'WP0' },

  // 운영 감시·데이터·보존 (13·14장)
  'FFG-ADS-007': { components: ['D01-10', 'D04-04'], wp: 'WP10' },
  'FFG-SEC-007': { components: ['D06-12'], wp: 'WP10' },
  'FFG-SOT-002': { components: ['D01-06'], wp: 'WP10' },
  'FFG-SOT-003': { components: ['D04-06', 'D06-12', 'D04-05'], wp: 'WP10' },
  'FFG-TEL-001': { components: ['D04-03', 'D06-09'], wp: 'WP10' },
  'FFG-TEL-004': { components: ['D04-04', 'D04-03'], wp: 'WP10' },
  'FFG-TEL-005': { components: ['D04-03', 'D05-02'], wp: 'WP10' },
  'FFG-TEL-006': { components: ['D05-01'], wp: 'WP10' },
  'FFG-TEL-008': { components: ['D04-03', 'D01-10'], wp: 'WP10' },
  'FFG-TEL-009': { components: ['D04-03', 'D05-06'], wp: 'WP10' },
  'FFG-TEL-010': { components: ['D04-03', 'D02-03'], wp: 'WP10' },
};

/** 컴포넌트가 집행하는 규칙 ID (주·보조 담당 모두) */
export function rulesOfComponent(componentId: string): string[] {
  return Object.entries(STANDARDS_MAP)
    .filter(([, p]) => p.components.includes(componentId))
    .map(([id]) => id)
    .sort();
}
