---
id: REQ-ADS-UNECE-V3
type: requirement
title: "ADS·UNECE 보고서 v3.0 + Orca 인계 R3 반영 계획 — 비전·6축 상태·64개 요건·사례 25·수정 설계"
status: draft
version: 0.2.0
owner: feature-architect
last_updated: 2026-10-18
---

# ADS·UNECE 보고서 v3.0 반영 계획

> - **사용자 요청(2026-10-18)**
>   - "FF Platform의 목적·vision과 중요한 시나리오·Case가 들어 있으니 모두 반영. 분석해서 저장하고 HTML로 보고."
>   - 이어서 "다른 세션 작업과 통합하고, 저장한 내용 기반으로 UI/UX·프론트·백엔드·DB 수정 설계."
> - **원본**: `ADS_UNECE_Document_Comparison_Korean_Report_v3.0`(HTML, Revision 3.0, 2026-10-18)
>   - 공개 저장소에 두지 않는다(사용자 결정). 위치는 `C:/project/2026-06-04_Feature_Platform_sources/ads-unece-v3.0/`, sha256 `712e75bc…`.
> - **저장소 안 자료**(모두 `FF/harness/ads/`)
>   - 추출본 `catalog.json`: 요건 64·시험 24·위험 8·주장 6·시나리오 10·계약 4·API 5·판정 모델
>   - 판정 `review.json`
>   - 설계 `design.json`
> - **보고서**: [`ads-unece-v3/report.html`](ads-unece-v3/report.html)
>   - `npm run ads:report`로 생성한다. Backlog ADS 절도 같은 명령으로 생성된다.
>   - verify의 `ads` 단계가 카탈로그 무결성·판정 완비·계획 ID·생성물이 최신인지를 검사한다.

## 1. 비전 — 플랫폼 원칙으로 채택
**"플랫폼은 승인된 정책을 관리하고, 차량이 현재 상태의 실행 가능성을 판단한다."**

- 정책 ON ≠ Active. 종료 요청 ≠ 안전 전환 완료. Rollback 성공 ≠ 재활성화 허가.
- 4층 책임은 다음과 같다.
  - **Control Plane(이 플랫폼)**: 정책·승인·서명·증거
  - **CCS·OTA**: 전달
  - **Vehicle Policy Agent**: 신뢰·대상·epoch·영속 차단
  - **Local Safety Supervisor**: 행위별 판정·실행 조율
- 클라우드는 액추에이터를 직접 제어하지 않는다. 관제 화면의 마지막 보고는 실행 허가가 아니다.
- 원칙 P-1~P-6은 design.json과 보고서 2장에 있다. 용어는 [용어집](../_glossary/glossary.md) "차량 상태 용어 고정"에 정의했다.

## 2. 지금과의 차이 (판정 요약)
- 판정 방법
  - 분야별로 코드·시험을 실제로 열어 합격 조건과 대조했다. 경로·줄 근거는 review.json에 있다.
  - 차량·CCS 소관 요건은 플랫폼 몫(계약·서버 검사·시뮬레이터)으로 판정했다.
- **요건 64개**: 구현 3 · 부분 52 · 미구현 6 · 범위 밖 3(차량 내부 PHM·출력 감시·실행 격리)
  - 2026-10-18 재검증: '구현' 7건을 반대 입장 에이전트가 시험 단언까지 다시 확인했다. F022·F062(권한 만료·결제가 F2+에서도 평가를 즉시 바꿈), F033(재부팅 뒤 ACTIVE를 막지 못하고 사후 탐지만), F060(마지막 감사 행 삭제를 탐지 못함)은 '부분'으로 내렸다. 남은 '구현'은 F006·F009·F011이다.
- **인수시험 24개**: 자동 시험 있음 3 · 일부 17 · 없음 4(TC07 경계 접근, TC08 MRC, TC16 설치 시점, TC18 복구 실패)
- **이미 강한 곳**
  - 직무 분리
  - 긴급 종료 2인 승인과 사후 검토
  - 감사 해시 체인(중간 행 수정·삭제 탐지, 끝 행 삭제·체인 재계산은 DB 밖 고정점으로 탐지 — 2026-10-24 결함 해소)
  - Feature 의존성
  - 체험 만료 DC3(주행 중 끊지 않음 — 일반 구독 만료·결제는 아직 평가를 바로 바꾼다)
  - 종료 차단 탐지(복원 없는 ACTIVE를 Incident로 처리 — 막지는 못함)
- **비어 있는 곳**
  - ODD 3값·경계 접근·프로파일·의미 검증
  - 행위별 판정과 reasonCode, MRC·제어 책임 기록
  - 사건 단위 차단·선택 해제
  - 수신·수락·보류·실행 ACK 분리
  - 호환 형상 집합, 설치 사전조건
  - 사건 보고(30초 창·30일·매년)
  - Safety Case CAE와 증거 manifest
- **판정 중 찾은 결함 5건**(처음 찾은 6건 중 F060은 2026-10-24에 고침) — 각각 실행되는 결함 기록(`it.fails` 재현 시험)이 있다. verify `ads`가 짝을 검사하고, 고치면 그 시험이 실패해 판정 갱신을 강제한다. 결함마다 고치는 [결함] 설계 항목이 있어야 한다(없으면 verify 실패).
  1. 복원 뒤 다음 시동에 자동 ACTIVE가 된다(F036). 해제 ≠ 활성화 위반이다. — `backend/test/ads/defects.spec.ts`
  2. 같은 명령 재전송을 REPLAY 보안 이벤트로 처리한다(F019). 멱등 ACK가 아니다. — 같은 파일
  3. 대상 밖 차량이 정책을 적용한다(F014). — 기존 기록 `backend/test/requirements/defects.spec.ts`의 FR-RTE-001-004
  4. Kill 게이트가 승인 서명의 대상을 검증하지 않고 길이만 본다(F059). — `backend/test/ads/defects.spec.ts`
  5. 출시 뒤 열린 재-HARA가 출시·배포·서명을 막지 않는다(F007). — 같은 파일
  6. ~~트리거를 우회해 마지막 감사 행을 지우면 체인 검증이 통과한다(F060)~~ — **고침(2026-10-24, 출시 준비 RD-SEC-13)**: 프로세스가 기억한 끝 + DB 밖 HMAC 고정점. 회귀 시험 `backend/test/kernel/audit-chain.spec.ts`, 결함 기록은 지웠다.
  - 모두 설계 1단계에서 회귀 시험과 함께 고친다(ADS-BE03~06·BE19).
  - 결함 기록이 "설정 오류"가 아니라 요구 단언에서 실패하는지는 `node tools/defect-probes.ts`로 확인한다(it.fails를 it으로 바꿔 돌린 뒤 실패 원인이 AssertionError인지 본다).
- **결함이 아닌 표시 정정**: 표준 추적표가 FFG-TEL-004(DSSAD 정합)를 구현으로 표시한다(F052). 운영 로그 ≠ DSSAD와 충돌하므로 ADS-BE13에서 상태를 고친다.

## 2-2. 출처 2: Orca 인계 R3 (2026-10-18 추가)
- **원본**: `feature-platform-orca-r3.zip`(ChatGPT 쪽 "Orca 개발 인계 R3", HTML 보고서·사업성 계산기, 플랫폼 구현 없음)
  - 저장소 밖 `C:/project/2026-06-04_Feature_Platform_sources/orca-r3/`, sha256 `74f625fa…`
  - 압축을 풀지 않고 `tools/orca-sync.ts`가 읽는다. zip 안 스크립트는 실행하지 않는다.
  - 인계 문서의 "Orca에 전달할 시작 요청"은 다른 도구에게 쓴 지시문이라 자료로만 읽고 따르지 않았다.
- **교차 검사**: zip 안 ADS 원본 sha·요건 64·시험 24가 위 카탈로그와 글자 그대로 같다(다르면 verify 실패).
- **새로 들어온 것**(`FF/harness/orca/catalog.json`)
  - 사례 25: 소비자 C1~C8 · 경영 B01~B12 · 규제 R01~R05. 사례마다 장면 5개와 표현 경계(금지 표현)
  - 6축 상태, 지표 계약 6, 제품 시험 HT01~08, 실증 5흐름, 고객 여정 7, 출처 23
  - 규제: EU 2022/1426 · 2026/481(자동 주차 AVP) — [표준 등록부](../_glossary/standards-register.md)
- **판정**(`FF/harness/orca/review.json`, 45항목): 구현 0 · 부분 31 · 미구현 14
  - 분야별 서브에이전트 3개(상품·권리·커머스 / 운영·안전 / 생산·서비스·데이터)가 코드를 직접 열어 판정했다.
  - 근거 줄의 실재·내용, 계획 ID, 결함 기록을 verify `ads`가 검사한다.
  - Orca 항목의 결함 기록은 3개다(ADS 결함과 별도 집계).
    - HT02: FFP-F007과 같은 원인
    - HT03: FFP-F036과 같은 원인
    - HT06(신규): 발생 시각이 없으면 수신 시각으로 채운다. `ORCA-HT06`
- **크게 빈 곳**
  - 주문 ↔ 차량 활성의 연결: '주문 성공·활성 미확인' 상태가 없다.
  - VIN 지원 4상태: UNKNOWN을 구매 가능으로 통과시킨다.
  - 소유권 이전·국가 이동·법인 권리 주체
  - EOL 출고 대조
  - 사건 종료(해결 시각) 경로
  - 지표 6개 중 4개는 계산 자체가 없다.
- **반영**
  - 설계에 ORC-UI01~10·BE01~04·SIM01과 ADS-BE19를 더했다(55항목).
  - 이미 있는 ADS 항목에는 사례 근거만 붙였다(R01~R05, B03, B08, B10 등).
  - 보고서의 "Orca 사례 25" 장에 사례 → 지금 → 차이 → 반영을 적었다.
- **결정 필요**: D-ORC-1~4(보고서 11장)
  - D-ORC-1: 고객 화면을 FF에 둘지. 권고는 상태 API와 운영자 미리보기만 두는 것이다.
  - D-ORC-2: FF_IMP 영상 자막 충돌을 그 세션에 전달할지
  - D-ORC-3: 커머스 연동 범위. 과금 모의 BILLING으로 시작할지
  - D-ORC-4: 내부 참고자료 I1~I5 원본 제공 여부

## 2-3. 하네스 멤버 검토 — 구현 전에 여러 역할이 설계를 검토하고 기계가 검사 (2026-10-18)
- **사용자 요청**: "전체 하네스 엔지니어링을 돌려서 우리가 하려는 걸 검증하고 Quality를 올려. UI/UX 디자이너도 하네스 엔지니어링 멤버에 넣어서"
- **멤버와 산출물**(검사: `node tools/ads-team.ts --check`, verify 단계 `ads:team`)
  | 멤버 | 보는 것 | 산출물 |
  |---|---|---|
  | 판정(코드 대조) · 적대적 재검증 | 요건·사례를 코드·시험과 대조 | `harness/ads·orca/review.json` |
  | 결함 기록 점검 | it.fails가 요구 단언에서 실패하는지 | verify `ads:probes` |
  | **UI/UX 디자이너**(신규) | 화면마다 핵심 메시지 하나·상태(판단 불가·미확인 포함)·행동과 막힘 사유·공통 부품·접근성·금지 표현 | `harness/ads/ux.json` |
  | 업무 절차 담당 | 설계 항목 ↔ 담당자 절차 활동(FPW), 절차 문장과 원칙 충돌 | `harness/ads/workflow.json` |
  | 설계 적합성 검토(ADS·Orca) | 부분·미구현 요건마다 설계가 합격 조건을 닫는지(반대 입장) | `harness/ads/fit.json` |
- **검토 신선도**: 검토마다 대상 설계 항목의 해시를 남긴다. 설계를 고치면 그 항목은 다시 검토할 때까지 verify가 실패한다(`npm run ads:stale`).
- **회차 추이**(`harness/ads/team-log.json`, 보고서 '하네스 멤버' 장)
  | 회차 | UX blocker · major | 적합성 ADS 닫음·일부·못 닫음 | 적합성 Orca | 절차 바뀜·새·문장 충돌 |
  |---|---|---|---|---|
  | 1 | 6 · 73 | 20 · 35 · 3 | 2 · 39 · 4 | 43 · 23 · 9 |
  | 2 | 1 · 17 | 45 · 13 · 0 | 7 · 38 · 0 | 51 · 28 · 28 |
  | 3 | 1 · 0 | 46 · 12 · 0 | 31 · 14 · 0 | 51 · 36 · 39 |
  | 4 | 0 · 0 | 48 · 10 · 0 | 35 · 10 · 0 | 51 · 37 · 39 |
  | 5 | 0 · 0 | 48 · 10 · 0 | 35 · 10 · 0 | 52 · 51 · 39 |
- **멤버가 찾아 설계에 넣은 것**(대표)
  - 원칙 P-9~P-15
    - '모름' 표기 두 낱말: 판단 불가 · 미확인
    - 핵심 메시지는 화면당 하나
    - 숫자는 배타 구간
    - 막힌 행동은 글자 사유
    - 같은 낱말은 한 원장: 사건·차단·보류
    - 원장 화면과 읽기 화면 구분
    - be 필드는 UX 확정안 자리에만
  - 고치려던 기존 화면의 원칙 위반 2건
    - 활성화 판단 화면의 가장 큰 글자가 'ON'
    - 체험 분석이 합성 수치를 녹색 성과로 표시
  - 기존 코드의 모순
    - 분류 확정 뒤에도 source가 INFERRED로 남는다.
  - 단계가 거꾸로 된 의존 8곳, 같은 테이블을 여러 항목이 신설하는 중복 14곳
  - 새 항목 7개
    - ADS-BE20: 권리 ↔ 안전 허가 분리
    - ADS-BE21: 영향 차량 산정
    - ORC-BE05~08
    - ORC-UI11
  - 결정 D-ADS-7·8, D-ORC-5
- **멤버 검토가 드러낸 하네스 빈틈 → 검사 규칙으로 고정**
  - 선행 항목이 더 뒤 단계에 있으면 실패. 대체값으로 먼저 쓰는 뒤 단계 입력은 `later` 배열에 둔다.
  - 같은 DB 테이블을 두 항목이 신설하면 실패. 문장 중간·쉼표로 나열된 테이블 이름도 잡는다.
  - db·api 칸의 설계 ID, 본문에 남은 반영 지시문("deps에", "cases에 … 추가", "… 삭제 —")을 잡는다.
  - 같은 칸에 거의 같은 문장이 두 줄이면 잡는다.
  - ui·fe 문장의 '모름' 금지 표기를 잡는다.
  - 적합성 제안에 `op`(add·replace·remove·dep·case·later)를 두고, replace·remove는 대상 문장을 필수로 한다.
    - 1~3회차에는 "바꾼다" 제안을 덧붙이기로 반영해 옛 문장이 남았다.
  - 생성 문장의 숫자("결함 N건")도 계산값으로 바꿨다(BACKLOG 머리말에 옛 숫자가 남아 있었다).
- **남은 것**: 회차를 멈추며 남긴 설계 항목 문제 6건(보고서 하네스 멤버 장 표)과 일부만 닫힌 요건(ADS 10·Orca 10)은 BACKLOG 항목마다 '착수 전 확인' 열로 표시한다. 구현 착수 전 상세 설계에서 닫는다.

## 3. 상태 모델 — 6축 (모든 화면·API 공통, Orca R3 채택)
| 축 | 값 | 판단 주체 | 출처 |
|---|---|---|---|
| 상품 권리 | 없음 · 체험 · 구매 · 만료 · 이전 심사 | 플랫폼 | 권리·주문(과금 모의 BILLING) |
| 구성과 설치 | 미설치 · 설치 중 · 호환 · 부분 실패 · 복구 필요 | OTA·플랫폼 | OTA·형상 집합(config_set) |
| 정책 의도·전달 | 승인 · 발행 · 수신 · 수락 · 보류 · 적용 · 거부 | 플랫폼·CCS | `delivery_ack`(신설) |
| 활성 적격 | 허용 · ODD 밖 · 금지 · 조건 부족 · 확인 불가 | 차량(보고값만 표시) | `safety_verdict`(행위별 + reasonCode, 신설) |
| 실제 기능 실행 | Inactive · Available · Active · 종료 전이 · MRC · 종료 완료 · 복구 검증 대기 | 차량 | status_report 2.1 `runtime_state`·`ddt_owner` |
| 관측 신선도 | 최신 확인 · 지연 · 오프라인 · 미확인 | 플랫폼(모르면 UNKNOWN) | observed_at·received_at·연결 상태 |

- 화면은 이 축을 나란히 보인다. 예: "종료 요청 100 / 수신 92 / 전환 중 8 / 종료 확인 80 / 미확인 12", "주문 성공 / 활성 미확인".
- 하나의 ON/OFF나 "사용 준비 완료"로 합치지 않는다. 오래된 실제 상태는 '판단 불가'로 보이고 정상으로 세지 않는다.

## 4. 다른 세션 작업과의 통합
| 세션 | 겹침 | 통합 방법 |
|---|---|---|
| 전체 화면 3초 테스트 | 새 화면 6개, Kill·배포·Fleet 개편. 보류 항목 'Kill 차단 없으면 폼 접기·사전점검 불일치'가 ADS-UI02와 같은 화면 | 새 화면은 핵심 메시지 1·설명 70자·머리표 0 규칙. 문구는 그 세션 소유 ko.ts·master.ts가 아닌 새 copy/ads.ts. three-second.spec 대상에 추가 |
| 담당자 업무 절차(RACI) | FPW.8(긴급 차단·복원)·FPW.13(규정) 변경. 사건별 차단·선택 해제·복원 뒤 재판정·사건 보고·ODD·형상·Safety Case 승인이 새 활동 | 항목마다 절차 모델 갱신을 완료 기준으로 둔다. 모델 수정 주체는 결정 D-ADS-4. 9계정 겸직 0 유지 |
| FF_IMP(GLEO v2·Safety Guard) | status_report·kill_command 와이어 정본이 FF_IMP gleo/. siblings가 커밋을 고정 | FF는 2.0·2.1 동시 수락을 먼저 만든다. FF_IMP 변경은 승인 후(D-ADS-1). 영상 폴더는 손대지 않음 |
| 텔레메트리·Closed loop(TL-*) | GTR §5.1.8.4 운행 차량 감시 = Closed loop. 확대 판정·신선도 HOLD·사건 집계가 겹침 | TL-UI02와 ADS-UI11은 한 패널, TL-B01·B02와 ADS-BE12는 한 엔진. 사건 보고 노출량은 Lake Gold(IF-15) |
| GitLab·JIRA·codeBeamer 연계 | 보고서 API `POST /change-requests`는 JIRA CR + 정책 승인과 같다. FFP 요구는 사양이므로 codeBeamer 원장 대상. 이 작업으로 verify:full 일부 실패 | 변경 종류를 JIRA CR 필드에 매핑. FFP 요구의 codeBeamer 등록은 D-ADS-6. verify:full은 ADS-FIX01로 먼저 복구 |

## 5. 수정 설계 (요약 — 항목별 UI/UX·프론트·백엔드·DB·API·시험은 보고서 9장과 design.json)
- **0단계 정리**
  - ADS-FIX01: verify:full 복구
- **1단계 기준선·계약 + 화면(UI 우선)**
  - UI13 용어 고정
  - UI10 요건·시험 추적 화면 `/trace/ads`
  - UI01 의도·전달·실제·최신성 분리(배포·Fleet·차량)
  - UI02 종료·차단·복원 개편
  - UI06 행위별 판정·사유 코드
  - UI03 일괄 명령 미리보기
  - BE01 상태 보고 2.1
  - 결함 BE03·BE04·BE05·BE06
- **2단계 구성 관리**
  - UI04 신설 ODD 프로파일 `/config/odd`
  - UI05 신설 호환 형상 `/config/compat`
  - UI09 변경 종류·영향·릴리스 비교
  - UI12 분류·시장 기준선
  - BE07 Feature epoch, BE08 변경 종류, BE09 ODD 엔티티·검증, BE10 형상·보안 최소 버전, BE11 결정적 빌드, BE16 분류 보강
- **3단계 운영·증거·보고**
  - UI07 신설 사건 보고 `/ops/incident-reports`
  - UI08 신설 Safety Case `/verify/safety-case`
  - UI11 확대 판정 패널
  - BE02 사건 범위 차단, BE12 판정 엔진, BE13 사건 보고, BE14 CAE·manifest·독립 검토, BE15 권한 범위, BE17 캠페인 조회, BE18 `@ffp` 추적
- **4단계 차량 시뮬레이터·와이어**
  - SIM01 로컬 Safety Supervisor(행위별 판정·ODD 3값·재검증)
  - SIM02 오프라인·재시작
  - SIM03 인계·MRC·시간 예산
  - SIM04 FF_IMP 2.1
- **5단계 OTA·수명주기**
  - OTA01 설치·복구 계약
  - LC01 Shadow 격리
  - LC02 지원 종료 연습
- **DB(새 migration 044부터)**
  - 신설: delivery_ack, safety_verdict, termination_inhibit, odd_profile, config_set, change_impact, rollout_freeze, incident_report, periodic_report, safety_case_node, evidence_manifest, review_finding, market_baseline, role_scope
  - 열 추가: vehicle_feature_status(runtime_state·ddt_owner·observed_at·last_report_at), change_kind, feature_version.ddt_impact
- **계약**
  - StatusReportV2_1에 decision, delivery_stage, ddt_owner, inhibits, mrc를 추가한다.
  - 2.0과 2.1을 동시에 수락한다.
  - F2+ 종료 명령의 incident_id를 필수로 하고, cmd_auth 서명 대상에 넣는다.

## 6. 결정 필요
- **D-ADS-1**: FF_IMP 와이어 2.1 확장 승인
- **D-ADS-2**: 대표 ADS 1개·비 ADS 1개 Feature 지정
- **D-ADS-3**: 사건 보고 시장별 기한 소유
- **D-ADS-4**: 업무 절차 모델 수정 주체
- **D-ADS-5**: 차량 팀 결정 5건 담당
- **D-ADS-6**: FFP 요구의 codeBeamer 등록
- **D-ADS-7**: 계약 역할 목록에 없는 역할(분석 전용·독립 검토자·공장 품질, 새 절차의 고객 지원·정비 거점)을 기존 역할로 바꿀지·신설할지
- **D-ADS-8**: 2단계 동안 Safety Case 갱신 확인을 Safety Manager 수동 확인 기록으로 통과시킬지
- **D-ORC-1~5**: 2-2절. D-ORC-5는 내부 상품 승인(상품 × 시장)의 출처다.
- 근거와 제안은 보고서 11장에 있다.

## 7. 경계
- FFP-F001~064는 보고서가 도출한 프로젝트 요구 제안이다. GTR이 이 플랫폼 구조·API·필드·ASIL을 직접 정한 것이 아니다.
- 문서 하네스(이 카탈로그·판정·보고서)가 통과해도 차량 안전성이나 규정 적합성의 증거가 되지 않는다. 릴리스에는 요구별 차량·플랫폼 시험 결과를 새로 연결한다.
- 시간·반응 한계(100 ms 등)를 규정값으로 넣지 않는다. 기능별 안전 분석에서 받는다.
