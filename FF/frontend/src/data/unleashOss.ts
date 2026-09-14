/**
 * UL-OSS-R1 — Unleash OSS 무료 에디션 통합 검토 (정본 데이터 계층).
 *
 * 정본: `FP_Unleash_OSS_Integration_Review_v1_0.html` (개정 UL-OSS-R1 / 2026-09-13)
 *       `appendices/verification/Current_Unleash_OSS_Integration_Audit_v1_0.json` (26 항목)
 *       `validation/source-provenance.json` (출처 정본)
 *
 * 계약 관계
 *  · 계약 UL-OSS-01~14 ↔ 요구 FR-ULOSS-001~014 (05_기능요구사항) — 1:1
 *  · 인터페이스 IF-FF-01~07 ↔ 21_External_Interface — 1:1
 *  · 형상: AR 4.5 / SW 4.6 / UI UX 4.6 / XLSX 1.0 위에 개정 ID 로만 얹는다(버전 번호를 올리지 않는다 — QC-UL-01)
 *
 * 이 모듈은 값을 지어내지 않는다. `NOT_RUN`·`NOT_RECORDED` 는 완료 표기가 아니라
 * **실행·승인 전 상태**이며 화면은 그대로 미실행으로 그린다(QC-UL-05).
 */

export const ULOSS_REVISION = 'UL-OSS-R1';
export const ULOSS_REVISION_DATE = '2026-09-13';
export const ULOSS_BASELINE = 'AR 4.5 · SW 4.6 · UI UX 4.6 · XLSX 1.0';

// ════════════════════════════════════════════════════════════════════════════
// 1. 출처 정본 (source-provenance.json)
// ════════════════════════════════════════════════════════════════════════════

export const SOURCE_PROVENANCE: { ko: string; value: string; mono?: boolean }[] = [
  { ko: '저장소', value: 'https://github.com/Unleash/unleash', mono: true },
  { ko: '태그', value: 'v8.2.0', mono: true },
  { ko: '태그 객체', value: 'cf76ac86', mono: true },
  { ko: '커밋', value: '66d4a45c1d24c4bc8a08d8c75d205bd61dc3aed0', mono: true },
  { ko: '아카이브', value: 'unleash-8.2.0-66d4a45c.tar.gz', mono: true },
  { ko: '아카이브 sha256', value: 'b3569270b5341cf89d0d3fd46d918c3ec29f0439ada491f3431159119bc2bf3b', mono: true },
  { ko: '라이선스', value: 'AGPL-3.0-or-later' },
  { ko: '이미지 선택', value: 'GitHub 소스 로컬 빌드, 공식 사전빌드 Docker 이미지 미사용' },
  { ko: 'SDK', value: 'unleash-client 6.12.1 (NPM 무결성 고정)', mono: true },
  { ko: 'Docker 시험', value: 'NOT_RUN' },
  { ko: '법무 승인', value: 'NOT_RECORDED' },
];

/** 역할 경계 — 도구는 보관소·평가값 제공자다. 정본은 FP 다. */
export const ULOSS_ROLE = {
  tool: 'Feature Flag 정의 보관소 · 평가값 제공자',
  toolNote: 'GitHub Unleash/unleash v8.2.0 소스만으로 구성 — AGPL-3.0-or-later',
  platform: '승인 · 권한 · 감사 · 서명 · 배포 진행의 정본',
  platformNote: '도구 권한으로 FP 발행을 허용하지 않는다(UL-OSS-08)',
  evaluationSoT: '차량 로컬 서명 스냅샷(C17) 과 C16 평가 결과',
  displayValueRule: '화면 표시값은 판정 근거가 아니다(QC-UL-07)',
};

// ════════════════════════════════════════════════════════════════════════════
// 2. 기준 QC-UL-01~07
// ════════════════════════════════════════════════════════════════════════════

export interface UlCriterion { id: string; ko: string; condition: string; applies: string }

export const UL_CRITERIA: UlCriterion[] = [
  { id: 'QC-UL-01', ko: '개정 표기', condition: '버전 번호를 올리지 않고 개정 ID UL-OSS-R1로만 표기한다(QC-ID-08 선례).', applies: 'AR · SW · UIUX · XLSX · 모델' },
  { id: 'QC-UL-02', ko: '출처 정본 일치', condition: '저장소·태그·커밋·아카이브 sha256·라이선스·SDK 버전이 validation/source-provenance.json과 일치한다.', applies: 'AR-08-OS-1 · SW UL-DD-13-2' },
  { id: 'QC-UL-03', ko: '한계 주장 근거', condition: '무료·Enterprise 기능 차이 주장에는 공식 비교표 URL(docs.getunleash.io/support/oss-comparison)을 함께 표기한다.', applies: 'AR-08-OS-3' },
  { id: 'QC-UL-04', ko: 'ID 1:1 연결', condition: 'FR-ULOSS-001~014 · UL-OSS-01~14 · IF-FF-01~07이 05_기능요구사항·21_External_Interface 행과 1:1로 대응한다.', applies: 'XLSX 05 · 21 · 모델' },
  { id: 'QC-UL-05', ko: '미실행 표기', condition: '이미지 빌드·기동, 차량 적용, 제품 서버 반입, 사용자 인수를 NOT_RUN으로 표기하고 완료로 쓰지 않는다.', applies: '전 산출물' },
  { id: 'QC-UL-06', ko: '책임 보상', condition: '무료 에디션 부재 기능마다 보상 책임 Core와 검증 증적을 표에 고정한다.', applies: 'AR-08-OS-3' },
  { id: 'QC-UL-07', ko: '화면 경계', condition: '도구 UI에서 승인·발행·Flag 전환을 수행하지 않고 표시값을 판정 근거로 쓰지 않는다.', applies: 'UIUX · UL-OSS-R1 · UI18-S02 · UI30-S04' },
];

export const OSS_COMPARISON_URL = 'https://docs.getunleash.io/support/oss-comparison';

// ════════════════════════════════════════════════════════════════════════════
// 3. 계약 UL-OSS-01~14
// ════════════════════════════════════════════════════════════════════════════

export interface UlContract {
  id: string;
  title: string;
  core: string;
  coreName: string;
  requirement: string;
  verify: string;
  fr: string;
}

export const UL_CONTRACTS: UlContract[] = [
  { id: 'UL-OSS-01', title: 'Unleash OSS 소스 고정 취득', core: 'C28', coreName: '배포 파이프라인 연계', verify: 'Test + Inspection', fr: 'FR-ULOSS-001', requirement: '플랫폼은 GitHub OSS 저장소 v8.2.0과 태그 객체 cf76ac86…, 커밋 66d4a45c…, 아카이브 sha256 b3569270…을 정본으로 고정해 취득하고 라이선스(AGPL-3.0-or-later)를 기록한다.' },
  { id: 'UL-OSS-02', title: 'Unleash 이미지 선택과 레지스트리 승격', core: 'C28', coreName: '배포 파이프라인 연계', verify: 'Inspection', fr: 'FR-ULOSS-002', requirement: '플랫폼은 공식 사전빌드 이미지를 사용하지 않고 GitHub 소스에서 로컬 빌드한 이미지를 다이제스트·SBOM과 함께 사내 레지스트리로 승격한다.' },
  { id: 'UL-OSS-03', title: 'Unleash 실행 배치와 네트워크 경계', core: 'C31', coreName: 'API Gateway', verify: 'Inspection', fr: 'FR-ULOSS-003', requirement: '플랫폼은 Unleash OSS Server와 전용 PostgreSQL을 FP DB와 분리해 배치하고 관리 포트·관리 UI를 비공개 경로로만 노출하며 차량망에 직접 노출하지 않는다.' },
  { id: 'UL-OSS-04', title: 'Feature 정의 수집과 정규화', core: 'C33', coreName: '데이터 동기화', verify: 'Test', fr: 'FR-ULOSS-004', requirement: '플랫폼은 Admin API로 정의를 수집해 C33을 거쳐 C08 정본으로 정규화하고 수집 시각·revision·digest를 보존하며 매핑되지 않은 정의는 격리한다.' },
  { id: 'UL-OSS-05', title: '발행 정본 서명과 도구 역할 분리', core: 'C46', coreName: '보안 배포 관리', verify: 'Test + Analysis', fr: 'FR-ULOSS-005', requirement: '플랫폼은 발행 정본을 C46 서명 스냅샷으로 만들고 도구는 정의 보관소로만 사용하며 서명이 없는 정의의 배포를 금지한다.' },
  { id: 'UL-OSS-06', title: '차량 로컬 평가와 fail-closed', core: 'C17', coreName: '로컬 정책 캐시', verify: 'Test', fr: 'FR-ULOSS-006', requirement: '플랫폼은 차량이 도구에 직접 연결되지 않아도 C17 로컬 캐시의 서명 스냅샷으로 C16 평가를 수행하고 미연결·검증 실패 시 안전 기본값으로 동작한다.' },
  { id: 'UL-OSS-07', title: '다중 ECU 평가 대사와 부분 판정', core: 'C23', coreName: '운영 데이터 수집', verify: 'Test', fr: 'FR-ULOSS-007', requirement: '플랫폼은 필수 ECU의 readback을 수집·대사하고 누락이 있으면 UNKNOWN 또는 PARTIAL로 판정하며 운영 확인 대상으로 남긴다.' },
  { id: 'UL-OSS-08', title: '승인·권한·감사 소유권', core: 'C01', coreName: 'Feature Registry', verify: 'Test + Inspection', fr: 'FR-ULOSS-008', requirement: '플랫폼은 도구에 Change Request·세분 RBAC·SSO/SCIM·확장 감사가 없음을 전제로 승인(C01)·권한(C11)·감사(C12)·신뢰(C47)를 소유하고 도구 권한으로 FP 발행을 허용하지 않는다.' },
  { id: 'UL-OSS-09', title: '프로젝트·환경 제약 운용', core: 'C08', coreName: '정책 저장 · 버전 관리', verify: 'Inspection', fr: 'FR-ULOSS-009', requirement: '플랫폼은 무료 에디션의 Projects 1개·Environments 2개 제약을 스테이지 운용 규칙으로 흡수하고 분리가 필요하면 파티션·정본 재사용으로 대응한다.' },
  { id: 'UL-OSS-10', title: '관측 경계와 impression 미사용', core: 'C25', coreName: '이벤트 이력 추적', verify: 'Inspection', fr: 'FR-ULOSS-010', requirement: '플랫폼은 impression data를 기본 OFF로 유지하고 도구의 Analytics·Signals·Network view 부재를 C25 이벤트 이력과 C38 사업 지표가 대체하며 Playground는 운영자 검토 전용으로 제한한다.' },
  { id: 'UL-OSS-11', title: '도구 자격증명 수명 주기', core: 'C47', coreName: '인증 · 키 관리', verify: 'Test + Inspection', fr: 'FR-ULOSS-011', requirement: '플랫폼은 Service account 부재를 전제로 전용 토큰을 발급·회전하고 개인 토큰 사용과 관리자 UI 직접 조작을 금지하며 접근 기록을 감사에 결합한다.' },
  { id: 'UL-OSS-12', title: 'Enterprise 전용 기능 의존 금지', core: 'C30', coreName: '품질 기준 검증', verify: 'Analysis + Inspection', fr: 'FR-ULOSS-012', requirement: '플랫폼은 무료 에디션에 없는 기능을 요구로 만들지 않고 필요한 업무는 FP Core로 보상하며 상향 전환은 별도 승인·법무·비용 검토 대상으로만 남긴다.' },
  { id: 'UL-OSS-13', title: '공급망·보안 반입 통제', core: 'C48', coreName: '보안 취약점 모니터링', verify: 'Inspection', fr: 'FR-ULOSS-013', requirement: '플랫폼은 SBOM과 취약점 승격 없이는 이미지를 반입하지 않고 TLS 검증 우회를 금지하며 반입 승인 기록과 고지 의무를 보존한다.' },
  { id: 'UL-OSS-14', title: '통합 검증 계약과 미실행 표기', core: 'C44', coreName: '검증 이력 관리', verify: 'Test + Inspection', fr: 'FR-ULOSS-014', requirement: '플랫폼은 통합 검증 기록을 C44에 보존하고 이미지 빌드·기동·차량 적용·제품 서버 반입·사용자 인수는 NOT_RUN으로 표기하며 골든 벡터 회귀를 유지한다.' },
];

export const UL_CONTRACT_BY_ID = new Map(UL_CONTRACTS.map(c => [c.id, c]));

// ════════════════════════════════════════════════════════════════════════════
// 4. 인터페이스 IF-FF-01~07
// ════════════════════════════════════════════════════════════════════════════

export interface UlInterface {
  id: string;
  /** 대상 체계 */
  system: string;
  name: string;
  core: string;
  coreName: string;
  stage: '설계' | '검증' | '운영' | '검증·운영' | '검증·출시';
  direction: string;
  mode: string;
  auth: string;
  freshness: string;
  errorIdem: string;
  /** 사용하지 않는 인터페이스인가 — 그 사실 자체가 계약이다. */
  unused?: boolean;
}

export const UL_INTERFACES: UlInterface[] = [
  { id: 'IF-FF-01', system: 'Unleash OSS (자체 호스팅)', name: '정의 수집(Admin API)', core: 'C33', coreName: '데이터 동기화', stage: '운영', direction: 'Unleash → FP', mode: 'REST', auth: '전용 Admin API 토큰 + mTLS', freshness: '5분', errorIdem: '수집 실패 시 재시도, 미매핑 정의는 격리 큐 / FlagName+Revision' },
  { id: 'IF-FF-02', system: 'Unleash OSS (자체 호스팅)', name: '평가 참조(Client API)', core: 'C16', coreName: '차량 런타임 실행 모듈', stage: '검증·운영', direction: 'FP Runtime → Unleash', mode: 'REST/SDK', auth: '전용 Client API 토큰 + TLS', freshness: '호출 시점', errorIdem: '도구 응답 불가 시 로컬 판정 사용 / RequestID' },
  { id: 'IF-FF-03', system: 'Unleash OSS (자체 호스팅)', name: '표시값 평가(Frontend API)', core: 'C31', coreName: 'API Gateway', stage: '운영', direction: 'HMI → Unleash', mode: 'REST/SDK', auth: 'Frontend 토큰 + TLS', freshness: '호출 시점', errorIdem: '표시 실패는 판정에 영향 없음 / RequestID' },
  { id: 'IF-FF-04', system: 'Unleash OSS (자체 호스팅)', name: '변경 통보(Webhook) — 미사용 확정', core: 'C33', coreName: '데이터 동기화', stage: '설계', direction: 'Unleash → FP', mode: 'HTTPS', auth: '사용하지 않음', freshness: '해당 없음', errorIdem: '변경 통보는 수집 어댑터(C33)가 담당 / 해당 없음', unused: true },
  { id: 'IF-FF-05', system: '전용 PostgreSQL', name: '도구 데이터 저장', core: 'C33', coreName: '데이터 동기화', stage: '운영', direction: 'Unleash → 전용 DB', mode: 'TCP', auth: '전용 DB 계정 + TLS, FP DB와 분리', freshness: '즉시', errorIdem: 'DB 장애 시 수집 중단·신규 발행 지연 / RecordID' },
  { id: 'IF-FF-06', system: 'GitHub (OSS 저장소)', name: '소스·릴리스 취득', core: 'C28', coreName: '배포 파이프라인 연계', stage: '검증', direction: 'GitHub → 빌드 파이프라인', mode: 'HTTPS', auth: 'HTTPS + 해시 대조', freshness: '취득 시점', errorIdem: '해시 불일치 시 취득 거부 / ArchiveSha256' },
  { id: 'IF-FF-07', system: '사내 컨테이너 레지스트리', name: '이미지 승격·배포', core: 'C46', coreName: '보안 배포 관리', stage: '검증·출시', direction: '빌드 → 런타임', mode: 'OCI Registry', auth: '서명 이미지 + 다이제스트 고정', freshness: '승격 시점', errorIdem: '다이제스트 불일치 시 배포 거부 / ImageDigest' },
];

export const UL_INTERFACE_BY_ID = new Map(UL_INTERFACES.map(i => [i.id, i]));

/** 변경 통보 경로가 도구에서 오지 않는다는 계약 — 수집 어댑터(C33) 폴링이 담당한다. */
export const UL_WEBHOOK_USED = false;
export const UL_COLLECTION_OWNER = 'C33 데이터 동기화 (폴링 어댑터)';

// ════════════════════════════════════════════════════════════════════════════
// 5. 무료 에디션 한계와 보상 책임
// ════════════════════════════════════════════════════════════════════════════

export interface UlLimit {
  limit: string;
  impact: string;
  /** FP 보상 책임 Core */
  compensates: string;
  evidence: string;
}

export const UL_LIMITS: UlLimit[] = [
  { limit: 'Projects 1개 · Environments 2개', impact: '다중 프로젝트·환경 분리 불가', compensates: 'C01 Feature Registry · C08 정책 저장·버전 관리', evidence: '환경 슬롯 운용 규칙 점검' },
  { limit: 'Flag·Variant 의존성 없음', impact: '정의 간 의존 판정 불가', compensates: 'C03 BOM·구성·의존관계 관리 · C14 Topology·Capability 평가', evidence: '의존 판정 시험(FP 정본)' },
  { limit: '이름 규칙·링크 템플릿 없음', impact: '명명·추적 규칙 강제 불가', compensates: 'C01 Feature Registry · C19 컴플라이언스 룰 체커', evidence: '명명 규칙 위반 차단 시험' },
  { limit: 'Release template · 자동 진행 · Safeguard 없음', impact: 'Wave 진행·중단 자동화 없음', compensates: 'C06 단계적 기능 배포 · C29 단계적 배포 자동화', evidence: 'Wave 중단·재개 시험' },
  { limit: 'Change Request · 승인 워크플로 없음', impact: '변경 승인이 도구에서 강제되지 않음', compensates: 'C01 Feature Registry · C12 감사 이력 관리', evidence: '승인 없는 발행 차단 시험' },
  { limit: 'Service account 없음', impact: '자동화 자격증명 관리 없음', compensates: 'C47 인증·키 관리 · C44 검증 이력 관리', evidence: '토큰 회전·개인 토큰 0 시험' },
  { limit: 'RBAC 기본 역할만 제공', impact: '세분 권한·직무 분리 불가', compensates: 'C11 RBAC · C47 인증·키 관리', evidence: '권한 우회 차단 시험' },
  { limit: 'SSO · SCIM 없음', impact: '신원 연계·자동 프로비저닝 없음', compensates: 'C11 RBAC · C47 인증·키 관리', evidence: '계정 수명 주기 점검' },
  { limit: '감사 로그 기본 수준', impact: '변경 이력 증적 부족', compensates: 'C12 감사 이력 관리', evidence: '감사 누락 0 시험' },
  { limit: 'Signals · Actions · Analytics · Network view 없음', impact: '탐지·자동 대응·관측 통합 없음', compensates: 'C23 수집 · C25 이벤트 이력 · C38 사업 지표', evidence: '관측·대응 경로 시험' },
  { limit: 'Edge 종료(2026-12-31) · Cloud · SLA 없음', impact: '오프라인 Edge·상용 지원 없음', compensates: 'G-01~G-06 운영 Gate · 로컬 평가(C17·C16)', evidence: '미연결 주입 시험(NOT_RUN)' },
  { limit: '서버 1~4대 · SDK 직접 연결 한계', impact: '대규모 팬아웃 불가', compensates: 'C17 로컬 정책 캐시 · C46 보안 배포 관리', evidence: '서명 스냅샷 배포 시험' },
];

/** 제약 수준 — 의존 판정 정본은 도구가 아니라 FP 다. 한계 2번의 보상 근거를 화면이 직접 표기한다. */
export const DEPENDENCY_SOT_COMPENSATION =
  '도구에 Flag·Variant 의존성 판정이 없으므로 구성·의존관계 정본은 C03 BOM 이, 평가는 C14 Topology·Capability 가 소유한다. 검증 증적은 도구 판정이 아니라 FP 정본 시험이다.';

// ════════════════════════════════════════════════════════════════════════════
// 6. 사용 · 미사용 판정
// ════════════════════════════════════════════════════════════════════════════

export type UlUsageVerdict = '사용' | '조건부 사용' | '부트스트랩 한정' | '미사용' | '미사용(기본 OFF)';

export interface UlUsageRow {
  feature: string;
  edition: string;
  verdict: UlUsageVerdict;
  reason: string;
  /** 미사용·제한 기능의 대체 소유 Core. */
  replacedBy?: string;
}

export const UL_USAGE: UlUsageRow[] = [
  { feature: 'Feature Flag · 활성화 전략 · Stickiness', edition: '제공', verdict: '사용', reason: '정의 수집 원천(UL-OSS-04)' },
  { feature: 'SDK · Client API', edition: '제공', verdict: '사용', reason: '평가는 차량 로컬 서명본(C16·C17)' },
  { feature: 'Admin API', edition: '제공', verdict: '조건부 사용', reason: '수집 전용, 발행 정본 아님' },
  { feature: 'Playground', edition: '제공', verdict: '조건부 사용', reason: '운영자 검토 전용, 발행 판단 근거 아님' },
  { feature: 'Export · Import', edition: '제공', verdict: '부트스트랩 한정', reason: '정본은 FP 저장소(C08)' },
  { feature: 'Impression data', edition: '제공', verdict: '미사용(기본 OFF)', reason: 'BD-13 결정', replacedBy: 'C23 · C25 · C38' },
  { feature: 'Webhook', edition: '제공', verdict: '미사용', reason: '변경 통보는 수집 어댑터(C33)가 담당', replacedBy: 'C33 데이터 동기화' },
  { feature: 'Terraform Provider', edition: '제공', verdict: '미사용', reason: '정의 변경은 FP 승인 절차로만 수행', replacedBy: 'C01 Feature Registry' },
  { feature: 'Edge', edition: '제공(종료 예정)', verdict: '미사용', reason: '종료 2026-12-31, 차량은 로컬 캐시', replacedBy: 'C17 로컬 정책 캐시' },
  { feature: 'Unleash Cloud', edition: '별도 상품', verdict: '미사용', reason: '사내 자체 호스팅 배치만 허용', replacedBy: 'C31 API Gateway' },
];

// ════════════════════════════════════════════════════════════════════════════
// 7. 검증 상태 — NOT_RUN 은 완료 표기가 아니다 (QC-UL-05 · GAP-16)
// ════════════════════════════════════════════════════════════════════════════

export type UlVerifyState = 'NOT_RUN' | 'NOT_RECORDED';

export interface UlVerifyRow { item: string; ko: string; state: UlVerifyState; note: string }

export const UL_VERIFICATION: UlVerifyRow[] = [
  { item: 'imageBuild', ko: '이미지 빌드', state: 'NOT_RUN', note: 'GitHub 소스 로컬 빌드 미실행' },
  { item: 'dockerRun', ko: '이미지 기동', state: 'NOT_RUN', note: '컨테이너 기동 미실행' },
  { item: 'vehicleApply', ko: '차량 적용', state: 'NOT_RUN', note: '차량 탑재 미실행' },
  { item: 'productServerIntake', ko: '제품 서버 반입', state: 'NOT_RUN', note: '반입 미실행' },
  { item: 'userAcceptance', ko: '사용자 인수', state: 'NOT_RUN', note: '인수 시험 미실행' },
  { item: 'legalApproval', ko: '법무 승인', state: 'NOT_RECORDED', note: 'AGPL-3.0-or-later 고지 의무 검토 기록 없음' },
];

export const UL_UNRUN_NOTICE =
  'NOT_RUN · NOT_RECORDED 는 완료 표기가 아니라 실행·승인 전 상태입니다. 설계 문장은 무료 에디션 기준으로 성립하지만 구현·시험 완료를 뜻하지 않습니다.';

export const ulVerificationComplete = (): boolean => UL_VERIFICATION.every(r => r.state !== 'NOT_RUN' && r.state !== 'NOT_RECORDED');

export const UL_GAP_REF = 'GAP-16 — 미수행 경계';
export const UL_DECISIONS = ['BD-19', 'BD-20', 'BD-21'];

// ════════════════════════════════════════════════════════════════════════════
// 8. 화면 경계 (QC-UL-07) — 이 앱이 지켜야 하는 선
// ════════════════════════════════════════════════════════════════════════════

export interface UlScreenBoundary {
  screenId: string;
  ko: string;
  group: string;
  scope: string;
}

export const UL_SCREEN_BOUNDARIES: UlScreenBoundary[] = [
  { screenId: 'UI18-S02', ko: 'Unleash 인스턴스', group: 'Control', scope: '도구 상태·연결만 본다 — 도구 관리자 UI 를 대신하지 않는다' },
  { screenId: 'UI30-S04', ko: 'Unleash 반영과 호환성', group: 'Quality', scope: '반영·호환성 검토만 한다 — 승인·발행을 대신하지 않는다' },
];

/** 도구 경계에서 금지되는 조작 — 화면은 이 문장을 그대로 표기한다. */
export const UL_FORBIDDEN_IN_UI = [
  '도구 관리자 UI·Playground 에서 승인·발행·Flag 전환을 수행하지 않는다',
  '표시값(화면에 보이는 평가값)을 판정 근거로 쓰지 않는다 — 판정 정본은 차량 로컬 서명 스냅샷(C17)과 C16 평가 결과',
  '도구 권한으로 FP 승인·발행을 우회하지 않는다',
  '도구 parent 관계를 Feature Topology 관계로 승격하지 않는다(TD §4.8)',
];

// ════════════════════════════════════════════════════════════════════════════
// 9. 연결 문서 · 도면
// ════════════════════════════════════════════════════════════════════════════

export const UL_LINKED_DOCS: { area: string; ko: string; value: string }[] = [
  { area: 'review', ko: '통합 검토 정본', value: 'FP_Unleash_OSS_Integration_Review_v1_0.html' },
  { area: 'architecture', ko: '아키텍처', value: 'AR-08-OS (AR-08-OS-1~6)' },
  { area: 'software', ko: '소프트웨어 상세설계', value: 'UL-DD-13 (UL-DD-13-1~3)' },
  { area: 'requirements', ko: '요구사항', value: 'FR-ULOSS-001~014 (05_기능요구사항)' },
  { area: 'interfaces', ko: '인터페이스', value: 'IF-FF-01~07 (21_External_Interface)' },
  { area: 'audit', ko: '감사', value: 'CHK-11·CHK-12 (26_Audit), CONS-09·CONS-10 (02_문서정합성)' },
  { area: 'quality', ko: '품질 기준', value: 'Document_Quality_Criteria_v1_0.md QC-UL-01~07' },
  { area: 'ledger', ko: '형상관리대장', value: '형상관리대장 No.140~' },
];

export const UL_DIAGRAMS: { ko: string; file: string }[] = [
  { ko: '배포 구성·통합 경계', file: 'appendices/diagrams/UNLEASH_OSS_Deployment_Integration.svg' },
  { ko: 'Flag 수명주기 흐름', file: 'appendices/diagrams/UNLEASH_OSS_Flag_Lifecycle_Flow.svg' },
];

export const UL_AUDIT_JSON = 'appendices/verification/Current_Unleash_OSS_Integration_Audit_v1_0.json';
export const UL_AUDIT_CHECK_COUNT = 26;

// ════════════════════════════════════════════════════════════════════════════
// 10. 리뷰 집계 — 화면 머리말이 쓰는 값
// ════════════════════════════════════════════════════════════════════════════

export interface UlSummary {
  contracts: number;
  interfaces: number;
  unusedInterfaces: number;
  limits: number;
  usageRows: number;
  unusedUsage: number;
  notRun: number;
  notRecorded: number;
  criteria: number;
  compensationCores: string[];
}

/**
 * `compensates` 는 `·` 로 이어 붙인 문자열이라 Core 이름 안의 `·` 와 구분되지 않는다.
 * Core 코드로 시작하는 항목만 남기고 그 경계에서만 쪼갠다 — 보상 책임 없는 조각을 만들지 않는다.
 */
export function compensationCoreList(limits: UlLimit[] = UL_LIMITS): string[] {
  const cores = new Set<string>();
  for (const l of limits) {
    for (const entry of l.compensates.split(/\s*·\s*(?=C\d{2}(?:\s|$))/)) {
      const trimmed = entry.trim();
      if (/^C\d{2}\s/.test(trimmed)) cores.add(trimmed);
    }
  }
  return [...cores];
}

export function ulSummary(): UlSummary {
  return {
    contracts: UL_CONTRACTS.length,
    interfaces: UL_INTERFACES.length,
    unusedInterfaces: UL_INTERFACES.filter(i => i.unused).length,
    limits: UL_LIMITS.length,
    usageRows: UL_USAGE.length,
    unusedUsage: UL_USAGE.filter(u => u.verdict.startsWith('미사용')).length,
    notRun: UL_VERIFICATION.filter(v => v.state === 'NOT_RUN').length,
    notRecorded: UL_VERIFICATION.filter(v => v.state === 'NOT_RECORDED').length,
    criteria: UL_CRITERIA.length,
    compensationCores: compensationCoreList(),
  };
}

export const UL_SUMMARY: UlSummary = ulSummary();
