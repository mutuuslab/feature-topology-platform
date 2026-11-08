import { localizedCopy } from '../locale/runtime';

// Display captions for canonical contract codes. Never used for parsing, authorization or persisted audit values.
export const contractCaptions = /* @__PURE__ */ localizedCopy('contract-captions.contractCaptions', {
  complianceType: { LEGAL: '법규', PRIVACY: '개인정보', SAFETY: '안전', SECURITY: '보안' },
  complianceStatus: { PROPOSED: '승인 대기', APPROVED: '승인', REJECTED: '반려', RETIRED: '만료' },
  complianceCheck: { SAFE_DEFAULT_OFF: 'Safe Default 꺼짐', STAGED_ROLLOUT: '코호트 단계 배포', REQUIREMENT_TRACE: '요구사항 연결', GATE_PASS: 'Gate 통과', ENTITLEMENT_REQUIRED: '사용 권한 상품 연결', NO_VEHICLE_ID_TARGETING: '차량 식별자로 대상 지정 금지', MARKET_PROFILE_CONFIRMED: '시장 Profile 확인', TARA_RECORDED: 'TARA 기록' },
  gateJudge: { G1: 'Feature 정의 승인자', G2: '요구사항 검토 책임자', G3: '차량 사양 승인자', G4: '제어 통합 책임자', G5: '검증시험 책임자', G6: '협력사 품질 승인자', G7: '기능안전·보안 승인자', G8: 'OTA 릴리스 승인자', G9: '운영 출시 승인자' },
  transition: { APPROVED: '정의 승인', START: '개발 착수 (Control Point 1개 이상)', VERIFIED: '검증 완료', RELEASED: '출시', REWORK: '검증 실패 — 개발로 되돌림', DEPRECATED: '신규 사용 중단', RETIRED: '종료' },
  sourceResponse: '서버 응답 원문',
  procedure: { G1:'등록·분류', G2:'HARA 영향', G3:'안전요구·정의 승인', G4:'설계 독립 검토', G5:'V&V', G6:'서명 배포', G7:'출시·활성화', G8:'운영 판정' },
  procedureLink: (gate:string,name:string,platform:string) => `절차 ${gate} ${name} = 플랫폼 ${platform}`,
  procedureOnly: (gate:string) => `절차 ${gate}`,
  procedureNoGate: '플랫폼 Gate 없음 — 분기 드릴·긴급 차단·감사 기록으로 확인',
  blocker: {
    NO_RULE: '허용된 Lifecycle 전이가 없습니다.', GATE_NOT_PASSED: '필수 Gate가 통과되지 않았습니다.', GATE_UNJUDGED: '필수 Gate 판정이 없습니다.', GATE_UNSIGNED: 'Gate 판정 서명을 확인해야 합니다.', INPUT_MISSING: '필수 입력이 누락되었습니다.', DEPENDENCY_UNRESOLVED: '필요 관계 대상 Version이 확정되지 않았습니다.', POLICY_MISSING: 'Control Point의 정책 등록이 부족합니다.', RELEASE_SIGNOFF_MISSING: '현재 G8·G9에 묶인 Feature Owner 출시 책임 서명이 필요합니다.', REHARA_OPEN: '재-HARA 영향 검토가 열려 있습니다.', ROLE: '이 작업을 수행할 역할이 아닙니다.', SEPARATION_OF_DUTY: '작성자와 승인·출시 담당자는 다른 사람이어야 합니다.', REASON_REQUIRED: '전이 사유를 입력하세요.', REFDB_LINK_BLOCKED: 'Feature DB 기준 행 연결과 ASIL 근거를 확인하세요.', FLAG_CODE_MISSING: 'Flag 코드 연결 또는 대사 조건이 미충족입니다.', GATE_CHECK_FAILED: '현재 데이터의 Gate 자동 검사가 미충족입니다.', RETIREMENT_INCOMPLETE: 'Flag Retirement 단계 또는 종료 조건이 미완료입니다.', ISSUE_REQUIRED: '식별한 이슈 항목이 필요합니다.', WORK_PRODUCT: '필수 산출물의 연결·승인 조건이 미충족입니다.', REJUDGE_OPEN: '열린 재판정 요청을 해결해야 합니다.',
  },
  gateCheck: { OWNER: 'Feature Owner 지정', REQUIRES_RELEASED: '필요(requires) 관계 대상이 출시됨', VARIANT_RULE: 'Variant 조건 등록(국가·차종·트림·UPG-VC)', TEST_EVIDENCE: '필수 시험 Evidence', SAFETY_EVIDENCE: '안전·보안 분석 근거', SAFE_DEFAULT: 'Safe Default와 정책 범위', ROLLBACK_PLAN: 'Rollback Plan', KILL_READY: '긴급 차단 실행 준비', DEPLOY_METHOD: '배포 방식과 대상', TELEMETRY: '텔레메트리 연결', AUDIT_LOG: '감사 기록', ALERT_RULE: '운영 경보 수신 규칙' },
});
