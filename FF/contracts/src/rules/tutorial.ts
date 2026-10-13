// "표준 따라하기" 시나리오 표 — 보고서 v1.1 18장 케이스 시나리오를 실제 화면에서 따라 하며 규칙·근거 조항이 어디서 어떻게 동작하는지 본다.
// 화면(가이드 패널·스포트라이트)과 백엔드 러너(F1)가 같은 표를 쓴다. 단계는 실제 라우트와 화면의 data-tour 앵커를 가리킨다(시험이 존재를 검사한다).
export type TutorialTrack = 'VIRTUAL' | 'DESIGN' | 'KILL' | 'MARKET' | 'SECURITY' | 'OPERATE';
/** 보고서 1.7 읽기 경로 */
export type ReadingPath = 'BASIS' | 'DESIGN' | 'BUILD' | 'VERIFY_OPERATE';
/** observe = 화면을 보고 이해 · act = 실제로 조작 · fail = 일부러 규칙을 어겨 거부를 확인 */
export type StepKind = 'observe' | 'act' | 'fail';

export interface TutorialStep {
  id: string;
  kind: StepKind;
  title: string;
  /** 지금 할 일 */
  doKo: string;
  /** 왜 — 이 단계가 보여 주는 안전 논리 */
  whyKo: string;
  /** 이 단계를 맡는 화면 역할(레거시 9역할 키, api/actor.ts) — 다르면 역할 전환 배너 */
  role: string;
  /** 실제 화면 경로 */
  route: string;
  /** 스포트라이트 대상 data-tour 값 */
  anchor: string;
  /** 강조 대상의 이름 — "어디서"에 보인다 */
  targetKo: string;
  /** 보고서 규칙 ID — 근거 조항은 규칙의 '근거' 필드에서 */
  rules: string[];
  /** 보고서 시험 카탈로그 ID(있으면) */
  tests?: string[];
  /** 확인할 결과(보기 모드에서는 기대 결과 설명, F1부터 백엔드가 근거로 판정) */
  expectKo: string;
  /** 아직 플랫폼·vECU에 없는 동작 — 화면에 '준비 중'으로 보인다 */
  pendingKo?: string;
}

export interface Tutorial {
  id: string;
  /** 보고서 18.6 케이스 시나리오 번호(있으면) */
  cs?: string;
  track: TutorialTrack;
  readingPath: ReadingPath;
  title: string;
  summaryKo: string;
  minutes: number;
  /** 보고서 18.6 "적용 전 → 적용 후" */
  before?: string;
  after?: string;
  /** ready = 단계가 있다 · planned = 다음 단계에서 만든다 */
  status: 'ready' | 'planned';
  /** 대표 규칙(카드에 보이는 것) */
  rules: string[];
  steps: TutorialStep[];
}

const FEAT = '/features/FEAT-00022/1.0.0';

export const TUTORIALS: Tutorial[] = [
  {
    id: 'CS-01',
    cs: 'CS-01',
    track: 'VIRTUAL',
    readingPath: 'VERIFY_OPERATE',
    title: '거리 추정 오류 — 차량 내 감지 대 원격 Kill',
    summaryKo: 'FEAT-00022(전방 안전거리)의 거리 추정이 서서히 틀어질 때, 원격 Kill만 믿으면 위험 구간이 남고 차량 내 감지가 있으면 FTTI 안에 효과를 거둔다는 것을 vECU 가상검증으로 확인합니다.',
    minutes: 15,
    before: '원격 경로 — 위험 구간 26초, 운영자가 48초에 Kill. 즉시 정지형 Kill이면 새 Hazard',
    after: '차량 내 감지 19.11초, BASE_ONLY 20.61초 — FTTI 22.00초보다 1.39초 앞섬, 클라우드 관여 없음',
    status: 'ready',
    rules: ['FFG-DEAC-001', 'FFG-LCY-006', 'FFG-TST-006', 'FFG-TST-009'],
    steps: [
      {
        id: 'intro',
        kind: 'observe',
        title: '무엇을 확인하나',
        doKo: '적용 전·후 비교 표를 읽고 이 시나리오의 질문을 확인하세요: "원격 Kill이 안전기제가 될 수 있는가?"',
        whyKo: '원격 Kill은 통신·운영자 판단을 거치는 요청일 뿐 안전기제가 아닙니다. F2 이상 Feature는 차량 안에서 고장을 감지해 FTTI 안에 효과를 거둬야 합니다.',
        role: 'author',
        route: '/learn/CS-01',
        anchor: 'learn-compare',
        targetKo: '가이드 적용 전·후 표',
        rules: ['FFG-DEAC-001', 'FFG-LCY-006'],
        expectKo: '두 경로의 차이를 위험 구간·감지 시각·FTTI 여유로 설명할 수 있다',
      },
      {
        id: 'classify',
        kind: 'observe',
        title: 'Feature 분류 확인',
        doKo: 'FEAT-00022 상세의 안전 분류 탭에서 F3 · DC2 · R1과 인계·램프 시간을 확인하세요. 확정(개인 서명)된 분류라 고칠 수 없습니다.',
        whyKo: '처리강도 F3(ASIL C/D 영향 가능)는 2인 승인·강화 V&V를, DC2는 경고 → 인계 시간 → 효과 점진 감소를 요구합니다. 조합 위반이 있으면 G1부터, 확정 전이면 G2부터 통과할 수 없습니다.',
        role: 'author',
        route: `${FEAT}?tab=safety`,
        anchor: 'safety-tab',
        targetKo: 'Feature 상세 › 안전 분류 탭',
        rules: ['FFG-CLS-001', 'FFG-CLS-004', 'FFG-CLS-009'],
        expectKo: 'F·DC·R·Flag 유형 네 축과 DC2의 인계·램프 시간, 확정 뒤 변경은 새 Version이라는 점을 말할 수 있다',
      },
      {
        id: 'tool',
        kind: 'observe',
        title: 'vECU 연결과 도구 신뢰성',
        doKo: 'vECU 가상검증 화면에서 시뮬레이터 연결 상태를 확인하세요.',
        whyKo: '시뮬레이션 결과를 합격 판정에 쓰면 시뮬레이터·실행 어댑터·판정 스크립트를 ISO 26262-8 cl.11로 분류해야 합니다. 거짓 PASS를 낼 수 있으므로 TI2입니다.',
        role: 'author',
        route: '/validations/virtual',
        anchor: 'vecu-status',
        targetKo: 'vECU 연결 상태',
        rules: ['FFG-TST-006', 'FFG-PLT-013'],
        expectKo: '연결된 도구와 qualification 상태(미실시 → 엔지니어링 Evidence)를 구분한다',
        pendingKo: '도구 분류·재현 정보를 보여 주는 "가상 시험 신뢰성" 패널은 화면 개편 때 추가됩니다',
      },
      {
        id: 'run-remote',
        kind: 'act',
        title: '원격 Kill 경로 실행',
        doKo: '정책을 고르고 [가상검증 실행]을 누르세요. 오류 17초 → 운영자 Kill 48초 시나리오가 함께 돕니다.',
        whyKo: '시험 결과는 Feature Version·정책 내용과 연결되고 재현 정보(도구 Version·시나리오·파라미터)를 가져야 G5 근거가 됩니다.',
        role: 'author',
        route: '/validations/virtual',
        anchor: 'virtual-run',
        targetKo: '[가상검증 실행] 버튼',
        rules: ['FFG-TST-009'],
        tests: ['TC-FF-21'],
        expectKo: '실행 기록(VV-)이 생기고 시나리오별 판정이 나온다',
      },
      {
        id: 'read-result',
        kind: 'observe',
        title: '결과 읽기 — 위험 구간은 알려진 실패',
        doKo: '오류+Kill 실행을 열어 위험 시간과 판정 기준을 보세요.',
        whyKo: 'Kill 경로 기준만 통과해도 위험 구간이 남으면 FTTI를 넘은 것입니다. 실패를 "알려진 실패"로 남긴 채 G5를 통과시키지 않습니다.',
        role: 'author',
        route: '/validations/virtual',
        anchor: 'virtual-runs',
        targetKo: '실행 기록 표 › 오류+Kill 행',
        rules: ['FFG-TST-009', 'FFG-DEAC-001'],
        expectKo: '위험 시간이 0이 아니면 이 결과는 안전 근거가 아니라는 것을 확인한다',
        pendingKo: '지금 플랫폼은 이 실행을 Gate PASS로 셉니다 — 차량 내 감지 시나리오가 들어오면 원격 경로는 판정이 아닌 비교 기준선이 됩니다',
      },
      {
        id: 'onboard',
        kind: 'observe',
        title: '차량 내 감지 시나리오',
        doKo: 'vECU 시뮬레이터에서 같은 고장을 차량 내 감지로 처리하는 장면을 봅니다.',
        whyKo: '감시 로직이 19.11초에 고장을 확정하고 Guard가 20.61초에 기본 기능으로 돌립니다. FHTI = FDTI + Guard 주기 + fault_ramp + 변화율 제한 + 액추에이터 응답 ≤ FTTI(보고서 7.4).',
        role: 'author',
        route: '/validations/virtual',
        anchor: 'vecu-link',
        targetKo: '[vECU 시뮬레이터 열기] 링크',
        rules: ['FFG-LCY-006'],
        tests: ['TC-FF-21'],
        expectKo: '감지 시각 ≤ FTTI, FHTI 여유가 양수',
        pendingKo: 'vECU에는 아직 차량 내 감지와 DC2 단계(경고 → 인계 → 램프)가 없습니다 — 추가 예정',
      },
      {
        id: 'g5',
        kind: 'observe',
        title: 'TMS 제출 → G5 판정',
        doKo: 'Gate 탭에서 G5 Verification Gate의 근거를 확인하세요.',
        whyKo: 'Gate 결정은 서명된 기록이며 입력이 없거나 도구 오류가 있으면 FAIL(fail-closed)입니다. G5는 Feature에 연결되지 않았거나 재현 정보가 없는 시험을 인정하지 않습니다.',
        role: 'quality',
        route: `${FEAT}?tab=gates`,
        anchor: 'gate-g5',
        targetKo: 'Gate 레일 › G5 Verification Gate',
        rules: ['FFG-TST-009', 'FFG-LCY-001', 'FFG-LCY-002'],
        expectKo: 'G5 근거로 인정되는 실행과 아닌 실행을 구분한다',
      },
    ],
  },
  ...planned([
    ['CLASSIFY-GATE', undefined, 'DESIGN', 'DESIGN', '분류·Gate — FEAT-00022 v1.1 출시', '분류 확정 → ramp 3→4초 변경은 새 Version → 조합 시험 FAIL → 수정 → PASS → 법규 서명 → Canary 100대(보고서 6.3.1)', ['FFG-CLS-001', 'FFG-CLS-004', 'FFG-TST-003', 'FFG-LCY-009']],
    ['KILL-DC2', undefined, 'KILL', 'BUILD', '안전 Kill DC2 — 요청 → 2인 승인 → 차량 단계 → 복원', '요청자는 승인할 수 없고, 차량은 경고 → 인계 → 램프 → DISABLED로 간다. 복원은 다른 2인이 승인한다', ['FFG-PLT-005', 'FFG-PLT-016', 'FFG-PLT-017', 'FFG-DEAC-008']],
    ['CS-02', 'CS-02', 'MARKET', 'DESIGN', '주행 중 체험권 만료', '상업 사유는 DC3 — 다음 시동에 INACTIVE, 사전 고지', ['FFG-DEAC-004', 'FFG-PLT-006']],
    ['CS-03', 'CS-03', 'SECURITY', 'BUILD', '위조·재전송·대량 Kill', '차량에서 거부, 24시간 누적 상한, 보안 이벤트', ['FFG-SEC-003', 'FFG-SEC-007', 'FFG-TEL-003']],
    ['CS-07', 'CS-07', 'MARKET', 'BASIS', 'AEB 원격 OFF 시도 · 중국 신고 누락(CS-05)', 'DC4는 플랫폼·차량 이중 거부, 중국은 신고 ID·사용자 확인을 게이트가 강제', ['FFG-PLT-004', 'FFG-DEAC-011', 'FFG-PLT-009', 'FFG-GEN-003']],
    ['CS-04', 'CS-04', 'OPERATE', 'BUILD', '부분 배포와 Flag ID 재사용', 'ID 재사용 금지, 실제 구성 Attestation', ['FFG-CODE-020', 'FFG-VEH-007']],
    ['CS-06', 'CS-06', 'MARKET', 'VERIFY_OPERATE', '미국 OTA 조용한 수정', '안전 Kill은 리콜 번호·봉쇄 근거와 연계', ['FFG-DEAC-010']],
    ['CS-08', 'CS-08', 'OPERATE', 'VERIFY_OPERATE', 'SOTIF 터널·강우 트리거 조건', 'ODD 축소 정책도 새 Version·비활성화 등급을 따른다', ['FFG-SOT-002', 'FFG-SOT-003']],
    ['CS-09', 'CS-09', 'SECURITY', 'VERIFY_OPERATE', '협력사 라이브러리 결함', 'SBOM·VEX로 영향 Feature·차량 특정 → 보안 Kill', ['FFG-SBOM-003', 'FFG-SEC-006']],
    ['CS-10', 'CS-10', 'KILL', 'VERIFY_OPERATE', 'ADS 기능 원격 종료', 'fallback 완료까지 권한 유지, 해제 전 재활성화 금지, DSSAD 기록', ['FFG-ADS-002', 'FFG-ADS-004', 'FFG-ADS-007']],
    ['CS-11', 'CS-11', 'DESIGN', 'BUILD', 'OpenFeature 기본값', 'F2 이상은 OpenFeature로 평가하지 않고 기본값은 Safe State', ['FFG-OFT-001', 'FFG-OFT-002', 'FFG-PLT-011']],
  ]),
];

function planned(rows: [string, string | undefined, TutorialTrack, ReadingPath, string, string, string[]][]): Tutorial[] {
  return rows.map(([id, cs, track, readingPath, title, summaryKo, rules]) => ({ id, cs, track, readingPath, title, summaryKo, minutes: 15, status: 'planned' as const, rules, steps: [] }));
}

export const tutorialById = (id: string) => TUTORIALS.find((t) => t.id === id);

/** 단계의 대표 화면 경로에서 쿼리를 뗀 경로 — 라우트 표와 비교할 때 */
export const stepPath = (s: Pick<TutorialStep, 'route'>) => s.route.split('?')[0];
