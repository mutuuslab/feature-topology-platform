# 기능명세서 요구사항 반영 현황

> tools/requirements.ts가 만든다 — 손으로 고치지 않는다. 원본 `Feature Flag 플랫폼 기능명세서 Review Revision.xlsx` (SHA-256 `96591b14470489dd…`), 판정 검토 2026-10-17 @ e7898ee.
> 판정·결함·결정은 `harness/requirements/review.json`에서 고친다. 요구사항별 근거는 같은 파일의 `verdicts`에 있다.

## 1. 판정 집계 (말단 628건)

| 시트 | 건수 | 구현 | 부분 | 미구현 | 범위 밖 |
|---|---:|---:|---:|---:|---:|
| 01_Feature 정책 관리 | 239 | 88 | 84 | 64 | 3 |
| 02_차량 런타임 실행 | 81 | 15 | 49 | 15 | 2 |
| 03_안전·검증 | 109 | 23 | 31 | 55 | 0 |
| 04_배포·운영·데이터 | 78 | 8 | 44 | 26 | 0 |
| 05_시스템 연계·확장 | 34 | 4 | 16 | 14 | 0 |
| 06_품질·보안·운영 | 87 | 17 | 41 | 29 | 0 |
| **합계** | **628** | **155 (25%)** | **265 (42%)** | **203 (32%)** | **5** |

코드 추적(`@req` 표식): 0건 · 구현 판정인데 추적 없음: 155건

## 2. 결함 (5건 — 실행되는 결함 기록 `it.fails`)

| ID | 요구사항 | 내용 | 결함 기록 |
|---|---|---|---|
| FR-RTE-005-001 | Capability Check 수행 | 차량 측 평가에 지원 조건(support)이 넘어가지 않는다 — 지원 미달 차량에 사용 권한이 생기면 서버는 OFF(NOT_SUPPORTED), 차량은 ON으로 어긋난다 | `backend/test/requirements/defects.spec.ts` |
| FR-RTE-001-004 | 정책 대상 차량 일치 확인 | POLICY 게시본을 받을 때 payload.targets에 자기 VIN이 있는지 확인하지 않는다 — 대상이 아닌 차량도 적용한다(차단 봉투는 확인한다) | `backend/test/requirements/defects.spec.ts` |
| FR-REG-002-019 | Deprecated Feature 신규 정책 배포 차단 | DEPRECATED Feature라도 이미 승인된 정책은 배포된다 — 정책 작성만 Lifecycle을 보고 배포는 보지 않는다 | `backend/test/requirements/defects.spec.ts` |
| FR-REG-002-008 | Released 상태 진입 Gate 검증 | 출시(VERIFIED→RELEASED)는 G8·G9만 본다 — VERIFIED에서 G1~G7을 FAIL로 다시 판정해도 출시가 막히지 않는다 | `contracts/src/rules/requirements-defects.test.ts` |
| FR-REG-002-009 | Gate 미통과 Released 진입 제한 | FR-REG-002-008과 같은 원인 — Gate 미통과 상태로 RELEASED에 들어갈 수 있다 | `contracts/src/rules/requirements-defects.test.ts` |

## 3. 여러 시트에 걸친 공백

| ID | 주제 | 현재 | 요구사항 수 | 미구현 |
|---|---|---|---:|---:|
| B1 | 수신자 지정 알림(Web·메일) | SSE 이벤트 방송과 역할 검토함만 있다 — Owner·요청자·승인대상자 알림 없음 | 19 | 12 |
| B2 | 롤백 | 계획·자동·수동 모두 없다 — 이전 정책은 RETIRED가 되어 다시 배포할 수 없다 | 28 | 27 |
| B3 | 정책 버전 이력 | 개정 번호만 오르고 내용은 덮어쓴다 — 감사에는 해시만 남는다 | 7 | 3 |
| B4 | 감사·이력 조회 | 내보내기·기간/유형 필터·조회 감사가 없다, 변경 전후 값이 없다 | 14 | 6 |
| B5 | 평가 운영 데이터 | 모의 OTel 표에만 쌓인다 — Feature별 집계·앱/SDK/환경 식별 없음 | 11 | 6 |
| B6 | 오류 이력 | 연계·과금·서명 실패가 기록되지 않는다 | 3 | 1 |

## 4. 결정 필요 — 현재 설계 원칙과 충돌

| ID | 주제 | 상태 | 명세 | 현재 설계 | 요구사항 |
|---|---|---|---|---|---|
| D1 | 즉시·자동·외부 직접 제어 | 결정 대기 | 즉시 비활성화, 조건 충족 시 자동 비활성화, 외부 시스템이 제어를 직접 실행 | 긴급 차단·배포는 사람 역할 + 2인 승인·직무 분리(SOD-08, FFG-PLT-005) | FR-POL-001-005, FR-KSW-002-004, FR-SVS-002-001, FR-AGW-001-002 |
| D2 | 삭제 | 결정 대기 | Feature·정책·관계·Variant·조건·규칙·시나리오 삭제 | 승인 후 불변·새 Version, 대체 시 RETIRED, 기록 보존·ID 재사용 금지(FFG-CODE-020) — "폐기·미사용 표시"로 재정의 권장 | FR-REG-001-013, FR-DEP-001-005, FR-DEP-002-005, FR-CPT-001-004, FR-PVER-001-004, FR-VAR-001-005, FR-SUP-001-005, FR-SUP-002-005, FR-TGT-003-003, FR-PDA-001-007, FR-SCN-001-004 |
| D3 | 판단 규칙·무결성 기준을 화면에서 관리 | 결정 대기 | 정합성 규칙·무결성 검증값·실패 기준 등록·수정·활성화 | 판단 규칙은 contracts 한 곳 + 골든 시험 고정, 해시·서명 알고리즘·거부 코드는 코드 고정(FFG-SEC-002) — 허용하려면 버전·승인·감사가 붙은 규칙 프로파일 | FR-CST-001-001, FR-CST-001-004, FR-CST-001-005, FR-SDM-003-001, FR-SDM-003-002 |
| D4 | fail-closed 완화 | 결정 대기 | 미승인 룰은 무시, 예외 승인·임시 우회, 최신성 미충족이면 판단하지 않고 메시지, 중단 기준을 충족해야만 중단 | 근거 없으면 막음(FFG-LCY-002), 판단 불가는 HOLD → Safe Default, 멈추기(0%)는 언제나 허용 | FR-CRC-001-017, FR-REG-005-010, FR-EXC-, FR-ROL-002-008, FR-SUP-004-003 |
| D5 | 개인정보·동적 차량 상태 | 결정 대기 | userId·remoteAddress 원문 수집, 사용자·계정 타겟팅, 주행·정차·충전 조건 | 가명 subject·원본 식별자 금지(FFG-OFT-003/004), 동적 차량 상태는 문맥 금지 속성 — 차량 Guard(DC1·DC3)가 처리 | FR-OPD-001-004, FR-TGT-002-002, FR-SUP-003-002, FR-RTE-005-002 |
| D6 | 평가 의미 | 결정 대기 | 정책 우선순위·동순위 충돌 해소, boolean 외 분기값(getVariant), 대상/제외 2분류 | 제어점당 배포 정책 1건(BD-06)·전략 OR, 차량 flag boolean 전용(FP-VEHICLE-BOOL-1), ALLOW·DENY·HOLD 3분류 | FR-POL-002-003, FR-CON-001-004, FR-CON-002-, FR-OPD-001-003, FR-OPD-001-008, FR-EVT-001-002, FR-TGT-005-, FR-TGT-004-002 |
| D7 | 플랫폼 범위 경계 | 결정 대기 | SW 버전 롤백·빌드 산출물·OTA 차량 상태, 과금 시스템이 권한 원천, 원천 덮어쓰기 동기화, 레거시 실시간 제어, 정책 암호화 | SW 전개는 OTA(IF-05) 위임, 권한 원천은 플랫폼 원장(D01-05), 동기화는 대사만(FFG-TEL-005), 레거시 F2+ 거부, 기밀성 요구 미정의 | FR-RBK-001-003, FR-QGV-001-, FR-DSV-002-001, FR-BIL-001-001, FR-DSYN-001-001, FR-DSYN-001-002, FR-SDVI-001-001, FR-SDM-001-002 |
| D8 | 데이터 모델 | 결정 대기 | Taxonomy L0~L5, 적용 지역 코드(1~9·A~D·G)·Variant Rule, 브랜드 속성 | 태그, 시장 구분(UNECE/EU/CN/US…) + Feature 국가·차종·트림, 브랜드 없음 | FR-CAT-001-, FR-CAT-004-, FR-REG-001-008, FR-CRC-001-002, FR-CRC-001-003, FR-GLB-001-002, FR-GLB-001-003, FR-GLB-001-004 |
| D9 | 출시 전 배포 | 결정 대기 | 출시 Gate(G8·G9)를 통과하지 않은 Feature는 활성화하지 않는다 | 정책 배포는 Feature가 VERIFIED여도 가능 — 배포와 출시(RELEASED)가 분리되어 있다 | FR-RDD-001-006 |

## 5. 명세서 정정 필요 (5건)

- **DUPLICATE_ID** FR-EXP-002-004 — 같은 ID가 2번 나온다 — 01_Feature 정책 관리 220행, 01_Feature 정책 관리 221행
- **DUPLICATE_ID** FR-RBAC-002-002 — 같은 ID가 2번 나온다 — 01_Feature 정책 관리 272행, 01_Feature 정책 관리 274행
- **DUPLICATE_TEXT** FR-POL-002-005, FR-PVER-002-005 — 상세 설명이 같다 — FR-POL-002-005(01_Feature 정책 관리 163행), FR-PVER-002-005(01_Feature 정책 관리 236행)
- **검토** FR-PDA-002-006, FR-PDA-002-007 — 같은 요구(Feature ID 기준 단계적 배포 이력 조회)를 두 번 적었다
- **검토** FR-QGV-001-003, FR-QGV-001-005 — 001-003(패키징 결과 수집)의 상세 설명이 001-005(배포 산출물 식별) 문구다
