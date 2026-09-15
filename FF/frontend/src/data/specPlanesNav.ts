// 4 Plane 업무 배치 — FP Architecture Design v4.5 / FP-DETAILED-1.1.
//
// Plane(Core 귀속 축)과 MENU 1.3의 7 업무 그룹(업무 IA 축)은 같은 화면 위에 겹치는 서로 다른 두 축이다.
// 이 파일은 그중 Plane 축을 네비게이션 모드(Plane별)로 보여주기 위해 화면마다 대표 Plane 하나를 배정한다.
//
// 원칙
//  1. 화면 → Plane 배정은 이 파일이 정하지 않는다. 기준 정본(specPlanesGen.ts, planeAssignment)이 정한다.
//     화면의 대표 Plane은 그 화면이 소유한 Core의 Plane이며, 상세 영역도 소유 Core의 Plane을 따른다.
//  2. Plane 이름·produces·contract는 specArch.SPEC_PLANES를 원천으로 삼는다(여기서 값을 새로 만들지 않는다).
//     값이 어긋나면 src/__tests__/specData.test.ts 의 Plane 정합 테스트가 실패한다.
//  3. Knowledge Foundation은 4 Plane에 포함되지 않는다(공유 기반이며 다섯 번째 Plane이 아님).
//     따라서 공유 기반 레일은 기준 화면을 소유하지 않는다.
//  4. 구현 데모 화면(경로)의 배치는 기준 데이터가 아니라 앱 쪽 대응 관계다. 갈래 이름만 업무 관점으로 적는다.

import { SPEC_MENU, SPEC_MENU_GROUP_OF_SCREEN } from './specMenu';
import {
  SPEC_KNOWLEDGE_FOUNDATION,
  SPEC_PLANE_CORES,
  SPEC_PLANE_FLOW,
  SPEC_PLANE_RULE,
  SPEC_PLANE_SCREEN_IDS,
  SPEC_SCREEN_PLANE,
  SPEC_SCREEN_PLANE_CORE,
} from './specPlanesGen';

export {
  SPEC_KNOWLEDGE_FOUNDATION,
  SPEC_PLANE_CORES,
  SPEC_PLANE_FLOW,
  SPEC_PLANE_RULE,
  SPEC_SCREEN_PLANE,
  SPEC_SCREEN_PLANE_CORE,
};

/** 기준 Plane 이름 → 앱 내부 Plane ID */
const PLANE_ID: Record<string, string> = {
  Control: 'control',
  Quality: 'quality',
  'Governance+Monitoring': 'governance',
  Vehicle: 'vehicle',
};

export interface SpecPlaneNavScreenGroup {
  ko: string;
  en: string;
  /** 기준 화면 ID (UI01~UI30) — MENU 1.3 업무 그룹 단위로 묶는다. */
  screens: string[];
}

export interface SpecPlaneNavDemoGroup {
  ko: string;
  en: string;
  /** 구현 데모 화면 경로. */
  routes: string[];
}

export interface SpecPlaneNav {
  id: string;
  ko: string;
  en: string;
  /** 레일(64px)에 들어가는 짧은 라벨 */
  shortKo: string;
  shortEn: string;
  icon: string;
  /** SPEC_PLANES[].name 과 일치해야 한다(정합 테스트로 검증). */
  name: string;
  /** SPEC_PLANES[].produces 와 일치해야 한다. */
  produces: string;
  /** SPEC_PLANES[].contract 와 일치해야 한다. */
  contract: string;
  /** 실행 책임 한 줄 — 검증/허가/발행/평가 중 이 Plane이 맡는 구간. */
  note: string;
  /** 이 Plane이 소유한 Core ID (specPlanesGen.SPEC_PLANE_CORES). */
  coreIds: string[];
  /** 이 Plane에 배정된 기준 화면 ID (specPlanesGen.SPEC_PLANE_SCREEN_IDS). */
  screens: string[];
  screenGroups: SpecPlaneNavScreenGroup[];
  demos: SpecPlaneNavDemoGroup[];
  /** 4 Plane에 속하지 않는 공유 기반(Knowledge Foundation). */
  shared?: boolean;
}

/** Plane에 배정된 기준 화면을 MENU 1.3 업무 그룹 순서로 묶는다(손으로 적지 않는다). */
function screenGroupsOf(planeName: string): SpecPlaneNavScreenGroup[] {
  const ids = SPEC_PLANE_SCREEN_IDS[planeName] ?? [];
  return SPEC_MENU.map((g) => ({
    ko: g.ko,
    en: g.en,
    screens: g.items.map((it) => it.id).filter((id) => ids.includes(id)),
  })).filter((g) => g.screens.length > 0);
}

type PlaneDef = Omit<SpecPlaneNav, 'screens' | 'screenGroups' | 'coreIds'>;

const DEFS: PlaneDef[] = [
  {
    id: PLANE_ID.Control,
    ko: '통제',
    en: 'Control',
    shortKo: '통제',
    shortEn: 'Control',
    icon: '🎛',
    name: 'Control',
    produces: 'Feature BOM Topology Catalog Policy Publication',
    contract: 'Quality 확인과 G+M 허가 후 정책 발행',
    note: 'Quality 결과와 G+M 허가를 받은 뒤 Feature·BOM·정책을 발행한다. 스스로 허가하지 않는다.',
    demos: [
      {
        ko: '기준정보 · 구성',
        en: 'Master Data & Configuration',
        routes: [
          '/catalog',
          '/master/define',
          '/master/taxonomy',
          '/master/taxonomy/edit',
          '/master/bom',
          '/master/bom/items',
          '/master/artifacts',
          '/master/control-points',
          '/feature/FEAT-BDC-001',
          '/variants/FEAT-BDC-001',
          '/metamodel',
        ],
      },
      {
        ko: '변경요청 · Revision',
        en: 'Change Request & Revision',
        routes: [
          '/lifecycle',
          '/change/cr',
          '/cr-wizard',
          '/change/changeset',
          '/change/baseline',
          '/change/timeline',
        ],
      },
      {
        ko: 'Topology · 변경 영향',
        en: 'Topology & Impact',
        routes: [
          '/arch/topology',
          '/topology/FEAT-BDC-001',
          '/topology/edge',
          '/impact',
          '/consistency',
          '/consistency/violation',
        ],
      },
    ],
  },
  {
    id: PLANE_ID.Quality,
    ko: '품질',
    en: 'Quality',
    shortKo: '품질',
    shortEn: 'Quality',
    icon: '🔬',
    name: 'Quality',
    produces: 'Assessment TestSelection Evidence BaselineAttestation',
    contract: '기술 적합성 결과를 제공하며 최종 운영 허가와 구분',
    note: '기술 적합성만 판정한다. 최종 운영 허가는 G+M 소관이라 여기서 발행하지 않는다.',
    demos: [
      {
        ko: '검증 · 증적',
        en: 'Verification & Evidence',
        routes: ['/verify/evidence', '/verify/compliance', '/verify/scenario', '/verify/experiment', '/decisions/verification'],
      },
      {
        ko: '배포 파이프라인',
        en: 'Delivery Pipeline',
        routes: ['/release/cicd'],
      },
    ],
  },
  {
    id: PLANE_ID['Governance+Monitoring'],
    ko: '거버넌스 · 모니터링',
    en: 'Governance + Monitoring',
    shortKo: '거버넌스',
    shortEn: 'G+M',
    icon: '🛡',
    name: 'Governance+Monitoring',
    produces: 'RoleScopePolicy Authorization Incident Observation',
    contract: '명령 허가·관측·대응과 변경 제안',
    note: '명령을 허가하고 관측·대응한다. 발행 자체는 Control이 수행하고, 여기서는 변경을 제안한다.',
    demos: [
      { ko: '내 업무 · 홈', en: 'My Work & Home', routes: ['/', '/home/customize', '/login', '/onboarding'] },
      {
        ko: '검토 · 승인',
        en: 'Review & Authorization',
        routes: ['/admin/approval', '/decisions/center', '/decisions/deploy'],
      },
      {
        ko: '배포 · 운영',
        en: 'Deploy & Ops',
        routes: ['/readiness/FEAT-BDC-001', '/ops/campaign', '/ops/policy', '/ops/runtime', '/ops/FEAT-BDC-001', '/ops/telemetry', '/fleet', '/activation'],
      },
      {
        ko: '정책 · 운영 기준',
        en: 'Policy & Ops Baseline',
        routes: ['/insights/reports', '/admin/settings', '/policy/exception', '/policy/conflict'],
      },
      {
        ko: '연계 · 과금',
        en: 'Integration & Billing',
        routes: ['/integration/connectors', '/integration/sync', '/commerce/billing'],
      },
      {
        ko: '분석 · 감사',
        en: 'Insights & Audit',
        routes: ['/insights/audit', '/insights/business', '/cost', '/admin/notifications'],
      },
      {
        ko: '관리자 · 보안',
        en: 'Admin & Security',
        routes: ['/admin/users', '/admin/permissions', '/admin/org', '/admin/security'],
      },
      {
        ko: '협력사 · 이관',
        en: 'Supplier & Handoff',
        routes: ['/supplier/portal', '/supplier/package', '/decisions/report', '/decisions/supplier'],
      },
    ],
  },
  {
    id: PLANE_ID.Vehicle,
    ko: '차량',
    en: 'Vehicle',
    shortKo: '차량',
    shortEn: 'Vehicle',
    icon: '🚗',
    name: 'Vehicle',
    produces: 'Evaluation GuardDecision ApplyResult',
    contract: '현재 차량 상태에서 적용하고 실제 결과 보고',
    note: '현재 차량 상태에서 평가·적용하고 결과를 보고한다. 적용할 수 없으면 안전 기본값으로 전이한다.',
    demos: [
      {
        ko: 'Digital Twin · 차량 런타임',
        en: 'Digital Twin · Vehicle Runtime',
        routes: [
          '/twin/live',
          '/twin/fleet',
          '/twin/impact',
          '/twin/simulation',
          '/twin/vehicle/VIN-DEMO-017',
        ],
      },
      {
        ko: '장애 · 복구',
        en: 'Incident & Recovery',
        routes: ['/ops/incident', '/twin/incident'],
      },
    ],
  },
];

export const SPEC_PLANE_NAV: SpecPlaneNav[] = [
  ...DEFS.map((d) => ({
    ...d,
    coreIds: SPEC_PLANE_CORES[d.name] ?? [],
    screens: SPEC_PLANE_SCREEN_IDS[d.name] ?? [],
    screenGroups: screenGroupsOf(d.name),
  })),
  // 공유 기반 — 기준 화면을 소유하지 않는다(다섯 번째 Plane이 아니다). 공유 참조 문서만 둔다.
  {
    id: 'shared',
    ko: '공유 기반',
    en: 'Shared Basis',
    shortKo: '공유',
    shortEn: 'Shared',
    icon: '📚',
    name: 'Knowledge Foundation',
    produces: '—',
    contract: SPEC_KNOWLEDGE_FOUNDATION,
    note: '공유 식별·정확 버전·관계·원천·추적의 공유 기반. Plane이 아니므로 화면을 소유하지 않는다.',
    coreIds: [],
    screens: [],
    screenGroups: [],
    demos: [],
    shared: true,
  },
];

export const SPEC_PLANE_NAV_BY_ID: Record<string, SpecPlaneNav> = Object.fromEntries(
  SPEC_PLANE_NAV.map((p) => [p.id, p]),
);

/** 기준 화면 ID → 대표 Plane ID (30건 전부 채워진다) — 정본 배정을 그대로 옮긴 값 */
export const SPEC_PLANE_OF_SCREEN: Record<string, string> = Object.fromEntries(
  Object.entries(SPEC_SCREEN_PLANE).map(([screen, name]) => [screen, PLANE_ID[name]]),
);

/** 기준 화면 ID → 소유 Core 표시명 (예: UI12 → 'C16 차량 런타임 실행 모듈') */
export const SPEC_PLANE_CORE_OF_SCREEN = SPEC_SCREEN_PLANE_CORE;

/** 경로 → 대표 Plane ID (기준 화면 /ui/UIxx 와 구현 데모 경로 모두) */
export const SPEC_PLANE_OF_PATH: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  Object.entries(SPEC_PLANE_OF_SCREEN).forEach(([screen, plane]) => {
    m[`/ui/${screen}`] = plane;
  });
  SPEC_PLANE_NAV.forEach((p) => p.demos.forEach((d) => d.routes.forEach((r) => {
    m[r] = p.id;
  })));
  return m;
})();

/** 현재 경로의 대표 Plane — 목록에 없으면 undefined */
export const specPlaneOfPath = (pathname: string) => {
  if (SPEC_PLANE_OF_PATH[pathname]) return SPEC_PLANE_OF_PATH[pathname];
  const area = /^\/ui\/(UI\d\d)/.exec(pathname);
  if (area) return SPEC_PLANE_OF_SCREEN[area[1]];
  return undefined;
};

/** Plane별 기준 화면 ID 목록 */
export const SPEC_PLANE_SCREENS: Record<string, string[]> = Object.fromEntries(
  SPEC_PLANE_NAV.map((p) => [p.id, p.screens]),
);

/** 화면이 MENU 1.3 어느 업무 그룹에 있는지 (Plane과 다른 축임을 화면에서 함께 보여준다) */
export const specMenuGroupOfScreen = (screenId: string) => {
  const id = SPEC_MENU_GROUP_OF_SCREEN[screenId];
  return SPEC_MENU.find((g) => g.id === id);
};
