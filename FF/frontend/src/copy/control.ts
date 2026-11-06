// 관제(긴급 차단·복원·배포 회신·보안 키) 문구 — 담당자 웨이브 W1(P3-2·P4-1~P4-10). 공용 ko.ts와 섞지 않고 이 파일에 모은다.
import type { ApproverRole } from '@ff/contracts';

/** 보고서 승인 역할 → 업무 이름 */
export const APPROVER_ROLE: Record<ApproverRole, string> = {
  FSM: '기능안전(Safety Manager)',
  CSM: '사이버보안',
  OPS_LEAD: '운영 리더',
  PRODUCT_OWNER: '상품 Owner',
  QA: '품질',
  REGULATORY: '법규',
};

/** 부서 보기 → 그 부서에서 승인할 때 기본 서명 역할(P3-2 — 같은 사람이 여러 승인 역할을 가질 때) */
export const DEPT_SIGN_ROLE: Record<string, ApproverRole> = {
  'DEP-FS': 'FSM',
  'DEP-CS': 'CSM',
  'DEP-ITSEC': 'CSM',
  'DEP-OPS': 'OPS_LEAD',
  'DEP-QA': 'QA',
  'DEP-HOM': 'REGULATORY',
  'DEP-PDP': 'PRODUCT_OWNER',
};

export const control = {
  approval: {
    signAs: '서명 역할',
    signAsHint: '이 승인 칸에 기록될 역할입니다 — 같은 사람이 두 역할을 가져도 한 칸만 채웁니다',
    pair: (roles: string) => `이 차단은 ${roles} 2인이 승인합니다`,
    restorePair: (roles: string) => `복원은 차단을 승인하지 않은 ${roles}을(를) 포함한 2인이 승인합니다`,
    csmOnly: '남은 칸은 사이버보안(CSM)만 — F2 이상 안전·보안 차단은 기능안전과 사이버보안이 함께 승인합니다',
    candidates: '지금 승인할 수 있는 사람',
    candidatesNone: '지금 이 칸을 채울 수 있는 사람이 없습니다',
    deadEnd: (missing: string) => `이 승인으로 차단하면 복원을 승인할 ${missing} 담당이 남지 않습니다 — 복원이 막힐 수 있습니다`,
    escalate: '상위 대응: 기능안전 조직장에게 이 차단을 승인하지 않은 Safety Manager 지정(역할 부여)을 요청하세요. 운영 리더와 Safety Manager가 알림을 받습니다.',
    restoreWho: '복원을 승인할 수 있는 사람',
    restoreBlocked: (missing: string) => `복원 승인자 부족 — ${missing} 담당이 없습니다(직전 차단 승인자는 복원을 승인할 수 없음)`,
    someone: '회사 계정',
  },
  restore: {
    evidence: '재검증 Evidence',
    evidenceHint: '원인 수정 뒤 다시 판정한 근거 — 이 Feature의 Gate 판정 Evidence에서 고릅니다(G5 권장)',
    evidencePick: 'Evidence 선택',
    evidenceNone: '이 Feature의 판정 Evidence가 없습니다 — 원인 수정 뒤 Gate 판정을 먼저 남기세요',
    cohort: '이번 단계 Canary Cohort',
    cohortHint: '먼저 복원할 차량 — 관측 뒤 남은 차량으로 넓힙니다(단계적 복원). 게이트가 Canary 상한을 확인합니다',
    canary: 'Canary',
    all: '남은 차량 모두',
    needReason: '사유를 적으세요',
    needEvidence: '재검증 Evidence를 고르세요',
    needCohort: '이번 단계에 복원할 차량을 하나 이상 고르세요',
    progress: (n: number, total: number) => `복원 ${n}/${total}대`,
    activeWithRestore: (n: number, total: number) => `차단 중 · 복원 ${n}/${total}대`,
    stages: '단계적 복원 기록',
    stageCol: { no: '단계', cohort: '차량', evidence: 'Evidence', pub: '복구 게시본', at: '승인 시각' },
    requested: (evidence: string, n: number) => `재검증 ${evidence} · 이번 단계 ${n}대`,
  },
  pub: {
    status: { SIGNED: '서명됨', DISPATCHED: '회신 대기', CONFIRMED: '적용 확인', PARTIAL: '일부 확인', TIMEOUT: '회신 기한 지남', DIVERGED: '불일치' } as Record<string, string>,
    node: { CONFIRMED: '적용 확인', DIVERGED: '불일치', UNKNOWN: '판단 불가' } as Record<string, string>,
    reason: {
      READBACK_MATCH: '회신 일치',
      STATE_MISMATCH: '회신 값 다름',
      NO_REPORT: '회신 없음',
      ACK_ONLY: '수신 확인만',
      OTHER_PUBLICATION: '다른 게시본 회신',
      OTHER_FEATURE_VERSION: '다른 Version 회신',
      OTHER_BOOT: '이전 부팅 회신',
      OLD_SEQUENCE: '이전 순번 회신',
      STALE_REPORT: '오래된 회신',
      UNREDUCED_REPORTS: '회신 여러 건',
    } as Record<string, string>,
    waiting: (n: number, min: number) => `회신 대기 게시본 ${n}건 · 가장 오래 ${min}분`,
    waitingShort: (min: number) => `미수신 ${min}분`,
    paused: '차량 시뮬레이터 회신이 멈춰 있습니다(시험용 수동 시계) — 데모 서버를 일반 설정으로 다시 시작하면 차량이 회신합니다',
    keysAt: '키 교체는 보안·인증서 화면에서',
  },
  vehicle: {
    unknown: (vin: string) => `판단 불가 — ${vin} 차량 회신을 받지 못했습니다`,
    unknownFor: (vin: string, min: number) => `판단 불가 — ${vin} 미수신 ${min}분`,
    noState: '차량 회신 없음 — 판단 불가',
  },
  keys: {
    rotate: '서명 키 교체',
    purpose: '키 용도',
    notAfter: '만료',
    fingerprint: '공개키 지문',
    since: '만든 때',
    purposeName: { policy: '정책 배포', activate: '기능 활성화', kill: '긴급 차단', restore: '복원', sync: '상태 동기화', gate: '정책 게이트 판정', export: '감사·이력 내보내기' } as Record<string, string>,
    rotateBody: '고른 용도의 새 키로 이후 게시본을 서명합니다. 이전 키는 검증 전용으로 남아 이미 배포한 게시본은 계속 검증됩니다. 품질·운영 담당에게 알림이 갑니다.',
    status: { ACTIVE: '서명 중', RETIRED: '검증 전용' } as Record<string, string>,
    approverKeys: '승인자 서명 키',
    approverCol: { user: '승인자', fp: '공개키 지문', source: '보관', status: '상태', at: '등록' },
    approverSource: { PLATFORM: '플랫폼 보관(데모)', EXTERNAL: '외부 장치' } as Record<string, string>,
    noX509: '승인자 키는 X.509 인증서가 아닌 등록 공개키로 검증합니다 — 인증서 체인은 고객 PKI 연동 때 붙습니다',
    hsm: { epoch: '차량 키 세대(epoch)', approverKeys: '등록된 승인자 공개키' } as Record<string, string>,
    rotated: (keyId: string) => `새 키 ${keyId}로 교체했습니다 — 이전 키는 검증 전용`,
  },
  anomaly: {
    toKillSotif: '긴급 차단으로',
    toKillSotifHint: '치명(CRITICAL) 현장 SOTIF 이상 — 차단이 필요하면 2인 승인 차단 요청으로 넘어갑니다',
  },
  incident: {
    scope: { OUT_OF_SCOPE: '적용 범위 밖 차량', UNKNOWN_VEHICLE: '등록되지 않은 차량', IN_SCOPE: '적용 범위' } as Record<string, string>,
    outOfScope: (vin: string, featureId: string) => `${vin}은(는) ${featureId}의 적용 범위(국가·차종·트림) 차량이 아닙니다 — 이 차량에 없는 기능일 수 있습니다. 그래도 접수할 수 있습니다`,
    unknownVehicle: (vin: string) => `${vin}은(는) 등록된 차량이 아닙니다 — VIN을 확인하세요`,
  },
};
