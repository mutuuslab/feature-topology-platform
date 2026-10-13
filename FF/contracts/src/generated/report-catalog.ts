// 생성 파일 — tools/guide-sync.ts가 harness/guide/catalog.json(보고서 v1.1 원고)에서 만든다. 손으로 고치지 않는다(guide:check가 잡는다).
import type { ReportRule, ReportTest } from '../rules/standards';

export const REPORT_RULES: readonly ReportRule[] = [
  {
    "id": "FFG-ADS-001",
    "title": "ADS 규정의 법적 지위와 최종 법문 확인",
    "level": "필수",
    "scope": [
      "법규 담당"
    ],
    "rule": "시장별 Profile에 UN GTR No. 26의 국내 도입 상태와 UN R185의 발효·적용 상태를 따로 기록한다. 제안문 조항을 인증 기준으로 쓰기 전에 최종 법문과 조항별로 대조한다.",
    "basis": "UN ADS GTR 제안문 Part I; UN R185",
    "verify": "Profile 감사. 합격: ADS 기능을 출시하는 시장마다 두 상태와 대조 기록이 있다",
    "section": "03_ads_regulation · 3.11 규칙"
  },
  {
    "id": "FFG-ADS-002",
    "title": "ADS Feature는 원격 종료가 가능해야 한다",
    "level": "필수",
    "scope": [
      "Registry",
      "Safety Manager"
    ],
    "rule": "ADS Feature는 DC4로 분류하지 않는다. 비활성화 등급과 원격 요청 경로(봉투, cmd_auth, Guard)를 갖춘다.",
    "basis": "UN ADS GTR 제안문 §4.1.4.4; ISO 26262-3:2018 cl.7",
    "verify": "Registry 검사. 합격: ADS 표시가 있는 Feature Version 중 DC4이거나 원격 경로가 없는 항목이 0건이다",
    "section": "03_ads_regulation · 3.11 규칙"
  },
  {
    "id": "FFG-ADS-003",
    "title": "원격 종료는 fallback을 포함하고 제어 공백을 만들지 않는다",
    "level": "필수",
    "scope": [
      "Safety Guard",
      "차량 SW"
    ],
    "rule": "DDT를 수행 중인 ADS Feature의 종료 요청을 수락하면 Guard는 ADS의 fallback 절차를 시작시킨다. 사용자 인계가 있는 기능(ADSF-1)은 비활성화 절차 완료 또는 MRC 도달, 운전자 없는 기능(ADSF-2)은 MRC 도달 신호를 받을 때까지 출력 권한을 유지한다. 타이머는 상한 감시로만 쓰고, 상한을 넘으면 MRC를 요구한다.",
    "basis": "UN ADS GTR 제안문 §4.1.4.4.1, §4.1.6.1, §4.2.2.3.6; ISO 26262-4:2018 cl.6",
    "verify": "HIL 시험(인계 성공, 인계 실패, 종료 중 ODD 이탈). 합격: 세 경우 모두 권한 상실 시점이 완료 신호 이후이고, 제어 주체가 없는 구간이 0 ms다",
    "section": "03_ads_regulation · 3.11 규칙"
  },
  {
    "id": "FFG-ADS-004",
    "title": "해제 전 재활성화 금지",
    "level": "필수",
    "scope": [
      "Safety Guard",
      "플랫폼"
    ],
    "rule": "원격 종료 상태는 RESTORE로만 해제한다. 재부팅, 통신 재연결, 오래된 정책 수신, SW 업데이트와 롤백, 영속 저장 손실로 종료 상태가 풀리지 않게 한다.",
    "basis": "UN ADS GTR 제안문 §4.1.4.4.2; ISO 26262-6:2018 cl.7",
    "verify": "단위시험 TC-FF-02, TC-FF-05, TC-FF-15~18, TC-FF-33, TC-FF-35, TC-FF-60과 시스템 시험 TC-FF-58(SW 업데이트·롤백, 오래된 정책). 합격: 다섯 경로 모두에서 해제 없이 ACTIVE가 된 경우가 0건이다",
    "section": "03_ads_regulation · 3.11 규칙"
  },
  {
    "id": "FFG-ADS-005",
    "title": "Flag는 ODD 판단을 대체하지 않는다",
    "level": "필수",
    "scope": [
      "차량 SW"
    ],
    "rule": "Guard의 ACTIVE와 구독 권한은 활성화 허가로만 쓴다. ADS는 ODD 조건과 고장 상태를 확인한 뒤에만 기능을 활성화한다.",
    "basis": "UN ADS GTR 제안문 §4.1.5.3, §4.1.4.3",
    "verify": "시나리오 시험(Guard ACTIVE + ODD 밖). 합격: 활성화가 일어난 경우가 0건이다",
    "section": "03_ads_regulation · 3.11 규칙"
  },
  {
    "id": "FFG-ADS-006",
    "title": "원격 종료의 권한과 절차를 시스템 설명에 기술",
    "level": "필수",
    "scope": [
      "법규 담당",
      "운영 조직"
    ],
    "rule": "원격 종료와 복원의 방법을 시스템 설명 문서에 기술한다. 이 보고서는 여기에 발동 사유, 승인자, 긴급 권한, 해제 기준, 시장별 차이를 더해 운영 절차와 같은 내용으로 적도록 정한다.",
    "basis": "UN ADS GTR 제안문 §5.3.1.12",
    "verify": "문서 검토. 합격: 위 다섯 항목이 모두 있고, 운영 절차와 시스템 설명의 내용이 일치한다",
    "section": "03_ads_regulation · 3.11 규칙"
  },
  {
    "id": "FFG-ADS-007",
    "title": "종료·복원 이벤트의 시간 기록과 보존",
    "level": "필수",
    "scope": [
      "Safety Guard",
      "플랫폼"
    ],
    "rule": "종료 수락, 비활성화 완료, MRC 도달, 복원 수락, 복원 효력 발생 시각을 신뢰 시간으로 기록한다. DSSAD의 비활성화 이벤트(시스템 시작)와 플랫폼 명령 ID를 연결해 보존한다.",
    "basis": "UN ADS GTR 제안문 §5.4.6, Annex 6 §5.2.1",
    "verify": "통합 시험과 기록 감사. 합격: 표본 종료 건 100%에서 다섯 시각과 명령 ID가 연결된다",
    "section": "03_ads_regulation · 3.11 규칙"
  },
  {
    "id": "FFG-ADS-008",
    "title": "Safety Case의 주장·논거·증거 식별",
    "level": "필수",
    "scope": [
      "Safety Manager"
    ],
    "rule": "ADS Safety Case의 주장마다 논거를 하나 이상, 논거마다 증거를 하나 이상 두고, 모두에 고유 식별자를 붙인다. 이 보고서의 규칙 ID와 시험 ID를 식별자로 재사용한다.",
    "basis": "UN ADS GTR 제안문 §5.3.3.1, §5.3.3.1.1, §5.3.3.1.2",
    "verify": "Safety Case 추적성 분석. 합격: 논거 없는 주장과 증거 없는 논거가 각각 0건이다",
    "section": "03_ads_regulation · 3.11 규칙"
  },
  {
    "id": "FFG-ADS-009",
    "title": "시험 재현 정보 기록",
    "level": "필수",
    "scope": [
      "시험 조직"
    ],
    "rule": "각 시험 실행에 SW·HW 버전, 도구 버전, 시나리오, 파라미터, Feature Version, Flag 상태를 기록한다. 당국 요청 시 도구와 분석 SW를 실행할 수 있게 한다.",
    "basis": "UN ADS GTR 제안문 §5.3.3.9.3, §5.3.3.9.3.1",
    "verify": "재현 시험(표본 실행을 기록만으로 재실행). 합격: 표본 결과가 수용 기준 안에서 일치한다",
    "section": "03_ads_regulation · 3.11 규칙"
  },
  {
    "id": "FFG-ADS-010",
    "title": "폐기 후 활성화 방지",
    "level": "필수",
    "scope": [
      "플랫폼",
      "Safety Guard"
    ],
    "rule": "ADS Feature를 폐기하면 해당 Feature Version을 영구 DISABLED로 만들고, 명령 키를 폐기하고, Catalog에서 퇴역시킨다. 폐기된 Feature에는 RESTORE를 발행할 수 없다.",
    "basis": "UN ADS GTR 제안문 §5.3.2.16(e)",
    "verify": "게이트 단위시험(폐기 Feature에 RESTORE). 합격: 주문이 FAIL이다",
    "section": "03_ads_regulation · 3.11 규칙"
  },
  {
    "id": "FFG-ADS-011",
    "title": "대량 원격 종료 계획",
    "level": "필수",
    "scope": [
      "운영 조직",
      "Safety Manager"
    ],
    "rule": "대량 종료 전에 결함 위험도와 노출을 평가하고 발행 순서를 계획한다. 플랫폼 상한을 넘는 주문은 Safety Manager와 CSM이 함께 승인한다.",
    "basis": "UN ADS GTR 제안문 §2.19, §4.1.4.4.1",
    "verify": "운영 훈련(연 1회 대량 종료 모의). 합격: 계획서, 이중 승인, 발행 기록이 모두 남는다",
    "section": "03_ads_regulation · 3.11 규칙"
  },
  {
    "id": "FFG-ADS-012",
    "title": "Safety Case 독립 검토와 기록",
    "level": "필수",
    "scope": [
      "Safety Manager",
      "품질 조직"
    ],
    "rule": "ADS Safety Case는 인증·승인 전에 편향 없는 검토자가 검토한다. 검토 기록에는 검토자 자격, 검토 기간, Safety Case·도구·ADS의 Version, 검토 방법, 재현한 증거 목록, 공백과 불확실한 영역을 넣는다. 발견사항의 개선 조치도 기록한다.",
    "basis": "UN ADS GTR 제안문 §5.3.4.1, §5.3.4.2, §5.3.4.4, §5.3.4.5",
    "verify": "검토 기록 감사. 합격: 다섯 항목 중 빠진 것 0건, 조치 기록 없는 발견사항 0건",
    "section": "03_ads_regulation · 3.11 규칙"
  },
  {
    "id": "FFG-CLS-001",
    "title": "모든 Feature Version은 네 축으로 분류",
    "level": "필수",
    "scope": [
      "Registry",
      "Safety Manager"
    ],
    "rule": "F 등급, 비활성화 등급, 법규 등급, Flag 유형이 비어 있는 Feature Version은 G1을 통과할 수 없다.",
    "basis": "ISO 26262-8:2018 cl.7; ISO 26262-6:2018 Annex C",
    "verify": "Registry 등록 검사. 합격: 네 속성 중 하나라도 비어 있는 Version의 G1 통과가 0건이다",
    "section": "05_classification · 5.8 규칙"
  },
  {
    "id": "FFG-CLS-002",
    "title": "안전 관련 Flag는 사용 SW의 ASIL을 상속",
    "level": "필수",
    "scope": [
      "차량 SW",
      "플랫폼"
    ],
    "rule": "안전 관련 거동을 바꾸는 Flag 값과 그 생성·전달 경로는 그 Flag를 쓰는 SW의 최고 ASIL을 상속한다. 아래 조건을 모두 만족할 때만 예외로 한다.\n- 원격 경로는 차량에 미리 탑재되어 Annex C에 따라 검증된 구성 집합의 선택(활성화·비활성화·복원)만 전달한다.\n- Safety Guard가 진위(cmd_auth), 대상, Version, 등급, 순번, 시간을 독립적으로 검증한다.\n- 소비 기능이 값의 범위와 변화율을 스스로 제한한다(FFG-CODE-021).\n- 생성 경로 컴포넌트는 ISO 26262-8 cl.11에 따라 신뢰도를 확보한다(8.1절).\n- 연속 파라미터 값(보정 데이터)을 원격으로 바꾸는 Flag는 이 예외를 쓸 수 없다.",
    "basis": "ISO 26262-6:2018 Annex C; ISO 26262-9:2018 cl.6, cl.7; ISO 26262-8:2018 cl.11",
    "verify": "아키텍처 검토와 FFI 분석. 합격: 예외를 적용한 Flag마다 다섯 조건의 Evidence가 연결되고, 보정 데이터 Flag의 예외 적용이 0건이다",
    "section": "05_classification · 5.8 규칙"
  },
  {
    "id": "FFG-CLS-003",
    "title": "F 등급 하향은 재분석 없이는 금지",
    "level": "필수",
    "scope": [
      "Safety Manager"
    ],
    "rule": "Topology에서 위험 전파(propagates_risk_to) 관계가 있는 Feature의 F 등급은 영향 재분석과 Safety Manager 승인 없이 낮출 수 없다.",
    "basis": "ISO 26262-8:2018 cl.8",
    "verify": "변경 요청 기록 감사. 합격: F 등급 하향 건 100%에 재분석 보고서와 승인이 있다",
    "section": "05_classification · 5.8 규칙"
  },
  {
    "id": "FFG-CLS-004",
    "title": "비활성화 등급과 Safe State는 Feature Version에 고정",
    "level": "필수",
    "scope": [
      "Registry",
      "차량 SW"
    ],
    "rule": "비활성화 등급, 인계·감소 시간, Safe State, 끝 상태는 Feature Version의 승인된 속성이다. 값을 바꾸려면 새 Version을 만들고 G2~G5를 다시 거친다.",
    "basis": "ISO 26262-3:2018 cl.7; ISO 26262-6:2018 Annex C",
    "verify": "Registry 불변성 검사. 합격: RELEASED Version의 해당 속성 변경 시도가 모두 거부된다",
    "section": "05_classification · 5.8 규칙"
  },
  {
    "id": "FFG-CLS-005",
    "title": "법규 의무 기능은 DC4·R2",
    "level": "필수",
    "scope": [
      "법규 담당"
    ],
    "rule": "시장 Profile에 정의된 의무 기능과 안전기제는 DC4·R2로 분류한다. 대상은 EU GSR의 ISA·DDAW·ADDW·AEBS·ELKS·EDR, 미국 FMVSS 127 AEB, 시장별 의무 기능이다. DC4 Feature는 런타임 Flag State Machine으로 관리하지 않는다. Guard 설정에 포함되면 초기 상태는 설계 기본 동작(ACTIVE)이다. 원격 비활성화·활성화·복원 요청은 모두 거부한다. NvM이나 RAM 오류 시에도 기본 동작을 유지하고 DTC만 기록한다.",
    "basis": "EU 2019/2144 Art.6·7; FMVSS 127 S5.4.2; 49 U.S.C. 30122; ISO 26262-3:2018 cl.7",
    "verify": "Profile 대조와 단위시험 TC-FF-13, TC-FF-34. 합격: 의무 기능 중 DC4가 아닌 항목 0건, DC4 요청 수락 0건, 오류 후 기본 동작 이탈 0건",
    "section": "05_classification · 5.8 규칙"
  },
  {
    "id": "FFG-CLS-006",
    "title": "안전 거동의 A/B 실험 금지",
    "level": "필수",
    "scope": [
      "플랫폼",
      "Feature Owner"
    ],
    "rule": "F2 이상 Feature에는 Experiment Flag를 쓰지 않는다. 실차 비교는 출력이 제어기에 전달되지 않는 Shadow Mode로만 하고, 비간섭을 설계와 시험으로 입증한다.",
    "basis": "ISO 21448:2022 cl.13; ISO 26262-6:2018 Annex D",
    "verify": "정책 게이트 시험과 아키텍처 검토. 합격: F2 이상 Experiment Flag 등록 시도가 모두 거부되고, Shadow Mode마다 비간섭 시험 결과가 있다",
    "section": "05_classification · 5.8 규칙"
  },
  {
    "id": "FFG-CLS-007",
    "title": "Entitlement는 안전 Kill을 해제하지 못함",
    "level": "필수",
    "scope": [
      "플랫폼",
      "차량 SW"
    ],
    "rule": "구독·체험권 같은 사용 권한 변경은 DISABLED 상태를 해제할 수 없다. 해제는 7.8절의 복원 절차로만 한다.",
    "basis": "ISO 26262-8:2018 cl.8",
    "verify": "단위시험 TC-FF-15. 합격: DISABLED 상태의 ACTIVATE가 STATE_NOT_ALLOWED로 거부된다",
    "section": "05_classification · 5.8 규칙"
  },
  {
    "id": "FFG-CLS-008",
    "title": "Flag 만료와 은퇴 계획",
    "level": "필수",
    "scope": [
      "Feature Owner"
    ],
    "rule": "Release와 Experiment Flag에는 등록 시 만료일과 은퇴 계획을 둔다. 만료 30일 전에 Feature Owner에게 알리고, 만료된 Flag는 은퇴 절차(6.5절)로 넘긴다.",
    "basis": "ISO 26262-8:2018 cl.8; Knight Capital",
    "verify": "Registry 만료 보고서 감사. 합격: 만료일이 없거나 만료 후 30일이 지나도 은퇴 절차에 들어가지 않은 Flag가 0건이다",
    "section": "05_classification · 5.8 규칙"
  },
  {
    "id": "FFG-CLS-009",
    "title": "비활성화 등급과 F 등급·프로파일의 정합",
    "level": "필수",
    "scope": [
      "Registry",
      "플랫폼 게이트",
      "Safety Guard"
    ],
    "rule": "DC0은 F0과, 영향 분석으로 확인한 F1에만 지정한다. 아래 프로파일 값은 0보다 커야 한다.\n- DC2: takeover_ms, ramp_ms\n- F2~F4(DC4 제외): fault_ramp_ms\n- DC1: max_pending_ms\n- DC1~DC3: max_cycle_wait_ms\nRegistry 등록 검사, 정책 게이트, Guard 초기화가 각각 이 조합을 검사한다. 위반한 Feature Version은 차단하고, Guard는 해당 Feature를 FAULT로 시작한다.",
    "basis": "ISO 26262-3:2018 cl.7; ISO 26262-6:2018 Annex C",
    "verify": "게이트 시험과 단위시험 TC-FF-23. 합격: 위반 조합 6종이 게이트에서 모두 FAIL이고, Guard에서 모두 FAULT로 시작한다",
    "section": "05_classification · 5.8 규칙"
  },
  {
    "id": "FFG-CODE-001",
    "title": "언어 서브셋과 준수 체계",
    "level": "필수",
    "scope": [
      "C",
      "C++ / 전 ASIL"
    ],
    "rule": "C는 MISRA C:2025, C++는 MISRA C++:2023을 적용한다. 프로젝트 시작 시 OEM과 GRP를 합의하고, 10.2.2절의 재분류를 포함한다.",
    "basis": "ISO 26262-6:2018 Table 1 1b; MISRA Compliance:2020; MISRA C:2025; MISRA C++:2023",
    "verify": "GEP에 명시한 도구의 정적 분석과 GCS 검토. 합격: Mandatory 위반 0건, 일탈 기록 없는 Required 위반 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-002",
    "title": "경계 데이터는 고정폭 정수형",
    "level": "필수",
    "scope": [
      "C",
      "C++"
    ],
    "rule": "모듈·ECU·파티션 경계를 넘는 데이터, 영속 저장 데이터, 프레임 필드, 출력 구조체 필드는 `uint8_t`~`uint32_t` 같은 고정폭 타입만 쓴다. 열거형과 `bool`을 경계 구조체 필드로 쓰지 않는다. 크기와 표현이 구현에 따라 다르기 때문이다.",
    "basis": "MISRA C:2025 Dir 4.6; ISO 26262-6:2018 Table 1 1c",
    "verify": "정적 분석과 구조체 검토. 합격: 경계 구조체(FfGuardOutput, FfAttestedStatus, FfNvRecord, FfResponse)에 고정폭이 아닌 필드 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-003",
    "title": "초기화 이후 동적 메모리 금지",
    "level": "필수",
    "scope": [
      "C",
      "C++ / ASIL A~D",
      "실행 단계"
    ],
    "rule": "`malloc`, `new`, 동적 컨테이너 증가를 금지한다. 필요한 용량은 `std::array` 같은 고정 용량으로 확보한다.",
    "basis": "ISO 26262-6:2018 Table 6 1b; MISRA C:2025 Dir 4.12, Rule 21.3; MISRA C++:2023 Rule 21.6.1; AUTOSAR RS_AP_00129",
    "verify": "정적 분석과 링크 맵 검사. 합격: 할당 함수 참조 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-004",
    "title": "재귀 금지, 반복 상한 보장",
    "level": "필수",
    "scope": [
      "C",
      "C++"
    ],
    "rule": "재귀를 쓰지 않는다. 모든 반복문은 컴파일 시 상한이 정해져야 한다. 정책 평가 로직도 같다.",
    "basis": "ISO 26262-6:2018 Table 6 1j; MISRA C:2025 Rule 17.2; MISRA C++:2023 Rule 8.2.10",
    "verify": "정적 분석(호출 그래프)과 WCET 분석. 합격: 호출 그래프의 순환 0건, 상한 없는 반복 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-005",
    "title": "안전 관련 코드값은 해밍 거리 부호화",
    "level": "필수",
    "scope": [
      "C",
      "C++ / F2~F4"
    ],
    "rule": "ECU·파티션 경계를 넘거나 비휘발 메모리에 저장되는 상태·권한·요청·결과·기록 값은 해밍 거리 4 이상인 `uint8_t` 코드로 표현한다. 필드마다 서로 다른 코드 집합을 쓴다(9.2절). 결과 코드는 두 집합을 쓰되 모든 거부 코드가 수락 코드와 거리 4 이상 떨어지게 한다. 정의되지 않은 값은 모두 무효로 처리한다. 코드값 매크로는 캐스트 없는 부호 없는 상수로 정의해 C와 C++ 어댑터에서 함께 쓴다.",
    "basis": "ISO 26262-6:2018 Table 1 1d, Annex C; ISO 26262-5:2018 Annex D",
    "verify": "단위시험 TC-FF-08(무효 코드 주입), TC-FF-43(거리 검사). 합격: 무효 코드 수락 0건, 최소 거리 4 이상",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-006",
    "title": "무효·미확인 값은 HARA Safe State로 처리",
    "level": "필수",
    "scope": [
      "C",
      "C++"
    ],
    "rule": "무효이거나, 알 수 없거나, 오래되었거나, 없는 Flag 값은 `false`가 아니라 해당 Feature Version의 HARA·FSC에 정의된 Safe State로 처리한다.",
    "basis": "ISO 26262-6:2018 Annex C, Table 1 1d; ISO 26262-3:2018 cl.7; MISRA C:2025 Dir 4.14",
    "verify": "단위시험 TC-FF-20과 결함 주입. 합격: 무효 권한·단계 코드에서 출력이 Safe State(기본 시간 간격)다",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-007",
    "title": "신뢰 경계에서 외부 입력 전체 검증",
    "level": "필수",
    "scope": [
      "C",
      "C++"
    ],
    "rule": "원격 요청은 아래 항목을 모두 검증한 뒤에만 사용한다. QM 측 검증 결과를 ASIL 측이 그대로 믿지 않는다.\n- E2E: 길이, Data ID, CRC, Counter\n- 진위: 백엔드 기원 cmd_auth를 HSM으로 검증(QM 측이 만든 값은 진위 근거가 아님)\n- 유효 시간\n- 대상: 차량·ECU·SW\n- Version, 반복 방지 순번",
    "basis": "ISO 26262-6:2018 Annex D; ISO/SAE 21434 cl.10; UN R155 Annex 5; MISRA C:2025 Dir 4.14; CWE",
    "verify": "단위시험 TC-FF-01~08, TC-FF-25. 합격: 항목별 변조 입력의 수락 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-008",
    "title": "주기당 1회 읽기, 불변 스냅샷 사용",
    "level": "필수",
    "scope": [
      "C",
      "C++"
    ],
    "rule": "소비 기능은 Flag와 Guard 출력을 주기 시작에 한 번만 읽어 `const` 사본으로 쓴다. 한 주기 안에서 다시 읽지 않는다.",
    "basis": "ISO 26262-6:2018 Table 6 1h, Table 1 1i",
    "verify": "코드 검토와 정적 분석. 합격: 한 주기 함수에서 같은 출력을 두 번 읽는 코드 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-009",
    "title": "구성 변경은 원자적으로 게시",
    "level": "필수",
    "scope": [
      "C",
      "C++"
    ],
    "rule": "Guard 출력은 MainFunction 끝에서 주기당 한 번만 게시한다. 이중 버퍼에 완성한 뒤 인덱스 하나를 바꾸고, 각 사본에 무결성 검사값을 붙인다. 소비자는 IOC(또는 seqlock·3중 버퍼)로 읽고, 검사값이 맞지 않는 사본은 Safe State로 대체한다. `volatile`은 메모리 배리어가 아니다. OnFrame, ReportLocalFault, GetAttestedStatus, MainFunction의 호출 컨텍스트는 같은 OS 태스크로 고정한다(AoU-11).",
    "basis": "ISO 26262-6:2018 Table 1 1i, Table 3, Annex D; MISRA C:2025 Rule 13.2",
    "verify": "코드 검토와 동시성 분석. 합격: 게시 지점 1곳, 다중 태스크 호출 경로 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-010",
    "title": "상태 변경은 비활성화 등급과 모드 경계에서만",
    "level": "필수",
    "scope": [
      "C",
      "C++ / F2~F4"
    ],
    "rule": "Flag 변경은 7장의 비활성화 등급(DC0~DC4)에 정해진 시점에만 효력이 생긴다. 제어 루프 실행 도중에 직접 바꾸지 않는다.",
    "basis": "ISO 26262-4:2018 cl.6; ISO 26262-6:2018 cl.7; UN R156 §7.2.2; UN R171 §5.4",
    "verify": "단위시험 TC-FF-09~14와 HIL. 합격: 등급이 정한 시점 밖의 효력 발생 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-011",
    "title": "Safe State와 비활성화 프로파일은 설계 시점 상수",
    "level": "필수",
    "scope": [
      "C",
      "C++"
    ],
    "rule": "비활성화 등급, 경고 시간, 감소 시간, 대기 상한, Safe State는 Feature Version별 `const` 설정으로 둔다. 원격 명령이 이 값을 고르거나 바꿀 수 없다. 명령에 실린 등급이 설정값과 다르면 거부한다.",
    "basis": "ISO 26262-6:2018 Annex C; ISO 26262-3:2018 cl.7",
    "verify": "단위시험 TC-FF-07. 합격: 등급 불일치 명령 수락 0건, 설정 표가 읽기 전용 영역에 배치된다",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-012",
    "title": "Kill·복원 상태는 이중화된 비휘발 메모리에 저장",
    "level": "필수",
    "scope": [
      "C",
      "C++ / F2~F4"
    ],
    "rule": "Kill과 복원 기록, 반복 방지 순번, key epoch, 순번 신뢰는 NvM 이중화 블록(CRC, 쓰기 검증)에 저장하고 롤백을 검출할 수 있게 한다(9.5절). EOL 이후 읽기에 실패하거나 기록이 없으면 Feature를 DISABLED로 시작하고 DTC를 남긴다. 순번 신뢰가 없으면 Kill과 승인된 RESTORE만 받는다. DC4 Feature는 NvM을 쓰지 않고 설계 기본 동작을 유지한다.",
    "basis": "ISO 26262-6:2018 Annex C; AUTOSAR",
    "verify": "단위시험 TC-FF-18, TC-FF-35, TC-FF-39. 합격: 기록 손실 후 ACTIVE 시작 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-013",
    "title": "안전 관련 RAM 데이터 보호",
    "level": "필수",
    "scope": [
      "C / ASIL C~D 필수",
      "ASIL B는 권장(미적용 시 근거 기록)"
    ],
    "rule": "Guard의 Feature별 런타임 레코드와 전역 레코드(최소 epoch, 보고 번호)를 CRC 서명 또는 반전 사본으로 보호하고, 모든 API 진입 시 비교한다. 게시된 출력 사본에도 검사값을 둔다. Feature 레코드가 불일치하면 해당 Feature를 FAULT로 보낸다. DC4 Feature는 설계 기본 동작을 다시 세운다. 전역 레코드가 불일치하면 최소 epoch를 영속 저장에서 다시 읽고 보고 번호를 멈춘다.",
    "basis": "ISO 26262-6:2018 Annex C, Annex D; ISO 26262-5:2018 Annex D",
    "verify": "결함 주입 시험 TC-FF-19, TC-FF-34, TC-FF-41. 합격: 주입한 비트 오류 100% 검출",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-014",
    "title": "열거형 switch는 모든 값을 명시",
    "level": "필수",
    "scope": [
      "C",
      "C++"
    ],
    "rule": "열거형 `switch`는 모든 열거자를 명시적으로 처리한다. `default`는 안전 경로로 가며, fall-through를 쓰지 않는다. 컴파일러 경고 `-Wswitch-enum`을 오류로 다룬다.",
    "basis": "MISRA C:2025 Rule 16.1, 16.4; MISRA C++:2023 Rule 9.4.2",
    "verify": "컴파일러 경고와 정적 분석. 합격: 경고 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-015",
    "title": "단일 진입·단일 출구",
    "level": "필수",
    "scope": [
      "C",
      "C++"
    ],
    "rule": "함수는 반환문을 하나만 둔다. MISRA C:2025에서 적용 해제된 Rule 15.5를 GRP에서 Required로 재지정한다.",
    "basis": "ISO 26262-6:2018 Table 6 1a; MISRA C:2025 Rule 15.5",
    "verify": "정적 분석. 합격: 반환문이 2개 이상인 함수 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-016",
    "title": "암묵적 형변환 금지",
    "level": "필수",
    "scope": [
      "C",
      "C++"
    ],
    "rule": "명시적 형변환과 `U` 접미사를 쓴다. 복합 식을 다른 essential type으로 캐스트하지 않는다. C++에서 `bool`과 정수 사이 변환을 금지한다.",
    "basis": "ISO 26262-6:2018 Table 6 1g; MISRA C:2025 Rule 10.1~10.8; MISRA C++:2023 Rule 7.0.1, 7.0.2",
    "verify": "정적 분석과 `-Wconversion -Wsign-conversion`. 합격: 경고 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-017",
    "title": "시간 계산은 wrap에 안전하게",
    "level": "필수",
    "scope": [
      "C",
      "C++"
    ],
    "rule": "타이머, 감소, 디바운스의 경과 시간은 부호 없는 단조 카운터의 차이(`now - start`)로만 계산한다. 메시지 유효기간(not_before, expires)은 예외로, FFG-VEH-004의 신뢰 UTC로만 비교한다.",
    "basis": "ISO 26262-6:2018 Table 1 1d; MISRA C:2025 Rule 1.3; CWE",
    "verify": "단위시험(카운터 wrap 직전 시작). 합격: wrap 전후 판정이 같다",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-018",
    "title": "컴파일 시점 변형은 STD_ON/STD_OFF 값 비교로",
    "level": "필수",
    "scope": [
      "C"
    ],
    "rule": "컴파일 시점 기능 스위치는 `#if (FEATURE_X == STD_ON)`처럼 값을 비교하고, 두 값을 모두 정의한다. `#ifdef`로 기능을 켜고 끄지 않는다. 시험용 훅도 같은 방식으로 두고, 양산 빌드에서는 deactivated code로 관리한다(FFG-CODE-019).",
    "basis": "AUTOSAR SWS BSW General; MISRA C:2025 Rule 20.9",
    "verify": "정적 분석. 합격: 기능 스위치에 `#ifdef` 사용 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-019",
    "title": "Dead code 제거, deactivated code는 근거와 함께",
    "level": "필수",
    "scope": [
      "C",
      "C++"
    ],
    "rule": "요구사항으로 추적되지 않는 코드(dead code)는 제거한다. 특정 구성에서만 쓰이지 않는 코드(deactivated code)는 그 메커니즘을 문서화하고, 의도치 않게 실행되지 않음을 분석과 시험으로 입증한다.",
    "basis": "MISRA C:2025 Rule 2.1, 2.2; MISRA C++:2023 Rule 0.0.1; ISO 26262-6:2018 Annex C; DO-178C",
    "verify": "커버리지 분석과 코드 검토. 합격: 추적되지 않는 미실행 코드 0건, deactivated code마다 근거 기록",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-020",
    "title": "Flag ID 재사용 금지, 은퇴한 Flag는 코드까지 제거",
    "level": "필수",
    "scope": [
      "C",
      "C++",
      "플랫폼"
    ],
    "rule": "은퇴한 Flag ID를 새 기능에 다시 쓰지 않는다. 은퇴가 승인되면 승인 후 6개월 또는 다음 정기 릴리스 중 이른 시점까지 관련 코드, 설정, 시험을 지운다.",
    "basis": "Knight Capital; ISO 26262-8:2018 cl.8",
    "verify": "Registry 감사와 정적 분석(미사용 ID 탐지). 합격: 재사용 ID 0건, 기한 초과 잔존 코드 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-021",
    "title": "소비 기능은 Flag 출처와 무관하게 출력 제한",
    "level": "필수",
    "scope": [
      "C",
      "C++ / F2~F4"
    ],
    "rule": "Flag 값이 무엇이든 소비 기능은 출력에 자체 변화율 제한과 물리 한계를 둔다. 예: 시간 간격 ≥ τmin, 감속·저크 한계. 갑작스러운 거동 변화를 막는 이중 방어선이다.",
    "basis": "ISO 15622; UN R171 §5.4; ISO 26262-6:2018 Table 1 1d",
    "verify": "단위시험 TC-FF-20과 HIL. 합격: 권한 급변 시 주기당 변화량이 한계 이하, 출력이 물리 한계 안",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-022",
    "title": "거부와 상태 전이는 사유 코드로 보고, 확인 전 성공 보고 금지",
    "level": "필수",
    "scope": [
      "C",
      "C++"
    ],
    "rule": "모든 거부, 상태 전이, NvM 실패는 사유 코드와 함께 DEM과 텔레메트리로 보고한다(9.3절 표). 상태는 적용됐지만 영속 작업이 거부되었으면 ACCEPTED_NOT_DURABLE로 보고한다. 영속 상태(DURABLE, PENDING, FAILED)는 따로 보고한다. 상태 보고는 Guard의 실제 상태와 Guard가 만든 state_auth만 담는다. 모르는 상태는 `UNKNOWN`이며, 안전 기본값으로 가정해 보고하지 않는다.",
    "basis": "ISO 26262-7:2018 cl.7; UN R155 §7.3.7; UN R160; MISRA C:2025 Rule 17.7, Dir 4.7",
    "verify": "단위시험 TC-FF-24, TC-FF-39와 스키마 검증. 합격: 확인되지 않은 상태의 성공 보고 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-023",
    "title": "C++ 안전 파티션에서 예외·RTTI 금지",
    "level": "필수",
    "scope": [
      "C++"
    ],
    "rule": "`-fno-exceptions -fno-rtti`로 빌드하고 함수는 `noexcept`로 둔다. 오류는 `Result<T,E>`로 전달한다. `optional`·`variant`에 확인 없이 접근하지 않는다.",
    "basis": "AUTOSAR RS_AP_00128; MISRA C++:2023 Rule 18.4.1, 18.5.2",
    "verify": "컴파일 옵션 형상 관리와 코드 검토. 합격: 예외·RTTI가 켜진 빌드 설정 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-024",
    "title": "C++ 열거형은 기반 타입을 명시한 enum class",
    "level": "필수",
    "scope": [
      "C++"
    ],
    "rule": "`enum class X : std::uint8_t` 형식만 쓴다. C 인터페이스 타입(C enum, C 구조체)은 경계 어댑터 번역 단위 하나(예제: cpp/src/lpc.cpp)에서만 쓰고 일탈로 관리한다(DEV-CPP-001). C 헤더는 `__cplusplus` 가드를 두어 C++에서 `extern \"C\"` 블록 없이 포함한다.",
    "basis": "MISRA C++:2023 Rule 10.2.1, 10.2.2, 6.0.3; ISO 26262-6:2018 Table 1 1c",
    "verify": "정적 분석. 합격: 어댑터 밖 C 타입 사용 0건, 범위 없는 열거형 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-025",
    "title": "외부 정책 파싱은 QM 파티션에서만",
    "level": "필수",
    "scope": [
      "C",
      "C++"
    ],
    "rule": "JSON·JWS 파싱과 서명 검증은 QM 파티션에서 한다. 이 코드는 퍼징과 Sanitizer 시험을 거친다. ASIL 측은 고정 레이아웃 바이너리 프레임만 받는다.",
    "basis": "ISO 26262-6:2018 Table 1 1a; ISO/SAE 21434 cl.10; CERT; CWE",
    "verify": "퍼징, ASan·UBSan, 아키텍처 검토. 합격: 퍼징 기간 동안 충돌·Sanitizer 경고 0건, ASIL 측 JSON 처리 코드 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-026",
    "title": "Guard는 독립 파티션에서 실행",
    "level": "필수",
    "scope": [
      "C / ASIL 측"
    ],
    "rule": "Safety Guard는 자체 OS-Application·MPU 파티션에서 실행한다(AUTOSAR OS SC3/SC4). 하위 ASIL 코드가 Guard 메모리에 쓰지 못하게 하고, 소비 기능에는 읽기 권한만 준다.",
    "basis": "ISO 26262-6:2018 Table 3, Annex D; ISO 26262-9:2018 cl.6",
    "verify": "FFI 분석과 MPU 설정 검토. 합격: 하위 ASIL 파티션의 Guard 메모리 쓰기 권한 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-027",
    "title": "정적 분석·런타임 오류 부재·WCET 분석",
    "level": "필수",
    "scope": [
      "C",
      "C++"
    ],
    "rule": "GEP에 정한 MISRA 검사 도구와 함께 런타임 오류 부재 분석(추상 해석, ASIL C/D 권장)을 수행한다. Flag 조합의 최악 경우에 대해 WCET와 스택 사용량을 분석한다.",
    "basis": "ISO 26262-6:2018 Table 7",
    "verify": "분석 보고서 검토. 합격: 런타임 오류 \"확정\" 0건, WCET와 스택이 예산 이하",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-028",
    "title": "출시되는 모든 구성에서 ASIL별 구조적 커버리지 달성",
    "level": "필수",
    "scope": [
      "C",
      "C++"
    ],
    "rule": "ASIL별 구조적 커버리지 목표는 구문·분기 100%, ASIL D는 MC/DC 100%다. 미달 항목은 항목별 근거(도달 불가 방어 코드, deactivated code)를 목록으로 남긴다. \"구성\"은 컴파일 시점 변형과 Post-build 설정 집합을 뜻하며, 각 구성에서 측정한다. 런타임 Flag 값의 조합은 12.3절의 조합 시험으로 다룬다.",
    "basis": "ISO 26262-6:2018 Table 9, Table 12, Annex C; NIST ACTS",
    "verify": "커버리지 보고와 미달 근거 목록 검토. 합격: 근거 없는 미달 항목 0건",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-029",
    "title": "인증 컴파일러와 경고의 오류 처리",
    "level": "필수",
    "scope": [
      "C",
      "C++"
    ],
    "rule": "컴파일러와 분석 도구는 ISO 26262-8 cl.11에 따라 TCL을 평가하고 qualification 근거를 확보한다. 컴파일 옵션(`-Werror` 포함)은 형상 관리 대상이다.",
    "basis": "ISO 26262-8:2018 cl.11; ASPICE SUP.8",
    "verify": "도구 분류 보고서와 빌드 로그 검토. 합격: 모든 빌드 도구에 TCL 평가가 있고, 옵션이 형상 기준선과 같다",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-CODE-030",
    "title": "AI 생성 코드는 사람이 쓴 코드와 같은 절차로",
    "level": "필수",
    "scope": [
      "C",
      "C++",
      "플랫폼"
    ],
    "rule": "AI 도구가 생성하거나 수정한 코드도 같은 검토, 정적 분석, 시험, 커버리지 기준을 통과해야 한다. 생성 도구와 Version, 생성 범위는 변경 기록에 남긴다.",
    "basis": "ISO 26262-8:2018 cl.11; ISO 26262-6:2018 cl.5",
    "verify": "변경 기록 감사. 합격: AI 생성 표시가 있는 변경 100%에 검토·분석·시험 기록이 있다",
    "section": "10_coding · 10.6 규칙"
  },
  {
    "id": "FFG-DEAC-001",
    "title": "원격 Kill은 요청이며 안전기제가 아님",
    "level": "필수",
    "scope": [
      "Safety Manager",
      "아키텍트"
    ],
    "rule": "원격 Kill을 FTTI 안의 안전기제로 Safety Concept에 포함하지 않는다. FTTI 안의 고장 대응은 차량 내부 안전기제로 설계한다.",
    "basis": "ISO 26262-4:2018 cl.6; ISO 26262-1:2018",
    "verify": "FSC·TSC 검토. 합격: FTTI 안의 안전기제 목록에 원격 경로가 0건이다",
    "section": "07_deactivation · 7.11 규칙"
  },
  {
    "id": "FFG-DEAC-002",
    "title": "즉시 정지는 Kill 결과가 될 수 없음",
    "level": "필수",
    "scope": [
      "차량 SW"
    ],
    "rule": "Kill 처리 경로에 최대 제동, 가속 차단 같은 즉시 정지 동작을 넣지 않는다. 정지가 필요한 고장은 기능 자체의 MRM으로 처리한다.",
    "basis": "ISO 26262-3:2018 cl.7; ISO 26262-4:2018 cl.6; UN R171 §5.4; UN R157 §5.4; ISO 15622",
    "verify": "코드 검토와 HIL. 합격: Kill 경로에서 제동·가속 명령을 직접 쓰는 코드가 0건이고, HIL에서 Kill 후 감속도가 기본 기능의 한계를 넘지 않는다",
    "section": "07_deactivation · 7.11 규칙"
  },
  {
    "id": "FFG-DEAC-003",
    "title": "등급별 동작 구현",
    "level": "필수",
    "scope": [
      "차량 SW"
    ],
    "rule": "Safety Guard는 7.3절의 등급별 동작과 7.5절의 상태표를 구현한다. 기능 작동 여부(5.3절 정의), 운전자 개입, 시동 주기를 매 주기 입력으로 받는다. 주행 중 효력을 낼 수 있는 모든 전이(DC0·DC1·DC2 비활성화, ACT_PENDING → ACTIVE, on-board 고장 감소)는 UN R156 §7.2.2.1.3의 안전 실행 입증 자료를 SUMS 기록에 첨부한다.",
    "basis": "ISO 26262-3:2018 cl.7; ISO 26262-4:2018 cl.6; UN R156 §7.2.2.1.3, §7.2.2.3, §7.2.2.5; GB 44496 §4.5.1, §5.2.6; UN R171 §5.4, §5.5.3",
    "verify": "단위시험 TC-FF-09~14, TC-FF-42와 HIL. 합격: 상태표의 전이 100%가 시험으로 덮이고 실패 0건이다",
    "section": "07_deactivation · 7.11 규칙"
  },
  {
    "id": "FFG-DEAC-004",
    "title": "상업·운영 사유는 다음 시동에",
    "level": "필수",
    "scope": [
      "차량 SW",
      "플랫폼"
    ],
    "rule": "DC0·DC4가 아닌 Feature에서 상업·운영 사유의 비활성화는 DC3으로 처리하고, 사용자에게 미리 알린다. 최종 상태는 INACTIVE다. 대기·진행 중인 Kill과 RESTORE_PENDING을 덮어쓰지 않는다. 유료 Feature의 종료는 시장별 소비자법 검토를 거친다.",
    "basis": "UN R156 §7.2.2.2; EU 2019/770 Art.19",
    "verify": "단위시험 TC-FF-11, TC-FF-12, TC-FF-33. 합격: 주행 중 거동 변화 0건, Kill의 사유 덮어쓰기 0건, 복원 우회 0건",
    "section": "07_deactivation · 7.11 규칙"
  },
  {
    "id": "FFG-DEAC-005",
    "title": "진행 중인 비활성화를 늦추지 않음",
    "level": "필수",
    "scope": [
      "차량 SW"
    ],
    "rule": "이미 대기·진행 중인 Kill은 새 요청으로 늦추거나 다시 계획하지 않는다. 상업 사유의 DC3 대기는 안전·보안·법규 Kill이 앞지른다. 감소 중 on-board 고장이 나면 남은 감소 시간이 fault_ramp_ms보다 길 때만 단축한다.",
    "basis": "ISO 26262-4:2018 cl.6; ISO 26262-6:2018 cl.7",
    "verify": "단위시험 TC-FF-12, TC-FF-26. 합격: 진행 중인 Kill의 완료 시각이 늦어진 경우가 0건이다",
    "section": "07_deactivation · 7.11 규칙"
  },
  {
    "id": "FFG-DEAC-006",
    "title": "운전자 경고와 정보",
    "level": "필수",
    "scope": [
      "차량 SW",
      "HMI"
    ],
    "rule": "DC2 경고는 시각과 청각(또는 촉각)으로 제공한다. DC1·DC3은 예정 안내를, 비활성 후에는 상태 안내를 표시한다. 문구는 시장 언어와 규정에 맞춘다.",
    "basis": "ISO 26262-3:2018 cl.7; ISO 26262-4:2018 cl.8; UN R171 §5.4, §5.5.4; UN R156 §7.2.2.2; UN ADS GTR 제안문 §4.2.1.2",
    "verify": "HMI 평가와 차량 시험. 합격: 등급별 HMI 표시가 사양과 일치하고, 경고 지연이 TSC 상한 이내다",
    "section": "07_deactivation · 7.11 규칙"
  },
  {
    "id": "FFG-DEAC-007",
    "title": "안전 Kill 상태는 자동으로 풀리지 않음",
    "level": "필수",
    "scope": [
      "차량 SW",
      "플랫폼"
    ],
    "rule": "안전·보안 사유로 DISABLED가 된 상태에는 만료가 없다. 명령의 유효기간(TTL)은 메시지에만 적용한다.",
    "basis": "ISO 26262-7:2018 cl.7; UN R155 Annex 5; UN ADS GTR 제안문 §4.1.4.4.2",
    "verify": "단위시험 TC-FF-09(전원 주기 후 유지). 합격: 전원 주기와 TTL 경과 후에도 DISABLED가 유지된다",
    "section": "07_deactivation · 7.11 규칙"
  },
  {
    "id": "FFG-DEAC-008",
    "title": "복원은 다른 승인자, 다음 시동, 자체 시험",
    "level": "필수",
    "scope": [
      "플랫폼",
      "차량 SW"
    ],
    "rule": "복원은 Kill을 승인한 사람과 다른 2인이 승인한다. 승인자 분리는 플랫폼이 감사 원장으로 판정한다(FFG-PLT-005). 차량은 복원의 승인자 참조가 Kill 승인자 참조와 하나라도 같으면 거부한다. 차량은 복원 기록이 영속된 뒤, 다음 시동에서 자체 시험을 통과해야 ACTIVE로 돌아간다.",
    "basis": "ISO 26262-7:2018 cl.7; UN R155 §7.2.2.2",
    "verify": "단위시험 TC-FF-15~17, TC-FF-39와 복원 드릴. 합격: 겹치는 승인자의 복원 수락 0건, 영속 전 또는 시험 실패 시 ACTIVE 0건",
    "section": "07_deactivation · 7.11 규칙"
  },
  {
    "id": "FFG-DEAC-009",
    "title": "오류 시 HARA Safe State로 수렴",
    "level": "필수",
    "scope": [
      "차량 SW"
    ],
    "rule": "검증 실패, 무결성 오류, 알 수 없는 Feature, 저장 장치 오류는 모두 그 Feature의 HARA Safe State로 수렴한다. DC0~DC3 Feature의 Safe State는 FSC에 정의된 상태다. 예제의 소비 기능에서는 Feature 효과 없음(BASE_ONLY, 기본 기능 유지)이다. DC4 Feature는 설계 기본 동작을 유지한다(FFG-CLS-005).",
    "basis": "ISO 26262-6:2018 Annex C; ISO 26262-3:2018 cl.7",
    "verify": "결함 주입 시험 TC-FF-18, TC-FF-19, TC-FF-34. 합격: 주입한 결함 100%에서 출력이 Safe State 또는 설계 기본 동작이다",
    "section": "07_deactivation · 7.11 규칙"
  },
  {
    "id": "FFG-DEAC-010",
    "title": "안전 Kill과 리콜·봉쇄 절차 연계",
    "level": "필수",
    "scope": [
      "플랫폼",
      "법규 담당"
    ],
    "rule": "결함을 완화하는 F2 이상 안전 Kill은 리콜 번호나 봉쇄 결정 근거와 함께 발행한다. 시장별 보고 기한(미국: 결함 판정 후 5영업일)을 지킨다.",
    "basis": "NHTSA Part 573; MIIT/SAMR 2025; EU 2018/858 Art.14, Art.52; 자동차관리법",
    "verify": "게이트 자동 검사. 합격: 근거 없는 F2 이상 안전 Kill 주문이 모두 FAIL이다",
    "section": "07_deactivation · 7.11 규칙"
  },
  {
    "id": "FFG-DEAC-011",
    "title": "DC4 거부도 기록",
    "level": "필수",
    "scope": [
      "차량 SW",
      "플랫폼"
    ],
    "rule": "DC4 Feature에 대한 모든 원격 요청(비활성화·활성화·복원)은 플랫폼과 차량에서 모두 거부하고, 사유 코드와 함께 감사 이력에 남긴다.",
    "basis": "EU 2019/2144 Art.6·7; UN R155 §7.3.7",
    "verify": "단위시험 TC-FF-13과 게이트 시험. 합격: 세 요청 모두 거부되고, 거부 기록이 100% 남는다",
    "section": "07_deactivation · 7.11 규칙"
  },
  {
    "id": "FFG-DEAC-012",
    "title": "Kill·복원 드릴",
    "level": "권장",
    "scope": [
      "운영 조직"
    ],
    "rule": "분기마다 시험 Cohort로 Kill·복원 드릴을 수행해 전달 시간, 적용률, 보고 정확도를 측정한다.",
    "basis": "ISO 26262-7:2018 cl.7; UN R155 §7.2.2.2",
    "verify": "드릴 보고서 감사. 합격: 최근 4분기 보고서가 있고, 세 지표가 19장 KPI 목표를 충족한다",
    "section": "07_deactivation · 7.11 규칙"
  },
  {
    "id": "FFG-DEAC-013",
    "title": "대기 상한과 상위 대응",
    "level": "필수",
    "scope": [
      "차량 SW",
      "플랫폼",
      "Safety Manager"
    ],
    "rule": "DC1 Feature는 비작동 대기 상한(max_pending_ms)을, DC1~DC3 Feature는 다음 시동 대기 상한(max_cycle_wait_ms)을 Registry 속성으로 갖는다. 대기가 상한을 넘으면 Safety Guard는 pending_overdue와 사유 코드를 보고한다. 플랫폼은 해당 차량을 미적용 차량으로 보아 Incident로 넘긴다. 대체 조치(운전자 안내, 서비스 입고, 리콜 범위 조정)는 Safety Manager가 정한다.",
    "basis": "ISO 26262-3:2018 cl.7; ISO 26262-7:2018 cl.7; ISO 21448:2022 cl.13",
    "verify": "단위시험 TC-FF-27, TC-FF-42와 운영 드릴. 합격: 상한 초과 후 한 주기 안에 보고되고, 플랫폼 Incident가 생성된다",
    "section": "07_deactivation · 7.11 규칙"
  },
  {
    "id": "FFG-GEN-001",
    "title": "Compliance Profile은 버전 관리 데이터",
    "level": "필수",
    "scope": [
      "플랫폼",
      "법규 담당"
    ],
    "rule": "시장별 적용 법규, 필수 Evidence, 게이트 파라미터를 Compliance Profile로 정의하고 버전을 관리한다. 모든 정책과 명령은 생성 시점의 Profile 버전을 기록한다.",
    "basis": "ISO 26262-8:2018 cl.7; UN R156 §7.1.1",
    "verify": "형상 감사(Profile 저장소와 명령 기록 대조). 합격: 표본 명령 100%에 Profile 버전이 있고, 그 버전이 저장소에 존재한다",
    "section": "02_compliance · 2.4 규칙"
  },
  {
    "id": "FFG-GEN-002",
    "title": "표준 판은 프로젝트 단위로 고정",
    "level": "필수",
    "scope": [
      "Safety Manager"
    ],
    "rule": "프로젝트는 ISO 26262, ISO 21448, ISO/SAE 21434의 판을 Safety Plan에 고정한다. 정식 발행 전의 개정판 요구는 Gate 판정 기준에 섞지 않는다.",
    "basis": "ISO 26262-2:2018 cl.6",
    "verify": "Safety Plan 검토. 합격: 세 표준의 판이 모두 명시되고, Gate 체크리스트가 그 판만 참조한다",
    "section": "02_compliance · 2.4 규칙"
  },
  {
    "id": "FFG-GEN-003",
    "title": "미확인 시장에서는 F2 이상 활성화 차단",
    "level": "필수",
    "scope": [
      "플랫폼 게이트"
    ],
    "rule": "Profile 상태가 \"확인\"이 아닌 시장에서는 F2 이상 Feature의 활성화와 복원을 차단한다. 비활성화는 차단하지 않는다.",
    "basis": "UN R156 §7.1.1.9; EU 2018/858 Art.33",
    "verify": "게이트 단위시험(미확인 시장 + F2 활성화, 미확인 시장 + 안전 Kill). 합격: 활성화는 FAIL, Kill은 PASS",
    "section": "02_compliance · 2.4 규칙"
  },
  {
    "id": "FFG-GEN-004",
    "title": "법규 감시와 갱신 주기",
    "level": "필수",
    "scope": [
      "법규 담당",
      "Safety Manager",
      "CSM"
    ],
    "rule": "분기마다 표준·법규 개정을 점검해 Profile을 갱신한다. \"검증 필요\" 항목은 해당 시장 SOP 전에 해소한다.",
    "basis": "ISO 26262-2:2018 cl.5; ISO/SAE 21434 cl.5",
    "verify": "분기 감시 보고서 감사. 합격: 최근 4분기 보고서가 모두 있고, SOP가 지난 시장의 \"검증 필요\" 항목이 0건이다",
    "section": "02_compliance · 2.4 규칙"
  },
  {
    "id": "FFG-GEN-005",
    "title": "상충 요구는 엄격한 쪽을 적용",
    "level": "필수",
    "scope": [
      "전 조직"
    ],
    "rule": "시장 간 요구가 상충하면 엄격한 요구를 공통 기준으로 삼는다. 법적으로 양립할 수 없으면 시장별 변형으로 분리하고, 그 근거를 Profile에 기록한다.",
    "basis": "ISO 26262-2:2018 cl.6; UN R156 §7.1.1.9",
    "verify": "Profile 검토. 합격: 시장별 변형마다 상충 근거와 법규 담당 서명이 있다",
    "section": "02_compliance · 2.4 규칙"
  },
  {
    "id": "FFG-GEN-006",
    "title": "형식승인 영향 판단은 법규 담당이 서명",
    "level": "필수",
    "scope": [
      "법규 담당"
    ],
    "rule": "Feature 활성화·변경이 형식승인에 영향을 주는지는 법규 담당이 판단하고 서명한다. 영향이 있으면 승인 기관의 결정(개정·확장)이 나온 뒤에만 활성화한다.",
    "basis": "UN R156 §7.1.1.8, §7.1.1.9; EU 2018/858 Art.33-34",
    "verify": "R156 영향 평가 기록 감사. 합격: 형식승인 영향이 \"있음\"인 활성화 100%에 승인 기관 결정 번호가 연결되어 있다",
    "section": "02_compliance · 2.4 규칙"
  },
  {
    "id": "FFG-LCY-001",
    "title": "Gate 결정은 서명된 기록",
    "level": "필수",
    "scope": [
      "플랫폼"
    ],
    "rule": "모든 Gate 결정은 대상(Feature·Version·Baseline), 판정, 근거 Evidence ID, 승인자 역할, 시각을 담은 Decision Record로 남기고 전자서명한다. Decision Record 없이는 상태를 전이하지 않는다.",
    "basis": "ISO 26262-2:2018 cl.6; ISO 26262-8:2018 cl.7",
    "verify": "감사 이력 감사. 합격: 표본 상태 전이 100%에 서명된 Decision Record가 있다",
    "section": "06_lifecycle · 6.6 규칙"
  },
  {
    "id": "FFG-LCY-002",
    "title": "Gate는 fail-closed",
    "level": "필수",
    "scope": [
      "플랫폼"
    ],
    "rule": "입력이 없거나, 검증 도구가 실패하거나, Evidence가 없으면 Gate는 FAIL로 판정한다. 통과를 강제로 덮어쓸 때는 2인 승인과 사유를 남긴다.",
    "basis": "ISO 26262-8:2018 cl.11",
    "verify": "게이트 결함 주입 시험(입력 누락, 도구 오류, Evidence 누락). 합격: 세 경우 모두 FAIL이고, 승인 없는 덮어쓰기가 0건이다",
    "section": "06_lifecycle · 6.6 규칙"
  },
  {
    "id": "FFG-LCY-003",
    "title": "재-HARA 조건 자동 검출",
    "level": "필수",
    "scope": [
      "플랫폼",
      "Safety Manager"
    ],
    "rule": "6.4절의 조건에 해당하는 변경은 Topology와 Registry 속성 비교로 자동 검출하고 Safety Manager에게 재-HARA를 요청한다.",
    "basis": "ISO 26262-3:2018 cl.6; ISO 26262-8:2018 cl.8; ISO 21448:2022 cl.8",
    "verify": "변경 영향 검증 시험(조건별 변경 1건씩). 합격: 6개 조건 모두 재-HARA 요청이 생성된다",
    "section": "06_lifecycle · 6.6 규칙"
  },
  {
    "id": "FFG-LCY-004",
    "title": "F2 이상 안전요구의 추적성 100%",
    "level": "필수",
    "scope": [
      "요구 Owner"
    ],
    "rule": "F2 이상 Feature는 Safety Goal부터 SW 안전요구, 설계, 시험, 출시 Baseline까지 양방향으로 추적한다. 연결되지 않은 요구는 허용하지 않는다.",
    "basis": "ISO 26262-8:2018 cl.6; ASPICE SWE.1, SWE.6",
    "verify": "추적성 분석 보고. 합격: 미연결 요구 0건, 미연결 시험 0건",
    "section": "06_lifecycle · 6.6 규칙"
  },
  {
    "id": "FFG-LCY-005",
    "title": "비활성화 요구를 안전요구에 포함",
    "level": "필수",
    "scope": [
      "요구 Owner"
    ],
    "rule": "F2 이상 Feature의 안전요구에는 비활성화 등급, 경고·인계·감소 시간, Safe State, 끝 상태, 운전자 정보 요구를 포함한다.",
    "basis": "ISO 26262-3:2018 cl.7; UN R171 §5.4; UN ADS GTR 제안문 §4.2.2.3",
    "verify": "요구 검토. 합격: F2 이상 Feature마다 다섯 항목이 요구로 존재한다",
    "section": "06_lifecycle · 6.6 규칙"
  },
  {
    "id": "FFG-LCY-006",
    "title": "F2 이상에는 차량 내 고장 감지",
    "level": "필수",
    "scope": [
      "아키텍트"
    ],
    "rule": "F2 이상 Feature는 FTTI 안에서 자신의 고장을 감지하고 Safety Guard에 보고하는 on-board 감시를 설계에 포함한다. 예: 독립 센서와의 plausibility 비교. 원격 Kill은 이 감시를 대신하지 않는다.",
    "basis": "ISO 26262-4:2018 cl.6; ISO 26262-1:2018; UN ADS GTR 제안문 §4.1.4.2",
    "verify": "결함 주입 시험과 SIL 시나리오 TC-FF-21. 합격: FDTI + FRTI가 FTTI보다 작다",
    "section": "06_lifecycle · 6.6 규칙"
  },
  {
    "id": "FFG-LCY-007",
    "title": "V&V 독립성은 참조 ASIL로 결정",
    "level": "필수",
    "scope": [
      "Safety Manager"
    ],
    "rule": "확인 조치(확인 검토, 기능안전 감사, 기능안전 평가)의 독립성 수준은 F 등급이 아니라 참조 ASIL로 정한다(ISO 26262-2:2018 Table 1, 12.5절). 검증(시험·검토)의 독립성은 Safety Plan에서 따로 정한다.",
    "basis": "ISO 26262-2:2018 cl.6",
    "verify": "Safety Plan 검토. 합격: 확인 조치마다 참조 ASIL과 독립성 수준이 표준 원문 Table 1과 일치한다",
    "section": "06_lifecycle · 6.6 규칙"
  },
  {
    "id": "FFG-LCY-008",
    "title": "활성화·비활성화는 SUMS 기록 대상",
    "level": "필수",
    "scope": [
      "플랫폼",
      "법규 담당"
    ],
    "rule": "Flag나 파라미터를 바꾸는 모든 명령은 SW 업데이트로 기록한다. 기록 항목은 대상 RXSWIN, 형식승인 영향 평가, 사용자 고지 내용, 결과다. 보존 기간은 가장 긴 시장 요건을 따른다.",
    "basis": "UN R156 §2.3, §7.1.1.8, §7.1.1.9; GB 44496",
    "verify": "SUMS 감사. 합격: 표본 명령 100%에 네 항목이 있고, 보존 기간 설정이 Profile의 최대값 이상이다",
    "section": "06_lifecycle · 6.6 규칙"
  },
  {
    "id": "FFG-LCY-009",
    "title": "배포와 효력 분리, 단계적 확대",
    "level": "필수",
    "scope": [
      "플랫폼",
      "CCS/OTA"
    ],
    "rule": "패키지 전달(G6)과 차량 내 효력(G7)은 별도로 승인한다. F2 이상 활성화와 복원은 Canary Cohort에서 시작한다. 사전에 정한 관측 기간과 중단 기준을 만족해야 범위를 넓힌다.",
    "basis": "ISO 24089:2023; ISO 26262-7:2018 cl.7",
    "verify": "단계적 기능 배포 기록 감사. 합격: F2 이상 확대 100%에 Canary 결과와 중단 기준 판정이 있다",
    "section": "06_lifecycle · 6.6 규칙"
  },
  {
    "id": "FFG-LCY-010",
    "title": "활성화는 작동 중이 아닐 때, 시장 고지와 함께",
    "level": "필수",
    "scope": [
      "차량 SW",
      "플랫폼"
    ],
    "rule": "F2 이상 Feature의 활성화는 해당 기능이 작동 중이 아닐 때 효력을 낸다. 시장 Profile이 요구하는 사용자 고지와 확인을 마친 뒤 적용한다.",
    "basis": "ISO 26262-3:2018 cl.7; UN R156 §7.2.2.2; GB 44496",
    "verify": "단위시험 TC-FF-22. 합격: 작동 중 활성화의 효력 발생이 0건이다",
    "section": "06_lifecycle · 6.6 규칙"
  },
  {
    "id": "FFG-LCY-011",
    "title": "Flag 은퇴와 코드 삭제",
    "level": "필수",
    "scope": [
      "Feature Owner",
      "차량 SW"
    ],
    "rule": "은퇴가 승인된 Flag는 승인 후 6개월 또는 다음 정기 릴리스 중 이른 시점까지 코드, 설정, 시험을 삭제한다. Flag ID는 다시 쓰지 않는다. 일부 차량에 구 Version이 남아 있으면 상태 보고로 확인한 뒤 은퇴를 종료한다.",
    "basis": "ISO 26262-8:2018 cl.8; Knight Capital",
    "verify": "Registry 감사와 정적 분석. 합격: 기한이 지난 은퇴 Flag의 코드 참조가 0건이다",
    "section": "06_lifecycle · 6.6 규칙"
  },
  {
    "id": "FFG-LCY-012",
    "title": "안전 관련 Flag 변경은 변경 관리 대상",
    "level": "필수",
    "scope": [
      "전 조직"
    ],
    "rule": "안전 관련 Flag·파라미터·정책·임계값의 변경은 소스 변경 여부와 관계없이 변경 요청(CR)과 영향 분석을 거친다. 회귀시험은 Topology 영향 범위로 자동 선정한다.",
    "basis": "ISO 26262-8:2018 cl.8; ASPICE SUP.10; UN ADS GTR 제안문 §5.1.6.2(c)",
    "verify": "변경 영향 검증 기록 감사. 합격: 표본 변경 100%에 CR, 영향 분석, 회귀시험 선정 근거가 있다",
    "section": "06_lifecycle · 6.6 규칙"
  },
  {
    "id": "FFG-OFT-001",
    "title": "OpenFeature는 F0·F1 평가에만 쓴다",
    "level": "필수",
    "scope": [
      "플랫폼",
      "IVI 앱"
    ],
    "rule": "OpenFeature SDK·Provider로는 F0·F1 Flag만 평가한다. Provider는 F2 이상 키에 호출자 기본값과 reason DISABLED를 돌려주고, 값을 계산하지 않는다. 차량 제어 SW와 Safety Guard는 OpenFeature를 쓰지 않는다.",
    "basis": "ISO 26262-8:2018 cl.15; OpenFeature",
    "verify": "Provider 경계 시험. 합격: Registry의 F2 이상 키 100%가 기본값과 DISABLED",
    "section": "11_openfeature · 11.11 규칙"
  },
  {
    "id": "FFG-OFT-002",
    "title": "기본값은 Safe State",
    "level": "필수",
    "scope": [
      "IVI 앱",
      "플랫폼"
    ],
    "rule": "모든 평가 호출의 기본값은 그 Flag의 Safe State(기능 꺼짐 또는 기본 동작)다. 기본값을 코드 상수로 두고 검토 대상에 포함한다.",
    "basis": "OpenFeature; ISO 26262-6:2018 Annex C",
    "verify": "코드 검토와 오류 경로 시험. 합격: Safe State가 아닌 기본값 0건, 오류 주입 시 출력이 Safe State",
    "section": "11_openfeature · 11.11 규칙"
  },
  {
    "id": "FFG-OFT-003",
    "title": "Evaluation Context에 개인정보·위치·주행 상태를 넣지 않는다",
    "level": "필수",
    "scope": [
      "플랫폼",
      "IVI 앱",
      "데이터 보호 담당"
    ],
    "rule": "targeting key는 가명 차량 ID를 쓴다. 위치, 운전자 식별, 연락처, 차량 동적 상태는 컨텍스트에 넣지 않는다. before Hook이 금지 속성을 INVALID_CONTEXT로 거부한다.",
    "basis": "GDPR Art.25; EDPB 01/2020; 중국 자동차 데이터 안전 규정 2021",
    "verify": "컨텍스트 정책 시험. 합격: 금지 속성 100%가 거부된다",
    "section": "11_openfeature · 11.11 규칙"
  },
  {
    "id": "FFG-OFT-004",
    "title": "감사 Hook과 가명 기록",
    "level": "필수",
    "scope": [
      "플랫폼",
      "IVI 앱"
    ],
    "rule": "finally Hook으로 모든 평가(성공·오류)를 기록한다. 기록에는 flag key, variant, reason, error type, provider 이름, f_class, 가명 subject를 넣는다. 원본 targeting key와 Flag 값의 개인정보는 기록하지 않는다.",
    "basis": "ISO 26262-8:2018 cl.7; GDPR Art.25; OpenTelemetry",
    "verify": "감사 시험. 합격: 기록 수 = 평가 수, 원본 targeting key 0건",
    "section": "11_openfeature · 11.11 규칙"
  },
  {
    "id": "FFG-OFT-005",
    "title": "F2 이상 Flag는 OpenFeature 백엔드로 내보내지 않는다",
    "level": "필수",
    "scope": [
      "플랫폼 게이트"
    ],
    "rule": "flagd 정의, OFREP 응답, 그 밖의 OpenFeature 백엔드 데이터에는 F0·F1 Flag만 넣는다. 내보내기 단계에서 F2 이상 키를 걸러 내고, 결과를 검사한다.",
    "basis": "ISO 26262-8:2018 cl.15; OpenFeature",
    "verify": "내보내기 시험. 합격: 결과에 F2 이상 키 0건",
    "section": "11_openfeature · 11.11 규칙"
  },
  {
    "id": "FFG-OFT-006",
    "title": "Provider Event와 스냅샷 Version",
    "level": "필수",
    "scope": [
      "플랫폼"
    ],
    "rule": "Provider는 Registry 스냅샷이 바뀌면 CONFIGURATION_CHANGED와 바뀐 키 목록을 낸다. 평가 결과의 metadata에 스냅샷 Version을 싣는다. 동기화가 늦으면 STALE을 낸다.",
    "basis": "OpenFeature; ISO 26262-8:2018 cl.7",
    "verify": "이벤트 시험. 합격: 갱신 1회당 이벤트 1회, 변경 키 목록 정확, 모든 평가 결과에 스냅샷 Version",
    "section": "11_openfeature · 11.11 규칙"
  },
  {
    "id": "FFG-OFT-007",
    "title": "사양과 SDK Version 고정",
    "level": "필수",
    "scope": [
      "플랫폼",
      "IVI 앱"
    ],
    "rule": "사용하는 OpenFeature 사양 Version과 SDK Version을 프로젝트에 고정하고 SBOM에 기록한다. Experimental 기능(Tracking, Multi-Provider, 트랜잭션 컨텍스트 전파)은 양산 판단에 쓰지 않는다. 1.0 전 SDK는 Version을 정확히 고정한다.",
    "basis": "OpenFeature; ISO 26262-8:2018 cl.11",
    "verify": "SBOM과 빌드 설정 검토. 합격: 범위 Version 지정 0건, Experimental 기능의 양산 사용 0건",
    "section": "11_openfeature · 11.11 규칙"
  },
  {
    "id": "FFG-OFT-008",
    "title": "화면 표시는 Guard 상태 보고로",
    "level": "필수",
    "scope": [
      "IVI 앱"
    ],
    "rule": "F2 이상 Feature의 상태를 사용자에게 보여 줄 때는 OpenFeature 평가 결과가 아니라, state_auth를 검증한 Guard 상태 보고를 쓴다.",
    "basis": "ISO 26262-7:2018 cl.7; UN R156 §7.2.2.4",
    "verify": "IVI 통합 시험(Flag 값과 Guard 상태를 다르게 설정). 합격: 화면이 Guard 상태를 따른다",
    "section": "11_openfeature · 11.11 규칙"
  },
  {
    "id": "FFG-PLT-001",
    "title": "메시지 스키마 v2 적합성",
    "level": "필수",
    "scope": [
      "플랫폼",
      "LPC"
    ],
    "rule": "kill_command v2 스키마에 맞지 않는 명령은 서명 전에 차단한다. 스키마는 운영자가 복구 방식을 고르는 필드(safe_mode)를 허용하지 않는다.",
    "basis": "ISO/SAE 21434 cl.10; UN R155 Annex 5",
    "verify": "스키마 검증 자동 시험(정상 예제, 실패 예제). 합격: 실패 예제 전부 거부, 정상 예제 전부 통과",
    "section": "08_control_plane · 8.5 규칙"
  },
  {
    "id": "FFG-PLT-002",
    "title": "Registry RELEASED 버전만 대상",
    "level": "필수",
    "scope": [
      "플랫폼"
    ],
    "rule": "Registry에서 RELEASED 상태인 Feature Version만 명령 대상이 된다. 폐기(DECOMMISSIONED)된 Version에는 비활성화만 허용한다.",
    "basis": "ISO 26262-8:2018 cl.7; ASPICE SPL.2; UN ADS GTR 제안문 §5.3.2.16(e)",
    "verify": "게이트 자동 시험. 합격: RELEASED가 아닌 Version 대상 활성화·복원이 모두 FAIL이다",
    "section": "08_control_plane · 8.5 규칙"
  },
  {
    "id": "FFG-PLT-003",
    "title": "등급은 Registry 데이터, 운영자가 선택하지 않음",
    "level": "필수",
    "scope": [
      "플랫폼"
    ],
    "rule": "명령의 F 등급과 비활성화 등급은 Registry 값과 같아야 한다.",
    "basis": "ISO 26262-6:2018 Annex C; ISO 26262-3:2018 cl.7",
    "verify": "게이트 자동 시험과 차량 재검증 TC-FF-07. 합격: 등급이 다른 명령이 게이트와 Guard에서 모두 거부된다",
    "section": "08_control_plane · 8.5 규칙"
  },
  {
    "id": "FFG-PLT-004",
    "title": "DC4·의무 기능 원격 요청 금지",
    "level": "필수",
    "scope": [
      "플랫폼",
      "Safety Guard"
    ],
    "rule": "DC4로 분류되었거나 의무 기능(GSR의 ISA, DDAW, ADDW, AEBS, ELKS, EDR, 미국 FMVSS 127 AEB)인 Feature에는 원격 비활성화·활성화·복원 명령을 만들지 않는다.",
    "basis": "EU 2019/2144 Art.6·7; EU 2021/1958; FMVSS 127 S5.4.2; UN R152; UN R160",
    "verify": "게이트 자동 시험과 차량 재검증 TC-FF-13. 합격: 세 요청 유형 모두 게이트 FAIL, Guard DC4_REMOTE_FORBIDDEN",
    "section": "08_control_plane · 8.5 규칙"
  },
  {
    "id": "FFG-PLT-005",
    "title": "2인 승인과 역할",
    "level": "필수",
    "scope": [
      "플랫폼"
    ],
    "rule": "모든 명령에는 서로 다른 승인자 2명 이상이 필요하다. 승인마다 승인자 개인 키(FIDO2·스마트카드)로 만든 approval_sig가 있어야 한다. 서명 HSM은 유효한 승인 서명이 기준 수에 이르지 않으면 명령 키를 쓰지 않는다. F2 이상 Feature의 안전·보안 Kill과 복원에는 Safety Manager 승인이 포함된다. 복원 승인자는 감사 원장에 기록된 Kill 승인자와 겹칠 수 없다.",
    "basis": "ISO 26262-7:2018 cl.7; UN R155 §7.2.2.2",
    "verify": "게이트 자동 시험(승인자 1명, 같은 승인자, Kill 승인자 재사용). 합격: 세 경우 모두 FAIL이다",
    "section": "08_control_plane · 8.5 규칙"
  },
  {
    "id": "FFG-PLT-006",
    "title": "상업·운영 사유의 지연 적용과 고지",
    "level": "필수",
    "scope": [
      "플랫폼",
      "Safety Guard"
    ],
    "rule": "DC1~DC3 Feature의 상업·운영 사유 변경은 Guard가 DC3로 적용한다. 플랫폼은 F2 이상 Feature에 대해 사용자 고지 문안이 준비되지 않은 주문을 차단한다.",
    "basis": "UN R156 §7.2.2.2; UN R171 §5.5.3",
    "verify": "게이트 자동 시험과 단위시험 TC-FF-11. 합격: 고지 없는 F2 이상 상업 주문이 FAIL이고, 주행 중 거동 변화가 0건이다",
    "section": "08_control_plane · 8.5 규칙"
  },
  {
    "id": "FFG-PLT-007",
    "title": "메시지 유효기간 상한",
    "level": "필수",
    "scope": [
      "플랫폼",
      "Safety Guard"
    ],
    "rule": "명령 유효기간은 정책 상한(예: 24시간) 이내다. not_before는 issued_at 이후 정책 상한(예: 1시간) 안이다. issued_at은 게이트 시각보다 허용 시계 오차 이상 미래일 수 없다. expires_at은 게이트 판정 시각보다 늦어야 한다. 유효 구간은 [not_before, expires_at)이다. 이 유효기간은 메시지에만 적용한다. 안전 Kill로 비활성화된 상태는 자동으로 만료되지 않는다.",
    "basis": "UN R155 Annex 5; ISO/SAE 21434 cl.10",
    "verify": "게이트 자동 시험(미래 issued_at, 만료, 과도한 TTL)과 단위시험 TC-FF-25. 합격: 세 경우 게이트 FAIL, expires_at 시각과 같은 시각의 명령은 Guard EXPIRED",
    "section": "08_control_plane · 8.5 규칙"
  },
  {
    "id": "FFG-PLT-008",
    "title": "적용 범위 상한과 Canary",
    "level": "필수",
    "scope": [
      "플랫폼",
      "CCS/OTA"
    ],
    "rule": "대상 차량 수는 Registry 상한을 넘을 수 없다. 활성화와 복원은 Canary 상한 이내에서 시작해 단계적으로 넓힌다.",
    "basis": "ISO 24089:2023; ISO 26262-7:2018 cl.7",
    "verify": "게이트 자동 시험. 합격: 상한 초과 주문과 Canary 생략 주문이 FAIL이다",
    "section": "08_control_plane · 8.5 규칙"
  },
  {
    "id": "FFG-PLT-009",
    "title": "시장·형식승인 사전조건",
    "level": "필수",
    "scope": [
      "플랫폼",
      "CCS/OTA",
      "LPC"
    ],
    "rule": "아래 조건을 모두 충족해야 명령을 발행한다.\n- 시장 승인 여부\n- R156 영향 평가 ID\n- 형식승인 확장이 필요한 경우 승인 완료\n- 중국: OTA 신고·변경 허가 ID와 사용자 확인\n- F2 이상 Feature의 안전 Kill: 리콜 번호 또는 봉쇄 결정 근거",
    "basis": "UN R156 §7.1.1.9; EU 2018/858 Art.33-34; GB 44496; MIIT/SAMR 2025; NHTSA Part 573",
    "verify": "게이트 자동 시험(조건별 누락 1건씩). 합격: 다섯 경우 모두 FAIL이다",
    "section": "08_control_plane · 8.5 규칙"
  },
  {
    "id": "FFG-PLT-010",
    "title": "BOM·SBOM·Evidence 참조",
    "level": "필수",
    "scope": [
      "플랫폼",
      "CCS/OTA"
    ],
    "rule": "활성화와 복원 명령은 BOM Baseline과 SBOM(CycloneDX 또는 SPDX)을 참조한다.",
    "basis": "ISO/SAE 21434 cl.7, cl.8, cl.10; UN R155 §7.2.2.5; NTIA SBOM",
    "verify": "게이트 자동 시험과 SBOM 스키마 검증. 합격: 참조 없는 주문 FAIL, SBOM 스키마 오류 0건",
    "section": "08_control_plane · 8.5 규칙"
  },
  {
    "id": "FFG-PLT-011",
    "title": "OpenFeature는 QM 평가 API로만 사용",
    "level": "필수",
    "scope": [
      "플랫폼",
      "IVI 앱"
    ],
    "rule": "OpenFeature SDK·Provider로는 F0·F1 Flag만 평가한다. F2 이상 Flag 값은 OpenFeature로 평가해 차량 동작에 쓰지 않는다. 상세 규칙은 11장(FFG-OFT)에 있다.",
    "basis": "ISO 26262-8:2018 cl.15; GDPR Art.25",
    "verify": "Provider 단위시험. 합격: F2 이상 키 평가가 모두 기본값과 reason DISABLED를 돌려준다",
    "section": "08_control_plane · 8.5 규칙"
  },
  {
    "id": "FFG-PLT-012",
    "title": "Broker 보안과 전달 규칙",
    "level": "필수",
    "scope": [
      "플랫폼",
      "CCS/OTA"
    ],
    "rule": "8.2.4절의 전달 계층 요건(mTLS, 차량별 토픽과 차량 1대 단위 봉투, 순서 보장, 멱등 처리, 만료 명령 폐기, 대체 전달 경로)을 따른다. 차량별 전달 결과는 운영 데이터 수집에 기록한다.",
    "basis": "UN R155 Annex 5; ISO/SAE 21434 cl.10; ISO 26262-6:2018 Annex D",
    "verify": "Broker 호환성 점검과 침투 시험. 합격: broadcast 전달 0건, 다른 차량 ID 수신 0건, 만료 명령 전달 0건",
    "section": "08_control_plane · 8.5 규칙"
  },
  {
    "id": "FFG-PLT-013",
    "title": "컴포넌트 TCL 분류와 신뢰도 확보",
    "level": "필수",
    "scope": [
      "플랫폼",
      "Safety Manager"
    ],
    "rule": "8.1절의 모든 플랫폼 컴포넌트에 대해 오류 출력 유형별 TI·TD와 TCL을 Safety Plan에 기록한다. TD1은 출력 유형마다 차량 또는 후속 공정의 검출 수단을 지정할 수 있을 때만 주장한다. TCL2 이상은 ISO 26262-8 cl.11의 방법으로 신뢰도를 확보한다. PKI·서명 서비스는 TD1을 쓰지 않는다.",
    "basis": "ISO 26262-8:2018 cl.11",
    "verify": "도구 분류 보고서 검토. 합격: 컴포넌트 100%에 오류 유형별 TD 근거가 있고, TCL2 이상 100%에 신뢰도 확보 방법이 있다",
    "section": "08_control_plane · 8.5 규칙"
  },
  {
    "id": "FFG-PLT-014",
    "title": "정책 생성은 결정적이며 Golden 시험을 가짐",
    "level": "필수",
    "scope": [
      "정책 저장·버전 관리",
      "정책 검증"
    ],
    "rule": "같은 입력에서 같은 정책 바이트열이 나와야 한다(결정적 생성). 대표 정책마다 Golden 시험을 둔다. 생성기를 바꾸면 Golden 비교를 통과해야 한다.",
    "basis": "ISO 26262-8:2018 cl.11; ISO 24089:2023",
    "verify": "Golden 시험. 합격: 대표 정책 100%가 바이트 단위로 일치한다",
    "section": "08_control_plane · 8.5 규칙"
  },
  {
    "id": "FFG-PLT-015",
    "title": "감사·검증 이력은 추가만 가능",
    "level": "필수",
    "scope": [
      "감사 이력 관리",
      "검증 이력 관리",
      "이벤트 이력 추적"
    ],
    "rule": "이력은 수정·삭제할 수 없는 추가 전용 저장소에 남긴다. 해시 체인 또는 동등한 방법으로 위변조를 검출한다. 보존 기간은 시장 Profile의 최장 기간을 따른다.",
    "basis": "ISO 26262-8:2018 cl.7; UN R156 §7.1.1; GB 44496",
    "verify": "무결성 검사 자동화(변조 주입). 합격: 주입한 변조 100% 검출",
    "section": "08_control_plane · 8.5 규칙"
  },
  {
    "id": "FFG-PLT-016",
    "title": "IAM 직무 분리",
    "level": "필수",
    "scope": [
      "플랫폼 인증·권한 관리(IAM)"
    ],
    "rule": "요구 승인, 출시(Release), Kill 실행, 복원 승인 권한을 분리한다. 한 사람이 같은 명령의 요청자와 승인자를 겸할 수 없다. 긴급 권한 사용은 사후 독립 검토를 받는다.",
    "basis": "ISO 26262-2:2018 cl.6; UN R155 §7.2.2.2",
    "verify": "권한 감사. 합격: 겸직 계정 0건, 긴급 권한 사용 100%에 사후 검토 기록",
    "section": "08_control_plane · 8.5 규칙"
  },
  {
    "id": "FFG-PLT-017",
    "title": "주문 순번은 원장 기준 +1",
    "level": "필수",
    "scope": [
      "플랫폼"
    ],
    "rule": "Feature별 주문 순번(command_seq)은 감사 원장의 마지막 값 +1이어야 한다. 빈 번호, 재사용, 큰 도약(순번 고갈 시도)은 차단한다. 차량별 vehicle_seq는 서명 서비스가 차량·Feature별 원장으로 발급한다. 키 epoch를 올리면 각 Feature의 첫 vehicle_seq는 1~1024 범위에서 다시 시작한다.",
    "basis": "UN R155 Annex 5; ISO/SAE 21434 cl.10",
    "verify": "게이트 자동 시험 TC-FF-47(재사용, 큰 도약)과 단위시험 TC-FF-05. 합격: 두 경우 게이트 FAIL, 새 epoch의 범위 밖 첫 순번은 Guard SEQ_JUMP",
    "section": "08_control_plane · 8.5 규칙"
  },
  {
    "id": "FFG-SBOM-001",
    "title": "배포 단위별 SBOM",
    "level": "필수",
    "scope": [
      "내부",
      "협력사"
    ],
    "rule": "모든 배포 단위에 15.2절 형식의 SBOM을 만들고, BOM Baseline과 함께 형상관리한다.",
    "basis": "NTIA SBOM; ISO/IEC 5962; UN R155 §7.2.2.5",
    "verify": "릴리스 체크리스트 점검. 합격: SBOM 없는 배포 단위 0건",
    "section": "15_sbom · 15.4 규칙"
  },
  {
    "id": "FFG-SBOM-002",
    "title": "생성 시 스키마 검증",
    "level": "필수",
    "scope": [
      "배포 파이프라인 연계",
      "협력사"
    ],
    "rule": "SBOM은 빌드 파이프라인에서 자동 생성한다. 생성할 때마다 형식 스키마 검증을 통과해야 한다.",
    "basis": "CycloneDX; SPDX",
    "verify": "파이프라인 로그 검토. 합격: 스키마 검증 실패 상태로 저장된 SBOM 0건",
    "section": "15_sbom · 15.4 규칙"
  },
  {
    "id": "FFG-SBOM-003",
    "title": "해시로 실제 산출물과 결합",
    "level": "필수",
    "scope": [
      "보안 배포 관리"
    ],
    "rule": "SBOM의 해시와 배포 패키지의 해시가 일치해야 서명·배포할 수 있다.",
    "basis": "ISO/SAE 21434 cl.10; UN R156 §7.1.1",
    "verify": "배포 게이트 시험. 합격: 해시 불일치 패키지의 서명 0건",
    "section": "15_sbom · 15.4 규칙"
  },
  {
    "id": "FFG-SBOM-004",
    "title": "협력사 SBOM 납품",
    "level": "필수",
    "scope": [
      "협력사"
    ],
    "rule": "협력사는 납품 SW마다 SBOM, 라이선스 목록, 알려진 취약점(VEX 포함)을 납품한다. 초판은 G5, 해시가 결합된 최종본은 G6에 낸다. DIA에 형식과 갱신 주기를 적는다.",
    "basis": "ISO 26262-8:2018 cl.5; ISO/SAE 21434 cl.7",
    "verify": "입고 검사. 합격: 17.7절 입고 검사의 SBOM 항목 불합격 0건",
    "section": "15_sbom · 15.4 규칙"
  },
  {
    "id": "FFG-SBOM-005",
    "title": "취약점 대응 연결",
    "level": "필수",
    "scope": [
      "CSM",
      "운영 조직"
    ],
    "rule": "새 취약점이 공지되면 SBOM과 VEX로 영향 Feature와 차량을 특정한다. 위험도에 따라 보안 사유 Kill 또는 업데이트를 결정한다. Kill 경로 구성요소의 취약점은 최우선으로 다루고, CSMS에 대응 기한을 정한다.",
    "basis": "UN R155 §7.2.2.2; UN R155 §7.2.2.3; ISO/SAE 21434 cl.8",
    "verify": "취약점 대응 기록 감사. 합격: 대응 기한을 넘긴 affected 판정 0건",
    "section": "15_sbom · 15.4 규칙"
  },
  {
    "id": "FFG-SBOM-006",
    "title": "OSS 라이선스와 보안 프로그램",
    "level": "필수",
    "scope": [
      "법무",
      "전 조직"
    ],
    "rule": "OpenChain ISO/IEC 5230(라이선스)과 ISO/IEC 18974(보안)에 맞춘 OSS 관리 프로그램을 운영한다.",
    "basis": "ISO/IEC 5230; ISO/IEC 18974",
    "verify": "프로그램 자기 인증 검토. 합격: 두 표준의 자기 인증 체크리스트 미충족 항목 0건",
    "section": "15_sbom · 15.4 규칙"
  },
  {
    "id": "FFG-SBOM-007",
    "title": "원산지 속성",
    "level": "필수",
    "scope": [
      "구매",
      "플랫폼"
    ],
    "rule": "미국 시장 차량의 VCS(텔레매틱스·OTA)·ADS 관련 구성요소는 SBOM에 개발 주체·국가·소유·통제 속성을 기록하고, 적합성 선언 근거로 10년 보존한다.",
    "basis": "BIS 15 CFR 791",
    "verify": "공급망 감사. 합격: 대상 구성요소 중 원산지 속성 누락 0건",
    "section": "15_sbom · 15.4 규칙"
  },
  {
    "id": "FFG-SEC-001",
    "title": "공동 HARA·TARA",
    "level": "필수",
    "scope": [
      "Safety Manager",
      "CSM"
    ],
    "rule": "Kill과 활성화 경로는 HARA와 TARA를 같은 Item 정의 위에서 함께 수행하고, 서로의 결과를 교차 검토한다.",
    "basis": "ISO 26262-2:2018 cl.5; ISO/SAE 21434 cl.15",
    "verify": "공동 검토 기록 감사. 합격: TS 중 안전 영향이 있는 항목 100%가 HARA 위험 사건과 연결된다",
    "section": "14_security_sotif · 14.7 규칙"
  },
  {
    "id": "FFG-SEC-002",
    "title": "서명·키 관리",
    "level": "필수",
    "scope": [
      "보안 배포 관리",
      "인증서·키 관리(PKI/KMS)",
      "PKI 운영"
    ],
    "rule": "14.3절의 키 계층, HSM 보관, 용도별 분리와 차량의 용도 검사, 차량 단위 key epoch 폐기, 긴급 절차, 승인 서명 기준 수를 구현한다.",
    "basis": "UN R155 Annex 5; UN R155 §7.3.8; ISO/SAE 21434 cl.10; ISO/SAE 21434 cl.12; ISO/SAE 21434 cl.13",
    "verify": "보안 감사와 침투 시험, 폐기 훈련. 합격: 용도 위반 서명의 차량 수락 0건, 폐기 훈련이 목표 시간 안에 완료",
    "section": "14_security_sotif · 14.7 규칙"
  },
  {
    "id": "FFG-SEC-003",
    "title": "대량 Kill 방지",
    "level": "필수",
    "scope": [
      "플랫폼",
      "플랫폼 게이트"
    ],
    "rule": "Feature별 이동 시간 창(예: 24시간)의 누적 Kill·복원 대상 차량 수 상한을 두고, 명령을 나눠도 누적으로 판정한다. 초과하면 Safety Manager·CSM 추가 승인과 단계적 실행을 요구한다. 상한은 플랫폼 게이트와 서명 HSM의 독립 정책 엔진 양쪽에서 강제한다.",
    "basis": "UN R155 Annex 5; ISO/SAE 21434 cl.9; ISO/SAE 21434 cl.10",
    "verify": "게이트 시험 TC-FF-48. 합격: 누적 상한 초과 주문이 모두 FAIL",
    "section": "14_security_sotif · 14.7 규칙"
  },
  {
    "id": "FFG-SEC-004",
    "title": "Kill 전달 추적",
    "level": "필수",
    "scope": [
      "플랫폼",
      "운영 조직"
    ],
    "rule": "Kill 대상 차량별 전달·적용 결과를 추적한다. 적용은 state_auth가 유효하고 persistence가 DURABLE인 보고로만 확인한다. 기한 안에 미적용인 차량은 이상 징후 대응으로 넘긴다.",
    "basis": "ISO 26262-7:2018 cl.7; UN R155 §7.2.2.2",
    "verify": "운영 보고서 감사. 합격: 기한 초과 미적용 차량 중 Incident 없는 차량 0건",
    "section": "14_security_sotif · 14.7 규칙"
  },
  {
    "id": "FFG-SEC-005",
    "title": "사이버보안 Evidence와 R155 보고",
    "level": "필수",
    "scope": [
      "CSM"
    ],
    "rule": "플랫폼과 차량 런타임의 TARA, 보안 요구, 시험, 모니터링 결과를 CSMS Evidence로 관리하고 승인 기관 보고에 쓴다.",
    "basis": "UN R155 §7.4.1; ISO/SAE 21434 cl.5; ISO/SAE 21434 cl.8",
    "verify": "CSMS 감사. 합격: 연 1회 이상 보고 기록이 있고, TS 전 항목의 처리 결정이 Evidence와 연결된다",
    "section": "14_security_sotif · 14.7 규칙"
  },
  {
    "id": "FFG-SEC-006",
    "title": "공급망 원산지 관리",
    "level": "필수",
    "scope": [
      "구매",
      "플랫폼"
    ],
    "rule": "텔레매틱스·OTA·Feature Flag SW 구성요소의 개발 주체와 원산지를 SBOM과 함께 관리한다. 미국 시장은 BIS 규칙의 적합성 선언 근거로 쓴다.",
    "basis": "BIS 15 CFR 791; UN R155 §7.2.2.5",
    "verify": "공급망 감사. 합격: 원산지 속성이 없는 배포 구성요소 0건",
    "section": "14_security_sotif · 14.7 규칙"
  },
  {
    "id": "FFG-SEC-007",
    "title": "보안 이벤트 정의와 모니터링",
    "level": "필수",
    "scope": [
      "Safety Guard",
      "LPC",
      "플랫폼"
    ],
    "rule": "14.4절의 보안 이벤트를 IdsM 이벤트로 정의하고 임계값을 정한다. 임계값을 넘으면 SECURITY_MONITORING 범주로 VSOC에 보낸다. 진위 실패가 정한 횟수를 넘으면 채널 처리를 제한한다. 포렌식 데이터를 보존한다.",
    "basis": "UN R155 §7.3.7; UN R155 §7.2.2.3; ISO/SAE 21434 cl.8; ISO/SAE 21434 cl.13",
    "verify": "단위시험(보안 이벤트 보고)과 VSOC 상관 분석 시험. 합격: 14.4절 이벤트 100%가 IdsM 보고와 VSOC 경보로 이어진다",
    "section": "14_security_sotif · 14.7 규칙"
  },
  {
    "id": "FFG-SEC-008",
    "title": "원격 종료 오남용 방지",
    "level": "필수",
    "scope": [
      "플랫폼",
      "Safety Guard"
    ],
    "rule": "ADS 기능의 원격 종료는 ADS fallback으로만 진행한다. 대량 종료는 FFG-ADS-011의 계획과 FFG-SEC-003의 상한을 따른다. 종료 명령의 발행 권한은 IAM에서 별도 역할로 관리한다.",
    "basis": "UN ADS GTR 제안문 §4.3.4; UN ADS GTR 제안문 §4.1.4.4.1; UN R155 Annex 5",
    "verify": "침투 시험과 HIL 시험 TC-FF-54, TC-FF-55. 합격: 별도 역할 없는 종료 발행 0건, fallback 없는 출력 중단 0건",
    "section": "14_security_sotif · 14.7 규칙"
  },
  {
    "id": "FFG-SOT-001",
    "title": "Feature Version별 SOTIF 갱신",
    "level": "필수",
    "scope": [
      "Feature Owner",
      "Safety Manager"
    ],
    "rule": "거동을 바꾸는 새 Feature Version마다 기능 사양, 위험, 성능 한계, 트리거 조건, 위험 시나리오 평가를 갱신한다.",
    "basis": "ISO 21448:2022 cl.5; ISO 21448:2022 cl.6; ISO 21448:2022 cl.7; ISO 21448:2022 cl.10",
    "verify": "SOTIF 검토 기록 감사. 합격: 거동 변경 Version 중 SOTIF 갱신 기록이 없는 것 0건",
    "section": "14_security_sotif · 14.7 규칙"
  },
  {
    "id": "FFG-SOT-002",
    "title": "ODD 축소 정책도 비활성화 등급을 따름",
    "level": "필수",
    "scope": [
      "플랫폼",
      "차량 SW"
    ],
    "rule": "트리거 조건 대응으로 Feature를 특정 조건에서 제한하는 정책은 새 Feature Version으로 등록하고, 7장의 등급과 승인 절차를 그대로 따른다.",
    "basis": "ISO 21448:2022 cl.13; UN R156 §7.2.2",
    "verify": "게이트 시험. 합격: 등급 없는 ODD 축소 정책의 배포 0건",
    "section": "14_security_sotif · 14.7 규칙"
  },
  {
    "id": "FFG-SOT-003",
    "title": "운영 단계 SOTIF 모니터링",
    "level": "필수",
    "scope": [
      "품질 피드백 반영",
      "이상 징후 대응"
    ],
    "rule": "텔레메트리와 사고 데이터에서 트리거 조건과 오용을 찾아 시나리오 저장소에 추가하고 재평가한다.",
    "basis": "ISO 21448:2022 cl.13",
    "verify": "운영 보고서 감사. 합격: 확인된 트리거 조건 중 시나리오가 없는 것 0건",
    "section": "14_security_sotif · 14.7 규칙"
  },
  {
    "id": "FFG-SOT-004",
    "title": "SOTIF 출시 기준을 G7에 연결",
    "level": "필수",
    "scope": [
      "Safety Manager"
    ],
    "rule": "F2 이상 Feature의 G7 판정에는 ISO 21448의 출시 기준과 잔여 위험 근거를 포함한다.",
    "basis": "ISO 21448:2022 cl.12",
    "verify": "G7 Decision Record 검토. 합격: SOTIF 근거 없는 F2 이상 G7 PASS 0건",
    "section": "14_security_sotif · 14.7 규칙"
  },
  {
    "id": "FFG-SOT-005",
    "title": "AI 기반 Feature",
    "level": "권장",
    "scope": [
      "Feature Owner"
    ],
    "rule": "AI·ML 모델을 쓰는 Feature는 ISO/PAS 8800의 데이터·모델 수명주기 요구를 추가로 적용한다. 모델 교체는 새 Feature Version으로 관리한다.",
    "basis": "ISO/PAS 8800; EU 2024/1689",
    "verify": "AI 안전 검토. 합격: 모델 교체 중 Feature Version 변경이 없는 것 0건",
    "section": "14_security_sotif · 14.7 규칙"
  },
  {
    "id": "FFG-SUP-001",
    "title": "Evidence 일원화와 이중 연결",
    "level": "필수",
    "scope": [
      "전 조직"
    ],
    "rule": "Evidence는 한 번 만들고, ASPICE BP와 ISO 26262 작업 산출물 연결을 메타데이터로 붙인다. 같은 내용의 문서를 체계별로 따로 만들지 않는다.",
    "basis": "Automotive SPICE; ISO 26262-8:2018 cl.10",
    "verify": "Evidence 저장소 감사. 합격: 표본 Evidence 100%에 두 체계 연결이 있고, 내용이 다른 중복 문서 0건",
    "section": "16_aspice · 16.6 규칙"
  },
  {
    "id": "FFG-SUP-002",
    "title": "형상 항목 범위",
    "level": "필수",
    "scope": [
      "내부",
      "협력사"
    ],
    "rule": "소스뿐 아니라 Flag 정의, 정책, 스키마, 설정 표, 빌드 옵션, 도구 Version, 시험 시나리오를 형상 항목으로 관리한다.",
    "basis": "ISO 26262-8:2018 cl.7; Automotive SPICE SUP.8",
    "verify": "형상 감사. 합격: 출시 Baseline에서 위 항목 중 형상 항목이 아닌 것 0건",
    "section": "16_aspice · 16.6 규칙"
  },
  {
    "id": "FFG-SUP-003",
    "title": "Feature Flag 특화 평가 포인트",
    "level": "필수",
    "scope": [
      "품질 조직"
    ],
    "rule": "내부와 협력사의 ASPICE 평가 계획에 16.4절의 평가 질문을 넣는다. 결과는 개선 계획과 함께 기록한다.",
    "basis": "Automotive SPICE; ISO 26262-2:2018 cl.6",
    "verify": "평가 보고서 검토. 합격: 16.4절 질문 중 평가되지 않은 항목 0건",
    "section": "16_aspice · 16.6 규칙"
  },
  {
    "id": "FFG-SUP-004",
    "title": "DIA·CIA에 이 보고서 인용",
    "level": "필수",
    "scope": [
      "구매",
      "협력사"
    ],
    "rule": "Feature Flag 관련 SW·서비스를 공급하는 협력사의 DIA와 CIA에는 일곱 항목을 적는다. 이 보고서의 Version과 적용 장, 17.5절 RASIC, 17.6절 납품물, 17.4.3절 시간 예산 부속서, 17.9절 결함·변경 통지 기한, 17.10절 현장 지원 SLA다.",
    "basis": "ISO 26262-8:2018 cl.5; ISO/SAE 21434 cl.7; Automotive SPICE ACQ.4",
    "verify": "DIA·CIA 검토. 합격: 일곱 항목이 모두 있는 서명본이 G1 전에 있다",
    "section": "17_supplier · 17.12 규칙"
  },
  {
    "id": "FFG-SUP-005",
    "title": "계약 전 역량 확인",
    "level": "필수",
    "scope": [
      "구매",
      "품질 조직"
    ],
    "rule": "16.5절 범위의 ASPICE·사이버보안 평가 결과를 계약 전에 확인한다. ADS 관련 협력사는 SMS 역량 평가를 더한다. 부족하면 개선 계획과 기한을 합의한다.",
    "basis": "Automotive SPICE; ISO 26262-8:2018 cl.5; UN ADS GTR 제안문 §5.1.4.2.1",
    "verify": "평가 보고서 검토. 합격: 평가 없이 계약한 유형 A·B·D·E 협력사 0건",
    "section": "17_supplier · 17.12 규칙"
  },
  {
    "id": "FFG-SUP-006",
    "title": "Safety Manual과 사용 가정",
    "level": "필수",
    "scope": [
      "협력사"
    ],
    "rule": "SEooC로 공급하는 요소는 사용 가정(AoU)을 포함한 Safety Manual을 납품한다. 각 AoU는 통합 측이 확인할 수 있는 형태로 쓴다.",
    "basis": "ISO 26262-10:2018 cl.9",
    "verify": "입고 검사 IN-07. 합격: 확인 방법이 없는 AoU 0건",
    "section": "17_supplier · 17.12 규칙"
  },
  {
    "id": "FFG-SUP-007",
    "title": "MISRA Compliance 패키지",
    "level": "필수",
    "scope": [
      "협력사"
    ],
    "rule": "G4에 GEP와 GRP를, G5에 일탈 기록과 GCS를 10.8절 구조로 납품한다. 필수(Mandatory) 지침은 위반이 없어야 한다.",
    "basis": "MISRA Compliance:2020",
    "verify": "입고 검사 IN-03, IN-12. 합격: 필수 지침 위반 0건, 서명 없는 일탈 0건",
    "section": "17_supplier · 17.12 규칙"
  },
  {
    "id": "FFG-SUP-008",
    "title": "Gate별 납품물과 합격 기준",
    "level": "필수",
    "scope": [
      "협력사",
      "품질 조직"
    ],
    "rule": "협력사는 17.6절의 Gate별 납품물을 정한 형식으로 낸다. OEM은 표의 합격 기준으로 판정하고, 판정 결과를 Gate 기록에 남긴다.",
    "basis": "ISO 26262-8:2018 cl.5; Automotive SPICE ACQ.4",
    "verify": "Gate 기록 감사. 합격: 합격 기준 판정 기록 없이 Gate 입력으로 쓰인 납품물 0건",
    "section": "17_supplier · 17.12 규칙"
  },
  {
    "id": "FFG-SUP-009",
    "title": "OEM의 독립 입고 검사",
    "level": "필수",
    "scope": [
      "품질 조직",
      "시험 조직"
    ],
    "rule": "OEM은 17.7절의 IN-01~IN-12를 수행한다. 시험·분석은 OEM 환경에서 다시 실행한다. 수정 납품은 일부가 아니라 전 항목을 다시 검사한다.",
    "basis": "ISO 26262-8:2018 cl.5; ISO 26262-8:2018 cl.9",
    "verify": "입고 기록 감사. 합격: 재실행 없이 수용한 시험 결과 0건",
    "section": "17_supplier · 17.12 규칙"
  },
  {
    "id": "FFG-SUP-010",
    "title": "결함 통지 SLA",
    "level": "필수",
    "scope": [
      "협력사"
    ],
    "rule": "심각도별 통지·봉쇄·수정 기한을 DIA에 넣고 지킨다. DIA가 정하지 않으면 17.9.1절의 기본값을 적용한다.",
    "basis": "ISO 26262-8:2018 cl.5; NHTSA Part 573",
    "verify": "결함 통지 기록 감사. 합격: 기한을 넘긴 S1·S2 통지 0건",
    "section": "17_supplier · 17.12 규칙"
  },
  {
    "id": "FFG-SUP-011",
    "title": "변경 사전 통지",
    "level": "필수",
    "scope": [
      "협력사"
    ],
    "rule": "17.9.2절의 변경은 적용 전에 정한 기간 안에 통지하고 OEM 동의를 받는다. 동의 전 변경한 SW는 납품하지 않는다.",
    "basis": "ISO 26262-8:2018 cl.8; UN ADS GTR 제안문 §5.1.6.2",
    "verify": "변경 기록과 입고 검사 IN-02 대조. 합격: 통지 없이 바뀐 컴파일러·도구·하위 협력사 0건",
    "section": "17_supplier · 17.12 규칙"
  },
  {
    "id": "FFG-SUP-012",
    "title": "협력사 도구 분류와 시뮬레이션 도구 체계",
    "level": "필수",
    "scope": [
      "협력사"
    ],
    "rule": "개발·검증에 쓴 도구의 TI·TD·TCL과 qualification 근거를 납품한다. 시뮬레이션 결과를 Evidence로 내면 12.4절의 근거를 함께 낸다.",
    "basis": "ISO 26262-8:2018 cl.11; UN ADS GTR 제안문 §5.2.1",
    "verify": "입고 검사 IN-08. 합격: TCL2 이상 도구의 근거 누락 0건",
    "section": "17_supplier · 17.12 규칙"
  },
  {
    "id": "FFG-SUP-013",
    "title": "하위 협력사 관리",
    "level": "필수",
    "scope": [
      "협력사"
    ],
    "rule": "하위 협력사에 맡기는 작업에는 이 장의 요구를 같은 수준으로 반영한다. Kill·활성화 경로 작업의 하위 위탁은 OEM 사전 서면 승인을 받는다.",
    "basis": "ISO 26262-8:2018 cl.5; ISO/SAE 21434 cl.7; UN ADS GTR 제안문 §5.1.4.2",
    "verify": "하위 협력사 계약 감사. 합격: 요구 반영 또는 승인이 없는 하위 위탁 0건",
    "section": "17_supplier · 17.12 규칙"
  },
  {
    "id": "FFG-SUP-014",
    "title": "확인 조치의 독립성 보장",
    "level": "필수",
    "scope": [
      "Safety Manager"
    ],
    "rule": "협력사 범위의 확인 검토, 감사, 기능안전 평가는 12.5절의 독립성 수준을 만족하는 사람이 수행한다. 협력사의 자체 선언만으로 승인하지 않는다.",
    "basis": "ISO 26262-2:2018 cl.6",
    "verify": "확인 조치 기록 감사. 합격: 독립성 미충족 수행자의 확인 조치 0건",
    "section": "17_supplier · 17.12 규칙"
  },
  {
    "id": "FFG-SUP-015",
    "title": "현장 지원과 Evidence 보존",
    "level": "필수",
    "scope": [
      "협력사"
    ],
    "rule": "17.10절의 SLA를 DIA 또는 생산·운영 합의에 넣고 지킨다. Evidence와 도구 체계를 정한 기간 동안 보존하고 재실행할 수 있게 한다.",
    "basis": "ISO 26262-7:2018 cl.7; ISO 26262-8:2018 cl.10; UN ADS GTR 제안문 §5.2.1.5.1.1",
    "verify": "보존 감사(표본 Evidence 재실행). 합격: 표본 재실행 성공",
    "section": "17_supplier · 17.12 규칙"
  },
  {
    "id": "FFG-SUP-016",
    "title": "기존 구현 진단",
    "level": "필수",
    "scope": [
      "협력사",
      "품질 조직"
    ],
    "rule": "기존 Feature Flag 구현을 재사용하거나 운영 중인 구현을 이어받으면 17.11절의 절차로 진단하고 차이 보고를 G2에 낸다.",
    "basis": "ISO 26262-8:2018 cl.12; ISO 26262-2:2018 cl.6",
    "verify": "차이 보고 검토. 합격: 17.11절 표의 패턴 중 확인되지 않은 것 0건",
    "section": "17_supplier · 17.12 규칙"
  },
  {
    "id": "FFG-SUP-017",
    "title": "법적 의무를 위한 안전 정보 제공",
    "level": "필수",
    "scope": [
      "협력사",
      "법규 담당"
    ],
    "rule": "협력사는 OEM이 당국 보고, 리콜 판단, 사건 조사를 할 수 있도록 요청받은 안전 정보를 기한 안에 제공한다. 제공 범위와 기한을 DIA 또는 운영 합의에 적는다.",
    "basis": "UN ADS GTR 제안문 §5.1.4.2.1; NHTSA Part 573",
    "verify": "정보 요청 기록 감사. 합격: 기한을 넘긴 정보 제공 0건",
    "section": "17_supplier · 17.12 규칙"
  },
  {
    "id": "FFG-TEL-001",
    "title": "목적별 데이터 범주와 접근 분리",
    "level": "필수",
    "scope": [
      "플랫폼",
      "차량 SW"
    ],
    "rule": "텔레메트리는 13.1절의 목적별 범주로 표시한다. 범주마다 접근 권한과 보존 기간을 따로 관리한다.",
    "basis": "GDPR Art.5; UN R155 §7.2.2.4; UN ADS GTR 제안문 §5.1.8.5.4",
    "verify": "데이터 카탈로그 감사. 합격: 범주 표시가 없는 필드 0건, 범주 밖 접근 권한 0건",
    "section": "13_telemetry · 13.9 규칙"
  },
  {
    "id": "FFG-TEL-002",
    "title": "최소 수집과 가명화",
    "level": "필수",
    "scope": [
      "차량 SW"
    ],
    "rule": "13.2절의 최소 집합만 보낸다. 차량 ID는 가명화한다. 위치·운전자 데이터는 별도 목적과 동의가 있을 때만 수집한다.",
    "basis": "GDPR Art.25; EDPB 01/2020; PIPL",
    "verify": "스키마 검증. 합격: 스키마에 없는 필드를 가진 보고 0건, VIN 평문 0건",
    "section": "13_telemetry · 13.9 규칙"
  },
  {
    "id": "FFG-TEL-003",
    "title": "실제 상태 보고와 무결성",
    "level": "필수",
    "scope": [
      "차량 SW",
      "운영 데이터 수집"
    ],
    "rule": "상태 보고는 Guard의 실제 상태만 담는다. 보고마다 report_seq와 Guard가 만든 state_auth를 넣는다. 플랫폼은 13.3.1의 검사에서 실패한 보고로 Kill 적용을 확인하지 않는다.",
    "basis": "ISO 26262-7:2018 cl.7; UN R155 §7.3.7",
    "verify": "스키마 검증과 결함 주입 시험 TC-FF-24. 합격: 위조·역행 보고로 적용 확인된 건 0건",
    "section": "13_telemetry · 13.9 규칙"
  },
  {
    "id": "FFG-TEL-004",
    "title": "EDR·DSSAD·사고 보고 정합",
    "level": "필수",
    "scope": [
      "차량 SW",
      "이벤트 이력 추적"
    ],
    "rule": "상태 보고에 EDR 정합 상태와 시간 동기 품질을 넣는다. 사고 분석에서 원격 Kill과 고장을 구분할 수 있어야 한다. ADS 기능은 DSSAD 이벤트와 명령 ID로 연결한다.",
    "basis": "UN R160; 49 CFR 563; GB 39732; GB 44497; NHTSA SGO; UN ADS GTR 제안문 Annex 6 §5.2.1",
    "verify": "사고 재구성 시험 TC-FF-57. 합격: 표본 사건 100%에서 Kill·고장 구분과 기록 연결이 일치",
    "section": "13_telemetry · 13.9 규칙"
  },
  {
    "id": "FFG-TEL-005",
    "title": "중국 데이터의 현지 처리와 이전 심사",
    "level": "필수",
    "scope": [
      "플랫폼",
      "법무"
    ],
    "rule": "중국 시장의 텔레메트리와 OTA 데이터는 중요 데이터를 식별해 현지에서 처리한다. 국외 이전(국외 조회 포함)은 안전 평가, 표준 계약, 인증 중 하나를 거친다.",
    "basis": "PIPL; MIIT 2026 국외 이전 지침; 중국 자동차 데이터 안전 규정 2021",
    "verify": "데이터 흐름 감사. 합격: 승인 경로 없는 국외 이전 0건",
    "section": "13_telemetry · 13.9 규칙"
  },
  {
    "id": "FFG-TEL-006",
    "title": "EU Data Act 접근권",
    "level": "필수",
    "scope": [
      "플랫폼"
    ],
    "rule": "모든 EU 차량에 대해 사용자 요청 시 Feature 상태·이력 데이터를 제공하고 제3자와 공유하는 절차(Art.4·5)를 운영한다. 2026-09-12 이후 EU에 출시하는 차량은 설계 단계 직접 접근(Art.3(1))을 추가한다. 비개인 데이터를 OEM이 쓰려면 사용자와의 계약 근거를 둔다.",
    "basis": "EU 2023/2854",
    "verify": "법무 검토. 합격: 요청 처리 절차와 계약 근거 문서가 있고, 표본 요청 처리 기록이 있다",
    "section": "13_telemetry · 13.9 규칙"
  },
  {
    "id": "FFG-TEL-007",
    "title": "텔레메트리는 안전 판정에 쓰지 않음",
    "level": "필수",
    "scope": [
      "아키텍트",
      "차량 SW"
    ],
    "rule": "텔레메트리의 도착 여부나 지연이 차량의 안전 판정에 영향을 주지 않도록 설계한다.",
    "basis": "ISO 26262-4:2018 cl.6",
    "verify": "통신 단절 HIL 시험. 합격: 단절 중 Guard 상태·출력 변화 0건",
    "section": "13_telemetry · 13.9 규칙"
  },
  {
    "id": "FFG-TEL-008",
    "title": "보존과 삭제",
    "level": "필수",
    "scope": [
      "플랫폼"
    ],
    "rule": "13.7절의 보존 기간을 데이터 범주별로 적용하고, 기간이 지나면 삭제한다. 삭제 기록을 남긴다. 열린 Incident에 연결된 데이터는 삭제하지 않는다.",
    "basis": "GB 44496; GDPR Art.5; ISO 26262-8:2018 cl.10; UN ADS GTR 제안문 §5.1.8.5.3",
    "verify": "보존 정책 감사. 합격: 기간 초과 데이터 0건, 열린 Incident 데이터의 삭제 0건",
    "section": "13_telemetry · 13.9 규칙"
  },
  {
    "id": "FFG-TEL-009",
    "title": "운행 중 감시 지표와 부속서 1 집계",
    "level": "필수",
    "scope": [
      "운영 조직",
      "플랫폼"
    ],
    "rule": "Feature Version별로 13.5절의 지표를 정하고 경보 기준을 Safety Case에 기록한다. ADS 기능은 13.4절의 부속서 1 항목을 정기 보고 형식으로 집계한다.",
    "basis": "UN ADS GTR 제안문 §5.1.8.5.7; UN ADS GTR 제안문 §5.4.9; ISO 21448:2022 cl.13",
    "verify": "운영 보고서 감사. 합격: 지표가 없는 출시 Feature Version 0건, 부속서 1 항목 누락 0건",
    "section": "13_telemetry · 13.9 규칙"
  },
  {
    "id": "FFG-TEL-010",
    "title": "30초 규칙 판정에 필요한 상태 이력",
    "level": "필수",
    "scope": [
      "Safety Guard",
      "플랫폼"
    ],
    "rule": "ADS 기능의 활성·비활성 전이 시각을 신뢰 시간으로 기록하고 보고한다. 신뢰 시간이 없는 전이는 time_sync로 표시하고, 보고 대상 판정에서 보수적으로 다룬다.",
    "basis": "UN ADS GTR 제안문 §5.4.6",
    "verify": "기록 감사와 HIL 시험 TC-FF-57. 합격: 표본 사건 100%에서 30초 판정에 필요한 시각이 있거나 불확실로 표시된다",
    "section": "13_telemetry · 13.9 규칙"
  },
  {
    "id": "FFG-TST-001",
    "title": "비활성화 등급별 시나리오 시험",
    "level": "필수",
    "scope": [
      "차량 SW",
      "시험 조직"
    ],
    "rule": "F2 이상 Feature는 등급별 동작을 단위, HIL, 차량 수준에서 시험한다. 시험 상황은 작동 중, 비작동 중, 운전자 개입, 전원 주기를 포함한다.",
    "basis": "ISO 26262-6:2018 cl.9; ISO 26262-4:2018 cl.7",
    "verify": "시험 보고서 검토. 합격: 7.5절 상태표의 전이 100%가 시험으로 덮이고, TC-FF-09~14, TC-FF-42 실패 0건",
    "section": "12_testing · 12.8 규칙"
  },
  {
    "id": "FFG-TST-002",
    "title": "통신 결함 전 유형 시험",
    "level": "필수",
    "scope": [
      "차량 SW"
    ],
    "rule": "반복, 손실, 지연, 삽입, 위장, 변조, 순서 오류를 모두 시험한다. 유형마다 기대 결과 코드를 9.3절 표에서 정한다. 어느 경우에도 Guard 상태는 바뀌지 않는다.",
    "basis": "ISO 26262-6:2018 Annex D",
    "verify": "단위시험 TC-FF-01~08, TC-FF-25. 합격: 일곱 유형 모두 시험이 있고, 거부 후 상태 변화 0건",
    "section": "12_testing · 12.8 규칙"
  },
  {
    "id": "FFG-TST-003",
    "title": "허용 조합 정의와 covering array",
    "level": "필수",
    "scope": [
      "시험 조직",
      "플랫폼"
    ],
    "rule": "허용 조합을 Topology의 의존·충돌 관계로 정의한다. 안전 관련 Flag가 둘 이상 상호작용하면 3-way 이상 covering array로 시험한다. 허용되지 않는 조합은 부정 시험으로 거부를 확인한다.",
    "basis": "ISO 26262-6:2018 Annex C; NIST ACTS",
    "verify": "조합 시험 보고서 검토. 합격: 허용 조합의 지정 강도 묶음 100% 덮음, 허용되지 않는 조합의 수락 0건",
    "section": "12_testing · 12.8 규칙"
  },
  {
    "id": "FFG-TST-004",
    "title": "결함 주입",
    "level": "필수",
    "scope": [
      "시험 조직",
      "차량 SW"
    ],
    "rule": "NvM 손상·삭제, 비동기 쓰기 실패, RAM 비트 반전, 신뢰 시간 상실, HSM 오류, 자체 시험 실패를 주입한다. 주입마다 HARA Safe State 또는 설계 기본 동작으로 수렴하는지 확인한다.",
    "basis": "ISO 26262-6:2018 Table 7; ISO 26262-4:2018 cl.7",
    "verify": "결함 주입 시험 TC-FF-18, TC-FF-19, TC-FF-34, TC-FF-35, TC-FF-39, TC-FF-41. 합격: 주입한 결함 100%에서 출력이 Safe State 또는 설계 기본 동작",
    "section": "12_testing · 12.8 규칙"
  },
  {
    "id": "FFG-TST-005",
    "title": "LPC 장악 가정 시험",
    "level": "필수",
    "scope": [
      "시험 조직",
      "LPC",
      "Safety Guard"
    ],
    "rule": "LPC(QM)가 장악되었다고 가정한다. 유효한 E2E와 임의 cmd_auth를 가진 프레임, 요청 유형을 바꾼 정상 봉투, 위조된 상태 보고를 만든다. 각각 Guard(AUTH_FAILED)와 플랫폼(state_auth 검증 실패)에서 거부되는지 시험한다.",
    "basis": "ISO 26262-6:2018 Annex D; UN R155 Annex 5; ISO/SAE 21434 cl.10",
    "verify": "SIL 시험 TC-FF-04, TC-FF-24. 합격: 세 위조 유형의 수락 0건",
    "section": "12_testing · 12.8 규칙"
  },
  {
    "id": "FFG-TST-006",
    "title": "시뮬레이션 도구 체계의 신뢰성",
    "level": "필수",
    "scope": [
      "시험 조직"
    ],
    "rule": "시뮬레이션 결과를 합격 판정이나 Safety Case 증거에 쓰면 도구를 ISO 26262-8 cl.11로 분류한다. ADS 기능은 12.4절 표의 §5.2.1 항목별 근거를 함께 낸다. 시뮬레이션이 판정하지 못하는 주장은 HIL·시험장·실차 시험으로 확인한다.",
    "basis": "ISO 26262-8:2018 cl.11; UN ADS GTR 제안문 §5.2.1",
    "verify": "도구 분류 보고서와 상관성 분석 검토. 합격: 판정에 쓰인 도구의 미분류 0건, ADS 기능은 §5.2.1 항목별 근거 누락 0건",
    "section": "12_testing · 12.8 규칙"
  },
  {
    "id": "FFG-TST-007",
    "title": "시나리오 정의와 Version 관리",
    "level": "필수",
    "scope": [
      "시험 조직"
    ],
    "rule": "시나리오와 ODD를 ISO 34502·ISO 34503 형식으로 정의하고 Version을 관리한다. 운영 단계에서 발견한 트리거 조건은 30일 안에 시나리오로 추가한다(목표).",
    "basis": "ISO 34502; ISO 21448:2022 cl.13",
    "verify": "시나리오 저장소 감사. 합격: 시험 결과의 시나리오 ID 중 저장소에 없는 것 0건",
    "section": "12_testing · 12.8 규칙"
  },
  {
    "id": "FFG-TST-008",
    "title": "출시 구성별 커버리지",
    "level": "필수",
    "scope": [
      "차량 SW"
    ],
    "rule": "출시되는 각 구성(컴파일 시점 변형, Post-build 설정 집합)에서 FFG-CODE-028의 커버리지 목표를 적용한다. 미달 항목마다 근거를 기록한다.",
    "basis": "ISO 26262-6:2018 Table 9; ISO 26262-6:2018 Table 12",
    "verify": "커버리지 보고 검토. 합격: 근거 없는 미달 항목 0건",
    "section": "12_testing · 12.8 규칙"
  },
  {
    "id": "FFG-TST-009",
    "title": "시험 Evidence의 연계와 재현 정보",
    "level": "필수",
    "scope": [
      "플랫폼",
      "시험 조직"
    ],
    "rule": "시험 명세와 결과는 시험관리 도구에서 Feature ID·Version과 연결하고, IF-09로 플랫폼 검증 이력 관리에 전달한다. 결과에는 12.7절의 재현 정보를 넣는다. G5는 연결되지 않은 시험을 인정하지 않는다.",
    "basis": "ISO 26262-8:2018 cl.9; Automotive SPICE SWE.4; UN ADS GTR 제안문 §5.3.3.9.3",
    "verify": "추적성 보고 검토. 합격: G5 대상 시험 중 Feature 연결 또는 재현 정보가 없는 것 0건",
    "section": "12_testing · 12.8 규칙"
  },
  {
    "id": "FFG-TST-010",
    "title": "운영 단계 Canary와 Shadow 판정 기준",
    "level": "필수",
    "scope": [
      "운영 조직"
    ],
    "rule": "Canary와 Shadow에는 관측 기간, 차량 수, 허용 차이, 중단 기준을 미리 정하고 G7 입력으로 쓴다. Shadow 출력은 제어기에 전달하지 않는다.",
    "basis": "ISO 21448:2022 cl.13; ISO 26262-6:2018 Annex D",
    "verify": "운영 보고서 검토와 FFI 분석. 합격: 기준 없이 시작한 Canary 0건, Shadow 출력의 제어 경로 연결 0건",
    "section": "12_testing · 12.8 규칙"
  },
  {
    "id": "FFG-TST-011",
    "title": "ADS 원격 종료 시나리오 시험",
    "level": "필수",
    "scope": [
      "시험 조직",
      "차량 SW"
    ],
    "rule": "ADS 기능은 TC-FF-54~57을 HIL과 시험장에서 수행한다. 인계 성공, 인계 실패 후 MRC, 종료 중 ODD 이탈, 기록 정합을 모두 포함한다.",
    "basis": "UN ADS GTR 제안문 §4.1.4.4.1; UN ADS GTR 제안문 §4.2.2.3.6; UN ADS GTR 제안문 §5.2.2",
    "verify": "HIL·시험장 시험 보고서 검토. 합격: 제어가 끊긴 주기 0건, 종료 후 활성화 성공 0건, DSSAD와 플랫폼 기록의 불일치 0건",
    "section": "12_testing · 12.8 규칙"
  },
  {
    "id": "FFG-VEH-001",
    "title": "Safety Guard는 독립 ASIL 요소",
    "level": "필수",
    "scope": [
      "차량 SW"
    ],
    "rule": "Safety Guard는 소비 기능 중 최고 ASIL로 개발하고, 독립 파티션에서 실행한다. QM 요소가 Guard 상태, Guard의 NvM 블록, Guard의 HSM 키 슬롯을 쓸 수 없게 한다. 진단(UDS)으로 Guard 블록을 쓰는 서비스는 EOL 프로비저닝(AoU-13) 외에는 두지 않는다.",
    "basis": "ISO 26262-6:2018 Annex D; ISO 26262-9:2018 cl.6",
    "verify": "FFI 분석과 MPU 설정 검토. 합격: QM 파티션에서 Guard 메모리·NvM 블록·키 슬롯에 쓰기 가능한 경로가 0건이다",
    "section": "09_vehicle_runtime · 9.12 규칙"
  },
  {
    "id": "FFG-VEH-002",
    "title": "진위는 백엔드 기원, Guard가 직접 검증",
    "level": "필수",
    "scope": [
      "차량 SW",
      "플랫폼"
    ],
    "rule": "명령의 진위는 플랫폼 서명 HSM이 차량별 키로 만든 cmd_auth로 증명하고, Guard가 QM이 쓸 수 없는 HSM 키 슬롯으로 검증한다. LPC는 명령 키를 갖지 않고 cmd_auth를 그대로 전달한다. 대상, 순번, 시간, 등급, Version 검증도 LPC 결과와 무관하게 Guard가 다시 수행한다. 이것이 불가능한 설계라면 ACTIVATE·RESTORE를 만드는 LPC 기능을 Guard와 같은 ASIL로 개발한다.",
    "basis": "ISO 26262-6:2018 Annex D; ISO 26262-9:2018 cl.7; UN R155 §7.3.4; ISO/SAE 21434 cl.10; UN ADS GTR 제안문 §4.3.4",
    "verify": "단위시험 TC-FF-04(QM 측 장악 가정). 합격: 유효한 E2E와 임의 cmd_auth를 가진 프레임, 요청 유형을 바꾼 정상 봉투가 모두 AUTH_FAILED다",
    "section": "09_vehicle_runtime · 9.12 규칙"
  },
  {
    "id": "FFG-VEH-003",
    "title": "프레임의 필드·코드값·검증 순서",
    "level": "필수",
    "scope": [
      "차량 SW"
    ],
    "rule": "LPC와 Guard 사이 요청·응답의 필드, 코드값, 검증 순서는 9.2~9.4절을 따른다. 바이트 배치와 E2E·SecOC 헤더는 Safety Concept에서 고른 E2E Profile과 SecOC 설정을 따르고(9.10절), ICD로 확정해 G4에 납품한다. 9.2절의 56바이트 배치는 예제다.",
    "basis": "ISO 26262-6:2018 Annex D; AUTOSAR",
    "verify": "단위시험 TC-FF-01~08, TC-FF-40(변조·반복·손실·위장·응답). 합격: 실패 0건이고, ICD의 모든 필드가 시험으로 덮인다",
    "section": "09_vehicle_runtime · 9.12 규칙"
  },
  {
    "id": "FFG-VEH-004",
    "title": "신뢰 시간과 시간 정책",
    "level": "필수",
    "scope": [
      "차량 SW"
    ],
    "rule": "신뢰 시간은 AoU-01의 조건을 만족하는 UTC다. 그렇지 않으면 utc_valid는 거짓이다. 신뢰 시간이 없으면 복원·활성화·SYNC와 상업·운영·법규 사유 요청을 거부한다. 안전·보안 사유의 비활성화는 수락하고 TIME_UNVERIFIED 이벤트를 보고한다. 신뢰 시간이 있으면 [not_before, expires) 구간을 검사한다.",
    "basis": "UN R155 Annex 5; ISO/SAE 21434 cl.10",
    "verify": "단위시험 TC-FF-25와 동기 상실·RTC 단독 통합시험. 합격: 시간 없이 수락된 비(非)Kill 요청 0건, 경계 시각 판정이 정의와 일치",
    "section": "09_vehicle_runtime · 9.12 규칙"
  },
  {
    "id": "FFG-VEH-005",
    "title": "영속성과 초기화 동작",
    "level": "필수",
    "scope": [
      "차량 SW"
    ],
    "rule": "9.5절의 영속성·전원 주기 동작을 구현한다. 초기화에서 기록을 읽어 상태를 복원한다. EOL 이후 기록을 읽지 못하거나 기록이 없으면 DISABLED, 원천 STARTUP, 순번 신뢰 없음으로 시작하고 그 상태를 기록한다. DC4는 설계 기본 동작을 유지한다. 순번 신뢰가 없으면 Kill과 이번 시동의 참조를 resync_ref로 가진 승인된 RESTORE만 받는다.",
    "basis": "ISO 26262-6:2018 Annex C; AUTOSAR; UN ADS GTR 제안문 §4.1.4.4.2",
    "verify": "전원 주기 시험과 결함 주입 TC-FF-18, TC-FF-35, TC-FF-60. 합격: 기록 손실 후 ACTIVE로 시작한 경우 0건, 재동기 전 활성화 수락 0건, 이전 시동의 RESTORE 수락 0건",
    "section": "09_vehicle_runtime · 9.12 규칙"
  },
  {
    "id": "FFG-VEH-006",
    "title": "활성화 전 차량 지원 조건 확인",
    "level": "필수",
    "scope": [
      "기능 지원 조건 관리"
    ],
    "rule": "활성화 전에 차량 HW 리비전, SW 버전, 보정 데이터, 센서 상태가 Feature 요구를 만족하는지 확인한다. 만족하지 않으면 사유를 보고하고 비활성을 유지한다.",
    "basis": "ISO 26262-6:2018 Annex C; UN R156 §7.2.2.5; UN ADS GTR 제안문 §4.3.3.1(d)",
    "verify": "단위시험과 차량 시험(조건별 불만족 1건씩). 합격: 불만족 조건에서 활성화 0건, 사유 보고 100%",
    "section": "09_vehicle_runtime · 9.12 규칙"
  },
  {
    "id": "FFG-VEH-007",
    "title": "실제 구성 Attestation",
    "level": "필수",
    "scope": [
      "LPC",
      "플랫폼"
    ],
    "rule": "차량은 적용 중인 정책 해시, Feature Version, BOM 식별자를 주기적으로 보고한다. 플랫폼은 기대 구성과 비교해 불일치를 Incident로 처리한다.",
    "basis": "ISO 26262-7:2018 cl.7; UN R156 §7.1.1; Knight Capital",
    "verify": "불일치 탐지 시험(구성 1개 변조). 합격: 다음 보고 주기 안에 Incident가 생성된다",
    "section": "09_vehicle_runtime · 9.12 규칙"
  },
  {
    "id": "FFG-VEH-008",
    "title": "연결과 무관한 안전 판정",
    "level": "필수",
    "scope": [
      "차량 SW"
    ],
    "rule": "Guard의 안전 판정과 Safe State 집행은 네트워크·Backend 상태에 의존하지 않는다. Backend 장애가 Guard의 동작을 막아서는 안 된다.",
    "basis": "ISO 26262-4:2018 cl.6",
    "verify": "통신 단절 HIL 시험. 합격: 단절 중 on-board 고장 시나리오에서 FHTI가 연결 시와 같다",
    "section": "09_vehicle_runtime · 9.12 규칙"
  },
  {
    "id": "FFG-VEH-009",
    "title": "HMI 요청과 지연",
    "level": "필수",
    "scope": [
      "차량 SW",
      "HMI"
    ],
    "rule": "Guard의 HMI 요청(예정 안내, 인계 경고, 비활성 안내)에 표시 지연 상한과 우선순위를 정하고 시험한다. 상한은 OEM이 TSC에서 정하고 DIA 부속서로 준다(AoU-12).",
    "basis": "ISO 26262-3:2018 cl.7; ISO 26262-4:2018 cl.8; UN R171 §5.5.4; UN R156 §7.2.2.2",
    "verify": "HMI 시험(지연 측정). 합격: 측정된 최대 지연이 상한 이하다",
    "section": "09_vehicle_runtime · 9.12 규칙"
  },
  {
    "id": "FFG-VEH-010",
    "title": "진단·EDR·DSSAD 정합",
    "level": "필수",
    "scope": [
      "차량 SW"
    ],
    "rule": "Guard 이벤트를 DEM 이벤트로 정의한다. 텔레메트리 상태는 9.8절의 정합 상태와 사유(reason.category, reason.source)와 함께 보고한다. ADS 기능은 DSSAD 이벤트와 명령 ID를 연결한다.",
    "basis": "UN R160; 49 CFR 563; GB 39732; ISO 26262-7:2018 cl.7; UN ADS GTR 제안문 Annex 6 §5.2.1",
    "verify": "진단 시험과 상태 매핑 시험. 합격: 9.8절 표의 모든 행이 시험으로 확인된다",
    "section": "09_vehicle_runtime · 9.12 규칙"
  },
  {
    "id": "FFG-VEH-011",
    "title": "OTA 사전조건과 실패 복구",
    "level": "필수",
    "scope": [
      "차량 SW",
      "CCS/OTA"
    ],
    "rule": "Flag 변경에 9.9절의 사전조건, 실행 중 안전, 실패 복구, 결과 고지를 적용한다.",
    "basis": "UN R156 §7.2.2; ISO 24089:2023; GB 44496",
    "verify": "OTA 시험(사전조건 불만족, 실행 중 실패). 합격: 두 경우 모두 이전 상태 또는 Safe State로 끝나고 결과가 고지된다",
    "section": "09_vehicle_runtime · 9.12 규칙"
  },
  {
    "id": "FFG-VEH-012",
    "title": "SEooC 사용 가정의 문서화와 통합 검증",
    "level": "필수",
    "scope": [
      "협력사",
      "통합 조직"
    ],
    "rule": "LPC·Guard를 SEooC로 개발하면 9.11절의 사용 가정을 Safety Manual에 적는다. 통합 조직은 각 가정을 실제 Item에서 검증한다. 맞지 않는 가정은 변경 관리로 처리한다.",
    "basis": "ISO 26262-10:2018 cl.9; ISO 26262-8:2018 cl.8",
    "verify": "통합 검토 기록. 합격: AoU 100%에 검증 결과(충족·변경 요청)가 있다",
    "section": "09_vehicle_runtime · 9.12 규칙"
  },
  {
    "id": "FFG-VEH-013",
    "title": "명령 순번 창과 차량 단위 키 epoch",
    "level": "필수",
    "scope": [
      "차량 SW",
      "플랫폼"
    ],
    "rule": "Guard는 같은 key epoch 안에서 영속 최고값보다 크고 최고값 +1024 이하인 순번만 수락한다. 최소 epoch는 차량 단위로 NvM과 HSM 단조 카운터에 함께 저장한다. 더 높은 epoch로 인증된 프레임은 최소 epoch를 올린다. Feature별 새 epoch의 첫 순번은 1~1024다. 최소 epoch보다 낮은 epoch의 명령은 거부한다. LPC는 Guard가 수락한 뒤에만 자신의 순번을 확정한다.",
    "basis": "UN R155 Annex 5; ISO/SAE 21434 cl.10",
    "verify": "단위시험 TC-FF-05, TC-FF-37, TC-FF-44, TC-FF-60. 합격: 재전송·큰 도약·이전 epoch·미등록 epoch가 모두 거부되고, 한 Feature의 epoch 상향 후 다른 Feature의 이전 epoch와 모든 NvM 블록 손실 후의 이전 epoch도 거부된다",
    "section": "09_vehicle_runtime · 9.12 규칙"
  },
  {
    "id": "FFG-VEH-014",
    "title": "응답 프레임과 멱등 재시도",
    "level": "필수",
    "scope": [
      "Safety Guard",
      "LPC"
    ],
    "rule": "Guard는 요청마다 9.4절의 응답 프레임을 만든다. 결과·상태·영속 상태는 코드값으로 싣는다. 인증에 실패한 요청은 에코하지 않는다. 직전에 수락한 명령과 epoch·순번·cmd_auth가 같은 프레임은 재시도로 처리하고 결정을 다시 하지 않는다. LPC는 CRC, Data ID, 증가하는 counter, 에코를 확인한 응답만 쓴다.",
    "basis": "ISO 26262-6:2018 Annex D; ISO 26262-6:2018 cl.7",
    "verify": "단위시험 TC-FF-38, TC-FF-40과 C++ SIL. 합격: 재시도의 REPLAY 판정 0건, 손상·반복 응답 수용 0건",
    "section": "09_vehicle_runtime · 9.12 규칙"
  },
  {
    "id": "FFG-VEH-015",
    "title": "비동기 영속 저장과 영속 상태 보고",
    "level": "필수",
    "scope": [
      "Safety Guard"
    ],
    "rule": "NvM 쓰기는 비동기 작업으로 다룬다. 매 주기 결과를 확인하고, 실패한 작업은 최대 3회 다시 시작한다. 영속 상태(DURABLE, PENDING, FAILED)를 응답 프레임과 상태 보고에 싣는다. 복원은 기록이 DURABLE이 된 뒤에만 효력을 낸다.",
    "basis": "ISO 26262-6:2018 Annex C; AUTOSAR",
    "verify": "단위시험 TC-FF-39. 합격: 재시도 소진 후 FAILED 보고, 영속되지 않은 복원의 효력 발생 0건",
    "section": "09_vehicle_runtime · 9.12 규칙"
  },
  {
    "id": "FFG-VEH-016",
    "title": "EOL 프로비저닝",
    "level": "필수",
    "scope": [
      "Safety Guard",
      "통합 조직"
    ],
    "rule": "EOL에서 인증된 진단 세션으로 Feature별 초기 기록을 쓰고, 지울 수 없는 프로비저닝 표식을 설정한다. 표식이 있는 ECU에서 기록이 없으면 첫 시동으로 보지 않는다.",
    "basis": "ISO 26262-7:2018 cl.5; UN ADS GTR 제안문 §4.1.4.4.2",
    "verify": "생산 시험과 단위시험 TC-FF-35. 합격: 표식 설정 후 기록 삭제 시 DISABLED로 시작한다",
    "section": "09_vehicle_runtime · 9.12 규칙"
  }
];

export const REPORT_TESTS: readonly ReportTest[] = [
  {
    "id": "TC-FF-01",
    "test": "프레임 1비트 변조, 길이 오류, Data ID 위장",
    "expected": "E2E 거부(E2E_CRC, E2E_LENGTH, E2E_DATA_ID), 상태 불변",
    "impl": "t01"
  },
  {
    "id": "TC-FF-02",
    "test": "같은 프레임 재전송, 같은 명령 순번 재사용",
    "expected": "반복·재전송 거부, 보안 이벤트",
    "impl": "t02"
  },
  {
    "id": "TC-FF-03",
    "test": "E2E counter 증가량 상한(3, 연속 손실 2개)을 넘는 도약",
    "expected": "거부 후 인증된 프레임으로 재동기, LPC 재전송 수락",
    "impl": "t14"
  },
  {
    "id": "TC-FF-04",
    "test": "QM 측 장악: 유효한 E2E와 임의 cmd_auth, 요청 유형을 바꾼 정상 봉투",
    "expected": "AUTH_FAILED, E2E 기준 불변",
    "impl": "t03, C++ SIL"
  },
  {
    "id": "TC-FF-05",
    "test": "순번 +1024 초과 도약, 이전 key epoch, 미등록 epoch",
    "expected": "SEQ_JUMP(새 epoch의 첫 순번 0, 1024 초과 포함), KEY_EPOCH_OLD, AUTH_FAILED",
    "impl": "t02, t37"
  },
  {
    "id": "TC-FF-06",
    "test": "다른 차량 대상, 다른 Feature Version",
    "expected": "TARGET_MISMATCH, VERSION_MISMATCH",
    "impl": "t03"
  },
  {
    "id": "TC-FF-07",
    "test": "등급을 바꾼 명령(DC2 → DC0)",
    "expected": "CLASS_MISMATCH",
    "impl": "t03, C++ SIL"
  },
  {
    "id": "TC-FF-08",
    "test": "정의되지 않은 코드값(요청 유형, 사유, 등급), 승인자 참조 누락·동일",
    "expected": "CODING_INVALID, APPROVALS_INVALID",
    "impl": "t03, t34, t37"
  },
  {
    "id": "TC-FF-09",
    "test": "작동 중 안전 Kill(DC2)",
    "expected": "경고 → 인계 시간 → 감소 → DISABLED, 전원 주기 후 유지",
    "impl": "t04"
  },
  {
    "id": "TC-FF-10",
    "test": "경고·감소 중 운전자 개입, 기능 해제",
    "expected": "즉시 DISABLED",
    "impl": "t05"
  },
  {
    "id": "TC-FF-11",
    "test": "주행 중 체험권 만료(상업, DC1·DC2)",
    "expected": "다음 시동까지 유지, 사전 고지, 최종 INACTIVE, 재구독은 ACTIVATE",
    "impl": "t06"
  },
  {
    "id": "TC-FF-12",
    "test": "상업 사유 대기 중 안전 Kill, Kill 진행 중 상업 사유",
    "expected": "Kill이 앞지름, 상업 사유는 Kill을 덮어쓰지 못함",
    "impl": "t06"
  },
  {
    "id": "TC-FF-13",
    "test": "DC4에 대한 Kill·활성화·복원, on-board 고장, NvM 오류",
    "expected": "DC4_REMOTE_FORBIDDEN, 설계 기본 동작 유지",
    "impl": "t07"
  },
  {
    "id": "TC-FF-14",
    "test": "DC1 Kill(작동 중 → 종료)",
    "expected": "기능이 꺼지는 시점에 DISABLED",
    "impl": "t07"
  },
  {
    "id": "TC-FF-15",
    "test": "체험권 ACTIVATE로 DISABLED 해제 시도",
    "expected": "STATE_NOT_ALLOWED",
    "impl": "t08"
  },
  {
    "id": "TC-FF-16",
    "test": "Kill 승인자 중 한 명이 복원 승인",
    "expected": "플랫폼 게이트 FAIL, Guard SAME_APPROVER",
    "impl": "t08, C++ SIL, pytest"
  },
  {
    "id": "TC-FF-17",
    "test": "복원 후 자체 시험 실패",
    "expected": "DISABLED 유지",
    "impl": "t08"
  },
  {
    "id": "TC-FF-18",
    "test": "NvM 쓰기 실패, 두 사본 손상·롤백",
    "expected": "Kill은 적용(ACCEPTED_NOT_DURABLE), 복원 거부, 손상 시 DISABLED 시작, 재동기 전 Kill과 RESTORE만 수용",
    "impl": "t09"
  },
  {
    "id": "TC-FF-19",
    "test": "RAM 런타임 레코드 비트 반전, 게시된 출력 사본 손상",
    "expected": "FAULT, BASE_ONLY, 이후 비(非)Kill 요청 거부. 손상된 출력 사본은 BASE_ONLY로 읽힘",
    "impl": "t10, t36"
  },
  {
    "id": "TC-FF-20",
    "test": "소비 기능 출력 급변 요구, 무효 권한 코드",
    "expected": "변화율 제한, 최소 시간 간격 제한, 무효 값은 기본값",
    "impl": "t11"
  },
  {
    "id": "TC-FF-21",
    "test": "Feature 추정값 오류(개루프 SIL)",
    "expected": "차량 내 감지와 감소, 예시 FTTI 안에 BASE_ONLY, 근거리에서 절대 허용 폭 적용",
    "impl": "t12, t13, t37"
  },
  {
    "id": "TC-FF-22",
    "test": "작동 중 활성화",
    "expected": "비작동이 될 때까지 ACT_PENDING, 이후 ACTIVE",
    "impl": "t14, t20"
  },
  {
    "id": "TC-FF-23",
    "test": "설정 오류(F2+DC0, DC2 시간 0, F2 fault_ramp 0, DC1 대기 상한 0)",
    "expected": "초기화 시 FAULT, 설정 오류 보고",
    "impl": "t15, t36"
  },
  {
    "id": "TC-FF-24",
    "test": "상태 보고 위조(QM 측이 상태를 바꿈)",
    "expected": "state_auth 검증 실패",
    "impl": "t17, C++ SIL"
  },
  {
    "id": "TC-FF-25",
    "test": "신뢰 시간 상실, not_before 이전, 만료, 만료 시각과 같은 시각",
    "expected": "안전·보안 Kill만 수락하고 시간 미확인 이벤트 보고, 그 외 TIME_INVALID, 경계 시각은 EXPIRED",
    "impl": "t03b, t30, t37"
  },
  {
    "id": "TC-FF-26",
    "test": "감소 막바지의 on-board 고장",
    "expected": "진행 중인 감소를 늘리지 않음",
    "impl": "t18"
  },
  {
    "id": "TC-FF-27",
    "test": "대기 상한 초과(DC1 작동 지속, 다음 시동 대기 초과)",
    "expected": "pending_overdue 보고, 상위 대응",
    "impl": "t16"
  },
  {
    "id": "TC-FF-28",
    "test": "DC2 진행·상업 대기 중 전원 차단",
    "expected": "다음 시동에 각각 DISABLED, INACTIVE",
    "impl": "t16"
  },
  {
    "id": "TC-FF-29",
    "test": "부분 배포로 구성 불일치(일부 ECU만 새 Version)",
    "expected": "Attestation 불일치 Incident, 활성화 차단",
    "impl": "시스템 시험"
  },
  {
    "id": "TC-FF-30",
    "test": "오프라인 중 만료된 명령",
    "expected": "연결 후 EXPIRED, 만료 보고",
    "impl": "시스템 시험"
  },
  {
    "id": "TC-FF-31",
    "test": "최악 Flag 조합에서 실행 시간",
    "expected": "WCET 예산 이내",
    "impl": "WCET 분석"
  },
  {
    "id": "TC-FF-32",
    "test": "HMI 경고 지연",
    "expected": "TSC 상한 이내",
    "impl": "HIL"
  },
  {
    "id": "TC-FF-33",
    "test": "RESTORE_PENDING 중 상업 종료 후 ACTIVATE",
    "expected": "복원 취소, DISABLED, 활성화 거부",
    "impl": "t22"
  },
  {
    "id": "TC-FF-34",
    "test": "DC4 런타임 레코드 비트 반전(설정 유효 표시 포함)",
    "expected": "설계 기본 동작 복구, 이벤트 1회",
    "impl": "t23, t36"
  },
  {
    "id": "TC-FF-35",
    "test": "프로비저닝 후 NvM 기록 삭제",
    "expected": "DISABLED·STARTUP·순번 비신뢰로 시작, 활성화 SEQ_UNTRUSTED, 시동 참조를 가진 승인된 RESTORE로 재동기, 원천 REMOTE",
    "impl": "t24"
  },
  {
    "id": "TC-FF-36",
    "test": "원격 Kill 진행 중 on-board 고장",
    "expected": "원격 Kill의 사유·승인자 유지, 고장은 이벤트로 기록",
    "impl": "t25"
  },
  {
    "id": "TC-FF-37",
    "test": "Feature A의 epoch를 올린 뒤 Feature B에 이전 epoch 명령",
    "expected": "차량 단위 최소 epoch로 KEY_EPOCH_OLD",
    "impl": "t26"
  },
  {
    "id": "TC-FF-38",
    "test": "응답 손실 후 같은 명령 재시도(그 사이 epoch 상향 포함), 같은 순번의 다른 명령",
    "expected": "재시도는 ACCEPTED(결정 반복 없음), 다른 명령은 REPLAY",
    "impl": "t27, t35"
  },
  {
    "id": "TC-FF-39",
    "test": "비동기 NvM: 지연 완료, 최종 실패",
    "expected": "PENDING → DURABLE, 재시도 3회 후 FAILED 보고, 영속되지 않은 복원은 효력 없음",
    "impl": "t28"
  },
  {
    "id": "TC-FF-40",
    "test": "응답 프레임: CRC, Data ID, counter 증가, 에코, 인증 실패 시 에코 없음",
    "expected": "ICD와 일치, 반복·손상·길이 오류 응답은 버림",
    "impl": "t29, t37, C++ SIL"
  },
  {
    "id": "TC-FF-41",
    "test": "차량 단위 레코드(최소 epoch, 부팅 횟수) 비트 반전",
    "expected": "오류 이벤트, NvM·Feature 레코드·HSM 하한에서 epoch 재적재, report_seq 동결",
    "impl": "t31, t34"
  },
  {
    "id": "TC-FF-42",
    "test": "DC3 Feature: 다음 시동 적용, 대기 상한",
    "expected": "다음 시동에 DISABLED, 상한 초과 보고",
    "impl": "t21"
  },
  {
    "id": "TC-FF-43",
    "test": "결과 코드 간 해밍 거리",
    "expected": "모든 거부 코드가 두 수락 코드와 거리 4 이상",
    "impl": "t32"
  },
  {
    "id": "TC-FF-44",
    "test": "SYNC 요청, 인증된 상위 epoch 프레임의 epoch 상향",
    "expected": "최소 epoch 상향, 상태 불변, 응답에 현재 epoch",
    "impl": "t33"
  },
  {
    "id": "TC-FF-45",
    "test": "플랫폼 게이트 위반 주문(등급 불일치, DC4 원격 요청, 승인 누락, 대상 초과 등 규칙별)",
    "expected": "규칙 ID와 함께 FAIL, 정상 안전 Kill은 PASS",
    "impl": "pytest"
  },
  {
    "id": "TC-FF-46",
    "test": "미래 issued_at, 사전 서명 후 보관, 만료, 과도한 유효기간",
    "expected": "게이트 FAIL",
    "impl": "pytest"
  },
  {
    "id": "TC-FF-47",
    "test": "주문 순번이 원장 +1이 아님",
    "expected": "게이트 FAIL",
    "impl": "pytest"
  },
  {
    "id": "TC-FF-48",
    "test": "대량 Kill을 여러 주문으로 나눔",
    "expected": "이동 시간 창 누적으로 상한 판정, 초과분 FAIL",
    "impl": "pytest"
  },
  {
    "id": "TC-FF-49",
    "test": "Registry 정합: F2+DC0, DC4 활성화, Profile 불일치, ADS Feature의 DC4·폐기",
    "expected": "게이트 FAIL",
    "impl": "pytest"
  },
  {
    "id": "TC-FF-50",
    "test": "메시지 스키마: 레거시 v1 형식 Kill(SAFE_STOP), 상태 보고, 차량 봉투",
    "expected": "v1 형식 거부, v2 예제 통과",
    "impl": "pytest"
  },
  {
    "id": "TC-FF-51",
    "test": "OpenFeature 경계: F2 이상 Flag 평가, 금지 Context 속성, 감사 기록",
    "expected": "기본값과 reason DISABLED, 금지 속성은 오류와 기본값, 모든 평가에 가명 감사 기록",
    "impl": "pytest"
  },
  {
    "id": "TC-FF-52",
    "test": "Provider Event와 flagd 내보내기",
    "expected": "스냅샷 교체 시 CONFIGURATION_CHANGED와 변경 키, flagd 정의에 F2 이상 없음",
    "impl": "pytest"
  },
  {
    "id": "TC-FF-53",
    "test": "중국 시장 활성화 주문",
    "expected": "범위 상한, Canary, SBOM 참조가 없으면 FAIL",
    "impl": "pytest"
  },
  {
    "id": "TC-FF-54",
    "test": "주행 중 ADSF-1 원격 종료, 사용자가 인계 요청에 응답",
    "expected": "Guard가 ADS 완료 신호까지 권한 유지, 인계 완료 후 DISABLED, 제어 공백 0",
    "impl": "HIL, 시험장"
  },
  {
    "id": "TC-FF-55",
    "test": "원격 종료 후 사용자가 인계 요청에 응답하지 않음",
    "expected": "상한 시간 안에 ADS가 MRC 수행, MRC 도달 후 DISABLED",
    "impl": "HIL, 시험장"
  },
  {
    "id": "TC-FF-56",
    "test": "원격 종료 진행 중 ODD 이탈(예: 기상 악화)",
    "expected": "ADS의 기존 fallback이 우선, 종료 절차와 충돌 없음, 종료 상태는 유지",
    "impl": "HIL"
  },
  {
    "id": "TC-FF-57",
    "test": "원격 종료와 복원의 기록 정합",
    "expected": "DSSAD에 비활성화(시스템 시작) 이벤트, 플랫폼 명령 ID와 report_seq 연결, 신뢰 시간 기록",
    "impl": "HIL, 시스템 시험"
  },
  {
    "id": "TC-FF-58",
    "test": "Kill 상태에서 SW 업데이트와 롤백, 오래된 정책 재수신",
    "expected": "DISABLED 유지, 활성화 0건",
    "impl": "시스템 시험"
  },
  {
    "id": "TC-FF-59",
    "test": "LPC 응답 대기 시간(T_resp) 초과",
    "expected": "같은 명령을 새 counter로 재전송, Guard는 멱등 처리",
    "impl": "HIL"
  },
  {
    "id": "TC-FF-60",
    "test": "모든 NvM 기록과 epoch 블록 손실 후 이전 시동의 정상 RESTORE 재전송, 폐기된 epoch의 RESTORE",
    "expected": "재전송 SEQ_UNTRUSTED, 폐기 epoch KEY_EPOCH_OLD(HSM 하한), 이번 시동 참조의 RESTORE만 수락",
    "impl": "t35"
  }
];
