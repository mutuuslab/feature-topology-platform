// FR family → 구현 화면·상태 매핑 (큐레이션). status: 완료 | 부분 | 백엔드 | 미구현
export type CovStatus = '완료' | '부분' | '백엔드' | '미구현';
export interface Cov { status: CovStatus; screens: { to: string; label: string }[] }

export const coverage: Record<string, Cov> = {
  // 01 Feature 정책 관리
  'FR-REG':  { status: '완료', screens: [{ to: '/catalog', label: 'Catalog' }, { to: '/feature/FEAT-BDC-001', label: 'Feature Detail' }, { to: '/readiness/FEAT-BDC-001', label: 'Release Readiness' }, { to: '/change/changeset', label: 'ChangeSet' }] },
  'FR-CAT':  { status: '완료', screens: [{ to: '/catalog', label: 'Catalog' }, { to: '/master/taxonomy', label: 'Taxonomy' }] },
  'FR-DEP':  { status: '완료', screens: [{ to: '/topology/FEAT-BDC-001', label: 'Topology' }, { to: '/topology/edge', label: 'Edge Editor' }, { to: '/impact', label: 'Impact' }] },
  'FR-POL':  { status: '완료', screens: [{ to: '/ops/policy', label: 'Policy Lifecycle' }, { to: '/master/control-points', label: 'Control Point' }] },
  'FR-AUTH': { status: '완료', screens: [{ to: '/ops/runtime', label: 'Runtime Sim' }] },
  'FR-ROL':  { status: '완료', screens: [{ to: '/ops/campaign', label: 'OTA Campaign' }] },
  'FR-EXP':  { status: '완료', screens: [{ to: '/spec/experiment', label: '실험·효과검증' }] },
  'FR-PVER': { status: '완료', screens: [{ to: '/ops/policy', label: 'Policy Lifecycle' }] },
  'FR-EXC':  { status: '완료', screens: [{ to: '/spec/exception', label: '예외 정책' }] },
  'FR-CON':  { status: '완료', screens: [{ to: '/spec/conflict', label: '정책 충돌' }] },
  'FR-RBAC': { status: '완료', screens: [{ to: '/admin/permissions', label: 'Permissions' }] },
  'FR-AUD':  { status: '완료', screens: [{ to: '/insights/audit', label: 'Audit Log' }] },
  // 02 차량 런타임
  'FR-VAR':  { status: '완료', screens: [{ to: '/variants/FEAT-BDC-001', label: 'Variant Matrix' }] },
  'FR-SUP':  { status: '완료', screens: [{ to: '/supplier/portal', label: 'Supplier Portal(책임·인수)' }, { to: '/supplier/package', label: 'API Package' }] },
  'FR-TGT':  { status: '완료', screens: [{ to: '/variants/FEAT-BDC-001', label: 'Variant Matrix' }, { to: '/ops/campaign', label: 'Campaign' }] },
  'FR-RTE':  { status: '완료', screens: [{ to: '/ops/runtime', label: 'Runtime Sim' }] },
  'FR-LPC':  { status: '완료', screens: [{ to: '/ops/runtime', label: 'Runtime Sim' }] },
  'FR-SFD':  { status: '완료', screens: [{ to: '/ops/FEAT-BDC-001', label: 'Kill Switch·Safe Default' }] },
  // 03 안전·검증
  'FR-CRC':  { status: '완료', screens: [{ to: '/spec/compliance', label: '컴플라이언스' }] },
  'FR-DSV':  { status: '완료', screens: [{ to: '/readiness/FEAT-BDC-001', label: 'Release Readiness(DSV 추적)' }] },
  'FR-KSW':  { status: '완료', screens: [{ to: '/ops/FEAT-BDC-001', label: 'Kill Switch' }] },
  'FR-RBK':  { status: '완료', screens: [{ to: '/ops/FEAT-BDC-001', label: 'Rollback(단계복구)' }] },
  // 04 배포·운영·데이터
  'FR-OPD':  { status: '완료', screens: [{ to: '/ops/telemetry', label: 'Telemetry' }, { to: '/ops/FEAT-BDC-001', label: 'Ops' }] },
  'FR-QFL':  { status: '완료', screens: [{ to: '/ops/telemetry', label: 'Telemetry(품질 피드백)' }] },
  'FR-EVT':  { status: '완료', screens: [{ to: '/ops/telemetry', label: 'Telemetry' }, { to: '/insights/audit', label: 'Audit' }] },
  'FR-VOC':  { status: '완료', screens: [{ to: '/ops/incident', label: 'Incident' }] },
  'FR-RDD':  { status: '완료', screens: [{ to: '/spec/cicd', label: 'CI/CD' }] },
  'FR-CICD': { status: '완료', screens: [{ to: '/spec/cicd', label: 'CI/CD' }] },
  'FR-PDA':  { status: '완료', screens: [{ to: '/ops/campaign', label: 'Campaign(자동배포)' }, { to: '/spec/cicd', label: 'CI/CD' }] },
  'FR-QGV':  { status: '완료', screens: [{ to: '/spec/cicd', label: '품질 Gate' }] },
  // 05 시스템 연계·확장
  'FR-AGW':  { status: '완료', screens: [{ to: '/integration/connectors', label: 'Connector Hub' }] },
  'FR-LGCY': { status: '완료', screens: [{ to: '/integration/connectors', label: 'Connector Hub' }] },
  'FR-DSYN': { status: '완료', screens: [{ to: '/integration/sync', label: 'Sync Logs' }] },
  'FR-SDVI': { status: '완료', screens: [{ to: '/integration/connectors', label: 'Connector Hub' }] },
  'FR-BIL':  { status: '완료', screens: [{ to: '/spec/billing', label: '과금 연계' }] },
  'FR-GLB':  { status: '완료', screens: [{ to: '/spec/business', label: '글로벌 출시' }] },
  'FR-FSP':  { status: '완료', screens: [{ to: '/spec/business', label: '현장 지원' }] },
  'FR-BIZ':  { status: '완료', screens: [{ to: '/spec/business', label: '사업 지표' }] },
  // 06 품질·보안·운영
  'FR-PVL':  { status: '완료', screens: [{ to: '/consistency', label: 'Consistency Console' }] },
  'FR-SPM':  { status: '완료', screens: [{ to: '/supplier/package', label: 'API Package' }, { to: '/supplier/portal', label: 'Supplier Portal' }] },
  'FR-SVL':  { status: '완료', screens: [{ to: '/spec/scenario', label: '시나리오 검증' }] },
  'FR-SCN':  { status: '완료', screens: [{ to: '/spec/scenario', label: '시나리오 검증' }] },
};

// 보안/기타 family fallback → 보안 운영
const SECURITY = ['FR-SRT', 'FR-SDM', 'FR-CIV', 'FR-VHM', 'FR-SVS'];
SECURITY.forEach(f => { coverage[f] = { status: '완료', screens: [{ to: '/spec/security', label: '보안 운영' }] }; });

export function coverageOf(family: string): Cov {
  return coverage[family] || { status: '미구현', screens: [{ to: '/spec/explorer', label: 'Spec Explorer' }] };
}

// family별 "실제 어떻게 반영됐는지" — 화면/store 메커니즘 설명
export const HOW: Record<string, string> = {
  'FR-REG': 'Catalog·Feature Detail에서 Feature 등록/조회, Lifecycle 전이는 store SET_LIFECYCLE(canTransition 게이트 가드)로 처리·Audit 기록',
  'FR-CAT': 'Catalog 검색·다중 필터·정렬·CSV Export, Taxonomy Browser(L0~L5) 레벨 경계',
  'FR-DEP': 'Topology 그래프(cytoscape) 관계 시각화 + Edge Editor에서 typed edge 추가(store ADD_EDGE, EQ1 순환 가드) → Impact 분석',
  'FR-POL': 'Policy Lifecycle 보드에서 단계 승급(store PROMOTE_POLICY: Draft→…→Monitored), Control Point Catalog',
  'FR-AUTH': 'Runtime Sim에서 정책 작성→서명→번들 발행(mock, Audit) — 백엔드 연동 시 데이터 소스 교체',
  'FR-ROL': 'OTA Campaign 단계 롤아웃 store CAMPAIGN_ADVANCE(5→20→50→100%, 실패율>5% telemetry 가드 차단) + AUTO 자동배포',
  'FR-EXP': '실험 화면 store CRUD(ADD_EXPERIMENT/EXP_STATUS), Running 실험 uplift는 LIVE_TICK으로 변동',
  'FR-PVER': 'Policy 승급 시 version 증가(Deployed 단계)로 정책 버전 관리',
  'FR-EXC': '예외 정책 화면 store ADD_EXCEPTION/EXC_REVOKE(승인·만료·해제)',
  'FR-CON': 'Topology edges 중 excludes/overrides 자동 탐지, 해소 액션은 Audit 기록(Consistency 연계)',
  'FR-RBAC': 'permMatrix(역할×verb) + can() 가드로 전 화면 버튼 잠금, Permissions Matrix 표시',
  'FR-AUD': 'Audit Log Explorer — 모든 store 액션(KILL/ACTIVATION/CR 등)이 append-only로 자동 기록·세션 실시간 반영',
  'FR-VAR': 'Variant Matrix에서 차종×조건 구조적 적용성(Allowed/Review/Blocked) 판정',
  'FR-SUP': 'Supplier Portal에서 OEM/Supplier 책임 구분·인수기준 승인(store ACCEPT_SUPPLIER) → Supplier Gate',
  'FR-TGT': 'Variant Matrix 적용성 + Campaign cohort 타겟으로 대상 차량 산정',
  'FR-RTE': 'Runtime Sim에서 VIN 단위 룰 평가(vehicleFeatureStates + activation) → 활성/차단 결정 표시',
  'FR-LPC': 'Runtime Sim 코호트별 로컬 정책 캐시 신선도·새로고침, 오프라인 시 Safe Default',
  'FR-SFD': 'Ops Kill Switch에서 Safe Default(disabled)·store KILL/RECOVER로 안전 기본값 보장',
  'FR-CRC': 'Compliance 화면 store RUN_COMPLIANCE — 차종×지역(KR/EU/US/CN) 법규 평가·차단 매트릭스',
  'FR-DSV': 'Release Readiness의 설계→검증 추적성 매트릭스(요구↔테스트↔증적) + 9-Gate(readiness)',
  'FR-KSW': 'Ops Dashboard Kill Switch — 확인 입력 후 store KILL(Safe Default disabled)·Audit',
  'FR-RBK': 'Ops 단계 복구(store RECOVER 5→20→100%) / Incident Rollback으로 직전 정상 정책 복귀',
  'FR-OPD': 'Ops Dashboard + Telemetry Explorer 실시간 지표(LIVE_TICK 2초 시뮬)·이벤트 스트림',
  'FR-QFL': 'Telemetry 품질 피드백 루프 — 실패율/롤백/인시던트에서 개선 액션 도출 → CR 생성(CREATE_CR)',
  'FR-EVT': 'Telemetry 실시간 이벤트(POLICY_APPLY 등) + Audit Log 귀속',
  'FR-VOC': 'Incident Manager 인시던트 lifecycle(store INCIDENT_STATUS: open→investigating→resolved)',
  'FR-RDD': 'CI/CD 파이프라인 — SW배포와 Feature 출시 분리(store RUN_PIPELINE 6단계)',
  'FR-CICD': 'CI/CD 파이프라인 store RUN_PIPELINE/PIPELINE_STEP, 단계별 로그',
  'FR-PDA': 'Campaign AUTO — LIVE_TICK이 실패율≤5% 자동 승급/>8% 자동 롤백(메트릭 기반)',
  'FR-QGV': 'CI/CD Quality Gate가 readiness() 9-Gate를 가드로 사용 — 미통과 시 차단(관리자 우회)',
  'FR-AGW': 'Connector Hub에서 ALM/PLM/Flag/OTA 커넥터 연결 토글(store CONNECTOR_TOGGLE)',
  'FR-LGCY': 'Connector Hub 레거시 시스템 어댑터(REST/ReqIF) 연결 상태 관리',
  'FR-DSYN': 'Sync Logs — 연결된 커넥터에서 LIVE_TICK으로 동기화 로그 실시간 유입',
  'FR-SDVI': 'Connector Hub SDV 인터페이스(OpenFeature provider 등) 커넥터',
  'FR-BIL': 'Billing 구독 CRUD + 사용량 실시간 정산(LIVE_TICK), 권한(entitlement)은 Activation 연동',
  'FR-GLB': 'Business 화면 — features 권역(fleetStats)·lifecycle에서 글로벌 출시율 KPI 파생',
  'FR-FSP': 'Business 화면 — 활성 차종 수 등 현장 지원 지표 파생',
  'FR-BIZ': 'Business 화면 — costSummary 기반 사업 지표(개발비·ROI) 파생',
  'FR-PVL': 'Consistency Console — 12 Rule 자동 평가·Severity(B/W/I) 분류·정합성 점수',
  'FR-SPM': 'API Release Package 10항목 인수 검증 + Supplier Portal 책임 매핑',
  'FR-SVL': 'Scenario 화면 store RUN_SCENARIO — 단계 시뮬(LIVE_TICK) → PASS/FAIL 집계',
  'FR-SCN': 'Scenario 화면 — 차종·상태·권한 조합 대량 시나리오 실행·커버리지',
};
SECURITY.forEach(f => { HOW[f] = 'Security 화면 — 취약점 ack/patch(store ACK_VULN)·인증서 만료 Timeline·정책 서명/무결성 상태'; });

export function howOf(family: string): string {
  return HOW[family] || '구현 화면에서 처리(상세는 Coverage 참조)';
}

export const STATUS_COLOR: Record<CovStatus, string> = {
  '완료': 'var(--pass)', '부분': 'var(--pending)', '백엔드': 'var(--info)', '미구현': 'var(--muted)',
};
