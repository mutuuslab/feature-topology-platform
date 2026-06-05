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
  'FR-SUP':  { status: '부분', screens: [{ to: '/feature/FEAT-BDC-001', label: 'Feature Detail(Control)' }] },
  'FR-TGT':  { status: '완료', screens: [{ to: '/variants/FEAT-BDC-001', label: 'Variant Matrix' }, { to: '/ops/campaign', label: 'Campaign' }] },
  'FR-RTE':  { status: '완료', screens: [{ to: '/ops/runtime', label: 'Runtime Sim' }] },
  'FR-LPC':  { status: '완료', screens: [{ to: '/ops/runtime', label: 'Runtime Sim' }] },
  'FR-SFD':  { status: '완료', screens: [{ to: '/ops/FEAT-BDC-001', label: 'Kill Switch·Safe Default' }] },
  // 03 안전·검증
  'FR-CRC':  { status: '완료', screens: [{ to: '/spec/compliance', label: '컴플라이언스' }] },
  'FR-DSV':  { status: '부분', screens: [{ to: '/readiness/FEAT-BDC-001', label: 'Release Readiness' }] },
  'FR-KSW':  { status: '완료', screens: [{ to: '/ops/FEAT-BDC-001', label: 'Kill Switch' }] },
  'FR-RBK':  { status: '완료', screens: [{ to: '/ops/FEAT-BDC-001', label: 'Rollback(단계복구)' }] },
  // 04 배포·운영·데이터
  'FR-OPD':  { status: '완료', screens: [{ to: '/ops/telemetry', label: 'Telemetry' }, { to: '/ops/FEAT-BDC-001', label: 'Ops' }] },
  'FR-QFL':  { status: '부분', screens: [{ to: '/ops/telemetry', label: 'Telemetry' }] },
  'FR-EVT':  { status: '완료', screens: [{ to: '/ops/telemetry', label: 'Telemetry' }, { to: '/insights/audit', label: 'Audit' }] },
  'FR-VOC':  { status: '완료', screens: [{ to: '/ops/incident', label: 'Incident' }] },
  'FR-RDD':  { status: '완료', screens: [{ to: '/spec/cicd', label: 'CI/CD' }] },
  'FR-CICD': { status: '완료', screens: [{ to: '/spec/cicd', label: 'CI/CD' }] },
  'FR-PDA':  { status: '부분', screens: [{ to: '/ops/campaign', label: 'Campaign' }, { to: '/spec/cicd', label: 'CI/CD' }] },
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

export const STATUS_COLOR: Record<CovStatus, string> = {
  '완료': 'var(--pass)', '부분': 'var(--pending)', '백엔드': 'var(--info)', '미구현': 'var(--muted)',
};
