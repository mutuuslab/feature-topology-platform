// 컴포넌트 도구 신뢰성 분류 (FFG-PLT-013, 보고서 v1.1 8.1 · ISO 26262-8:2018 cl.11) — 플랫폼 컴포넌트를 SW 도구로 보고
// 오류 출력 유형마다 도구 영향(TI)·오류 검출 신뢰도(TD)를 정해 TCL을 낸다. TD1은 그 출력의 검출 수단을 지정할 때만,
// PKI·서명 서비스는 TD1을 쓰지 않는다(서명 뒤에는 후속 검출 수단이 없다). TCL2 이상은 cl.11 신뢰도 확보 방법이 있어야 한다.
// 값의 출처는 보고서 8.1 표(초기 예시)다 — Safety Plan 확정(Safety Manager 서명)은 조직 몫이고, 이 표는 그 초안과 검사 기준이다.
// 8.1 표에 없는 FF 컴포넌트는 UNCLASSIFIED로 남겨 열린 항목으로 보인다(임의로 채우지 않는다).

export type ToolImpact = 'TI1' | 'TI2';
export type ToolDetection = 'TD1' | 'TD2' | 'TD3';
export type Tcl = 'TCL1' | 'TCL2' | 'TCL3';
/** ISO 26262-8 cl.11.4.6 신뢰도 확보 방법 — 1a 사용 이력, 1b 개발 프로세스 평가, 1c 도구 검증, 1d 안전 표준에 따른 개발 */
export type QualificationMethod = '1a' | '1b' | '1c' | '1d';
export const QUALIFICATION_METHODS: Record<QualificationMethod, string> = {
  '1a': '사용 이력에 의한 신뢰 향상',
  '1b': '도구 개발 프로세스 평가',
  '1c': '도구 검증(validation)',
  '1d': '안전 표준에 따른 개발',
};

/** ISO 26262-8 Table 3 — TI1이면 TCL1, TI2이면 TD에 따라 */
export const tclOf = (ti: ToolImpact, td: ToolDetection | null): Tcl => (ti === 'TI1' || td === 'TD1' ? 'TCL1' : td === 'TD2' ? 'TCL2' : 'TCL3');

export interface ToolOutput {
  /** 오류 출력 유형 */
  error: string;
  ti: ToolImpact;
  td: ToolDetection | null;
  /** 검출 수단 — TD1·TD2는 반드시 */
  detection: string | null;
}

export interface ToolClassification {
  componentId: string;
  /** 보고서 8.1 표의 컴포넌트 이름(FF 컴포넌트와 다른 경우) */
  reportName: string | null;
  kind: 'TOOL' | 'VEHICLE_SW' | 'UNCLASSIFIED';
  /** 서명·키 서비스 — TD1 금지 */
  signing?: boolean;
  outputs: ToolOutput[];
  /** TCL2 이상의 신뢰도 확보 방법과 그 근거(FF 시험) */
  qualification: { methods: QualificationMethod[]; evidence: string[]; note?: string } | null;
  rules: string[];
  source: 'REPORT_8_1' | 'FF_DRAFT';
}

const T2 = (error: string, detection: string): ToolOutput => ({ error, ti: 'TI2', td: 'TD2', detection });
/** 1c 도구 검증 — FF 시험이 근거(검증 시험 파일은 manifest tests와 같은 출처) */
const V = (...evidence: string[]) => ({ methods: ['1c'] as QualificationMethod[], evidence });

export const TOOL_CLASSIFICATION: ToolClassification[] = [
  { componentId: 'D01-01', reportName: 'Feature Registry', kind: 'TOOL', outputs: [T2('잘못된 등급·프로파일', '플랫폼 게이트 조합 검사(checkProfile)·차량 Guard 초기화가 일부 조합 검출')], qualification: V('contracts/src/rules/classification.test.ts', 'backend/test/d01/safety-profile.spec.ts'), rules: ['FFG-CLS-001', 'FFG-CLS-009'], source: 'REPORT_8_1' },
  { componentId: 'D01-02', reportName: 'Feature Topology', kind: 'TOOL', outputs: [T2('누락된 위험 전파 관계 (차량이 검출 못함)', '재-HARA 검토·변경 영향 검증이 일부 검출')], qualification: V('contracts/src/rules/topology.test.ts', 'backend/test/d01/topology-catalog.spec.ts'), rules: ['FFG-LCY-003', 'FFG-LCY-012'], source: 'REPORT_8_1' },
  { componentId: 'D01-03', reportName: 'Feature Catalog', kind: 'TOOL', outputs: [T2('잘못된 Feature 조합 (차량이 검출 못함)', '게이트 Registry 대조·조합 시험(covering array)이 일부 검출')], qualification: V('contracts/src/rules/catalog.test.ts', 'contracts/src/rules/covering.test.ts'), rules: ['FFG-PLT-002'], source: 'REPORT_8_1' },
  { componentId: 'D01-04', reportName: '적용 대상 선정 규칙', kind: 'TOOL', outputs: [T2('잘못된 대상군', '게이트 대상 상한·2인 승인 검토')], qualification: V('contracts/src/flags/evaluate.test.ts'), rules: ['FFG-PLT-008'], source: 'REPORT_8_1' },
  { componentId: 'D01-05', reportName: '사용 권한 관리', kind: 'TOOL', outputs: [T2('잘못된 활성화 (Guard가 DISABLED 해제는 막지만 INACTIVE 활성화는 검출 못함)', '권한 대조·감사 이력')], qualification: V('contracts/src/rules/trial.test.ts', 'backend/test/d05/trials.spec.ts'), rules: ['FFG-CLS-007'], source: 'REPORT_8_1' },
  { componentId: 'D01-06', reportName: '정책 저장·버전 관리', kind: 'TOOL', outputs: [T2('잘못된 정책 값', '정책 생성 Golden 시험(결정적 바이트열)이 일부 검출')], qualification: V('backend/test/d06/policy-golden.spec.ts'), rules: ['FFG-PLT-014'], source: 'REPORT_8_1' },
  { componentId: 'D01-08', reportName: '단계적 기능 배포', kind: 'TOOL', outputs: [T2('범위 초과', '게이트 활성화 상한(누적 창)이 일부 검출')], qualification: V('contracts/src/rules/policy-gate.test.ts'), rules: ['FFG-LCY-009'], source: 'REPORT_8_1' },
  { componentId: 'D01-09', reportName: '정책 기반 활성화 제어', kind: 'TOOL', outputs: [T2('잘못된 활성화 판단', '평가 추적(trace)·OpenFeature F2 이상 차단')], qualification: V('contracts/src/flags/evaluate.test.ts'), rules: ['FFG-LCY-010'], source: 'REPORT_8_1' },
  { componentId: 'D01-10', reportName: '감사 이력 관리', kind: 'TOOL', outputs: [T2('기록 위변조', '감사 해시 체인 검증(verifyChain)')], qualification: V('backend/test/kernel/audit-chain.spec.ts'), rules: ['FFG-PLT-015'], source: 'REPORT_8_1' },
  { componentId: 'D02-01', reportName: 'Variant 조건 관리', kind: 'TOOL', outputs: [T2('사양 부적합 차량 선택 (target_hash는 식별만 확인)', '게이트 대상 대조')], qualification: V('contracts/src/rules/access-variant.test.ts'), rules: ['FFG-PLT-008'], source: 'REPORT_8_1' },
  { componentId: 'D02-02', reportName: '기능 지원 조건 관리', kind: 'VEHICLE_SW', outputs: [], qualification: null, rules: ['FFG-VEH-006'], source: 'REPORT_8_1' },
  { componentId: 'D02-03', reportName: '차량 런타임 실행 모듈', kind: 'VEHICLE_SW', outputs: [], qualification: null, rules: [], source: 'REPORT_8_1' },
  { componentId: 'D03-01', reportName: '컴플라이언스 룰 체커', kind: 'TOOL', outputs: [T2('조건 누락', '게이트 시장 규칙(PLT-009)·검증 이력 검토')], qualification: V('contracts/src/rules/policy-gate.test.ts'), rules: ['FFG-PLT-009', 'FFG-GEN-003'], source: 'REPORT_8_1' },
  { componentId: 'D03-02', reportName: '배포 안전성 검증', kind: 'TOOL', outputs: [T2('잘못된 PASS', '게이트 규칙 대조(Python 패키지 게이트와 parity)·결정 기록 검토')], qualification: V('contracts/src/rules/policy-gate.test.ts', 'backend/test/d03/policy-gate.spec.ts'), rules: ['FFG-LCY-002'], source: 'REPORT_8_1' },
  { componentId: 'D03-03', reportName: '긴급 기능 차단', kind: 'TOOL', outputs: [T2('요청 유형·대상 오류 (차량이 검출 못함)', '2인 승인 검토·게이트 등급·대상 상한 대조')], qualification: V('backend/test/d03/kill-v2.spec.ts'), rules: ['FFG-PLT-005'], source: 'REPORT_8_1' },
  { componentId: 'D03-04', reportName: '긴급 기능 차단 (복원 명령 생성)', kind: 'TOOL', outputs: [T2('요청 유형·대상 오류 (차량이 검출 못함)', '2인 승인(직전 Kill 승인자 제외)·게이트 대조')], qualification: V('backend/test/d03/kill-v2.spec.ts'), rules: ['FFG-DEAC-008'], source: 'REPORT_8_1' },
  { componentId: 'D04-01', reportName: '배포 파이프라인 연계', kind: 'TOOL', outputs: [{ error: '변조·오배달', ti: 'TI2', td: 'TD1', detection: '차량 Guard cmd_auth·target_hash 검증' }, T2('전달 누락', '상태 보고 대조(회신 기한 감시 pending_overdue)')], qualification: V('backend/test/d03/gleo-v2.spec.ts', 'backend/test/d04/status-v2.spec.ts'), rules: ['FFG-PLT-012'], source: 'REPORT_8_1' },
  { componentId: 'D04-02', reportName: '품질 기준 검증', kind: 'TOOL', outputs: [T2('거짓 PASS', 'G5 인정 조건(모든 기준·재현 정보·TMS)')], qualification: V('backend/test/d06/virtual.spec.ts'), rules: ['FFG-CODE-027'], source: 'REPORT_8_1' },
  { componentId: 'D04-03', reportName: '운영 데이터 수집', kind: 'TOOL', outputs: [T2('보고 손실·위조', 'state_auth·report_seq 수신 검사 6단계')], qualification: V('backend/test/d04/status-v2.spec.ts'), rules: ['FFG-TEL-003'], source: 'REPORT_8_1' },
  { componentId: 'D04-04', reportName: '이벤트 이력 추적', kind: 'TOOL', outputs: [T2('연결 누락', '이벤트 상관 ID·감사 대조')], qualification: V('backend/test/kernel/kernel.spec.ts'), rules: ['FFG-TEL-004'], source: 'REPORT_8_1' },
  { componentId: 'D04-06', reportName: '품질 피드백 반영', kind: 'TOOL', outputs: [{ error: '분석 오류 (안전 영향 없음)', ti: 'TI1', td: null, detection: null }], qualification: null, rules: ['FFG-SOT-003'], source: 'REPORT_8_1' },
  { componentId: 'D06-01', reportName: '정책 검증', kind: 'TOOL', outputs: [T2('검사 누락 (후속 공정이 검출 못함)', '정책 생성 Golden·게이트 스키마 검사')], qualification: V('contracts/src/flags/evaluate.test.ts', 'backend/test/d06/policy-golden.spec.ts'), rules: ['FFG-PLT-001', 'FFG-PLT-014'], source: 'REPORT_8_1' },
  { componentId: 'D06-02', reportName: '시스템 연동 검증', kind: 'TOOL', outputs: [T2('거짓 PASS', '연계 계약 시험(sim-contract·gleo 벡터)')], qualification: V('backend/test/d06/sim-contract.spec.ts', 'backend/test/d03/gleo-v2-vectors.spec.ts'), rules: ['FFG-TST-005'], source: 'REPORT_8_1' },
  { componentId: 'D06-03', reportName: '차량 시나리오 검증', kind: 'TOOL', outputs: [T2('거짓 PASS', 'G5 인정 조건·실제 CARLA 실행 시험·조합 시험')], qualification: { methods: ['1c'], evidence: ['backend/test/d06/virtual.spec.ts', 'backend/test/d06/sim-contract.spec.ts', 'sim/carla/tests/test_core.py', 'sim/carla/tests/test_live.py'], note: '가상검증 도구는 CARLA 0.9.16 폐루프(차량 동역학·레이더 기준 측정) — 판정 핵심은 이전 기준 운동학 결과를 값까지 재현(test_core), 실차 제동·센서 오차 모델은 HIL·실차로(보고서 12.4.1 한계)' }, rules: ['FFG-TST-003'], source: 'REPORT_8_1' },
  { componentId: 'D06-04', reportName: '검증 이력 관리', kind: 'TOOL', outputs: [T2('결과 손상', '해시 체인·Evidence 파일 sha256')], qualification: V('backend/test/d06/virtual.spec.ts'), rules: ['FFG-PLT-015'], source: 'REPORT_8_1' },
  { componentId: 'D06-05', reportName: '변경 영향 검증', kind: 'TOOL', outputs: [T2('회귀시험 선정 누락', '변경 영향 검토')], qualification: V('backend/test/d01/policy.spec.ts', 'contracts/src/flags/evaluate.test.ts'), rules: ['FFG-LCY-012'], source: 'REPORT_8_1' },
  { componentId: 'D06-06', reportName: '안전 동작 검증', kind: 'TOOL', outputs: [T2('거짓 PASS', 'G5 인정 조건(알려진 실패 면제 금지)·차량 내 감지 시나리오')], qualification: V('backend/test/d06/virtual.spec.ts'), rules: ['FFG-TST-004'], source: 'REPORT_8_1' },
  { componentId: 'D06-07', reportName: '안전 요구사항 추적', kind: 'TOOL', outputs: [T2('링크 누락', '규칙 추적 하네스(standards)')], qualification: V('tools/standards.ts'), rules: ['FFG-LCY-004'], source: 'REPORT_8_1' },
  { componentId: 'D06-08', reportName: '보안 배포 관리', kind: 'TOOL', signing: true, outputs: [{ error: '정상 서명된 잘못된 명령', ti: 'TI2', td: 'TD3', detection: null }], qualification: { methods: ['1c', '1d'], evidence: ['backend/test/d03/kill-v2.spec.ts', 'backend/test/d06/hsm.spec.ts'], note: 'ISO/SAE 21434 cl.10 보안 요구·TARA 기반 CAL을 따로 정한다' }, rules: ['FFG-SEC-002'], source: 'REPORT_8_1' },
  { componentId: 'D06-09', reportName: '플랫폼 인증·권한 관리(IAM)', kind: 'TOOL', outputs: [T2('권한 오부여', '직무 분리 검사·권한 감사')], qualification: V('backend/test/d06/iam-variant.spec.ts'), rules: ['FFG-PLT-016'], source: 'REPORT_8_1' },
  { componentId: 'D06-10', reportName: '인증서·키 관리(PKI/KMS)', kind: 'TOOL', signing: true, outputs: [{ error: '키 오사용', ti: 'TI2', td: 'TD3', detection: null }], qualification: { methods: ['1c', '1d'], evidence: ['backend/test/d06/hsm.spec.ts'], note: 'ISO/SAE 21434 cl.10 보안 요구·TARA 기반 CAL을 따로 정한다' }, rules: ['FFG-SEC-002', 'FFG-SEC-003'], source: 'REPORT_8_1' },
  { componentId: 'D06-12', reportName: '이상 징후 대응', kind: 'TOOL', outputs: [{ error: '조치 지연 (안전 영향 없음)', ti: 'TI1', td: null, detection: null }], qualification: null, rules: [], source: 'REPORT_8_1' },
  // 보고서 8.1 표에 없는 FF 컴포넌트 — Safety Manager 분류가 필요한 열린 항목
  ...['D01-07', 'D04-05', 'D05-01', 'D05-02', 'D05-03', 'D05-04', 'D05-05', 'D05-06', 'D05-07', 'D06-11'].map(
    (componentId): ToolClassification => ({ componentId, reportName: null, kind: 'UNCLASSIFIED', outputs: [], qualification: null, rules: [], source: 'FF_DRAFT' }),
  ),
];

export interface ToolClassificationProblem {
  componentId: string;
  code: 'MISSING' | 'TD1_WITHOUT_DETECTION' | 'TD2_WITHOUT_DETECTION' | 'SIGNING_TD1' | 'TCL2_WITHOUT_METHOD' | 'NO_OUTPUTS' | 'UNCLASSIFIED';
  message: string;
  /** UNCLASSIFIED는 열린 항목(경고), 나머지는 규칙 위반 */
  severity: 'FAIL' | 'OPEN';
}

/**
 * 분류 검사 — 컴포넌트 100%에 오류 유형별 TD 근거, TCL2 이상 100%에 신뢰도 확보 방법, 서명 서비스 TD1 금지.
 * @rule FFG-PLT-013 — 보고서 8.1 초기 예시 기준의 분류·검사. Safety Plan 확정(TI·TD 판단 근거의 Safety Manager 서명)과 8.1 밖 컴포넌트 분류는 조직 몫
 */
export function checkToolClassification(componentIds: string[], table: ToolClassification[] = TOOL_CLASSIFICATION): ToolClassificationProblem[] {
  const out: ToolClassificationProblem[] = [];
  const P = (componentId: string, code: ToolClassificationProblem['code'], message: string, severity: 'FAIL' | 'OPEN' = 'FAIL') => out.push({ componentId, code, message, severity });
  for (const id of componentIds) {
    const c = table.find((x) => x.componentId === id);
    if (!c) {
      P(id, 'MISSING', `${id} 도구 분류가 없습니다`);
      continue;
    }
    if (c.kind === 'UNCLASSIFIED') {
      P(id, 'UNCLASSIFIED', `${id}은(는) 보고서 8.1 표에 없어 분류되지 않았습니다 — Safety Manager가 TI·TD를 정해야 합니다`, 'OPEN');
      continue;
    }
    if (c.kind === 'VEHICLE_SW') continue; // ISO 26262-6으로 개발하는 차량 SW — 도구 분류 대상 아님(9장)
    if (!c.outputs.length) P(id, 'NO_OUTPUTS', `${id} 오류 출력 유형이 없습니다`);
    for (const o of c.outputs) {
      if (o.td === 'TD1' && !o.detection) P(id, 'TD1_WITHOUT_DETECTION', `${id} '${o.error}' TD1인데 검출 수단이 없습니다`);
      if (o.td === 'TD2' && !o.detection) P(id, 'TD2_WITHOUT_DETECTION', `${id} '${o.error}' TD2인데 검출 수단 근거가 없습니다`);
      if (c.signing && o.td === 'TD1') P(id, 'SIGNING_TD1', `${id}은(는) 서명·키 서비스 — TD1을 쓸 수 없습니다(서명 뒤에는 후속 검출 수단이 없다)`);
    }
    const tcl = componentTcl(c);
    if (tcl !== 'TCL1' && !c.qualification?.methods.length) P(id, 'TCL2_WITHOUT_METHOD', `${id} ${tcl} — ISO 26262-8 cl.11 신뢰도 확보 방법이 없습니다`);
  }
  return out;
}

/** 컴포넌트 TCL = 출력 유형별 TCL 중 가장 높은 것 */
export function componentTcl(c: Pick<ToolClassification, 'outputs'>): Tcl {
  return c.outputs.map((o) => tclOf(o.ti, o.td)).reduce<Tcl>((a, b) => (b > a ? b : a), 'TCL1');
}
