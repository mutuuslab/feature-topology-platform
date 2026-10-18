---
id: REQ-ADS-UNECE-V3
type: requirement
title: "ADS·UNECE 보고서 v3.0 반영 계획 — 비전·상태 모델·64개 요건·수정 설계"
status: draft
version: 0.1.0
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
- **요건 64개**: 구현 7 · 부분 48 · 미구현 6 · 범위 밖 3(차량 내부 PHM·출력 감시·실행 격리)
- **인수시험 24개**: 자동 시험 있음 3 · 일부 17 · 없음 4(TC07 경계 접근, TC08 MRC, TC16 설치 시점, TC18 복구 실패)
- **이미 강한 곳**
  - 직무 분리
  - 긴급 종료 2인 승인과 사후 검토
  - 감사 해시 체인
  - Feature 의존성
  - 체험 만료 DC3(주행 중 끊지 않음)
  - 종료 차단 영속(복원 없는 ACTIVE를 Incident로 처리)
- **비어 있는 곳**
  - ODD 3값·경계 접근·프로파일·의미 검증
  - 행위별 판정과 reasonCode, MRC·제어 책임 기록
  - 사건 단위 차단·선택 해제
  - 수신·수락·보류·실행 ACK 분리
  - 호환 형상 집합, 설치 사전조건
  - 사건 보고(30초 창·30일·매년)
  - Safety Case CAE와 증거 manifest
- **판정 중 찾은 결함 6건**
  1. 복원 뒤 다음 시동에 자동 ACTIVE가 된다(F036). 해제 ≠ 활성화 위반이다.
  2. 같은 명령 재전송을 REPLAY 보안 이벤트로 처리한다(F019). 멱등 ACK가 아니다.
  3. 대상 밖 차량이 정책을 적용한다(F014, 알려진 결함 FR-RTE-001-004).
  4. Kill 게이트가 승인 서명의 대상을 검증하지 않고 길이만 본다(F059).
  5. 출시 뒤 열린 재-HARA가 출시·배포·서명을 막지 않는다(F007).
  6. 표준 추적표가 FFG-TEL-004(DSSAD 정합)를 구현으로 표시한다(F052). 운영 로그 ≠ DSSAD와 충돌한다.
  - 1~5는 설계 1단계에서 회귀 시험(수정 전 실패)과 함께 고친다. 6은 표시를 정정한다(ADS-BE13).

## 3. 상태 모델 (모든 화면·API 공통)
| 층 | 값 | 출처 |
|---|---|---|
| 의도(플랫폼) | 정책 허용 · 종료 요청 · 차단 해제 요청 · 복원 요청 | 정책·명령 원장 |
| 전달(CCS·차량) | 미전송 · 수신 · 수락 · 보류 · 실행 · 거부 | `delivery_ack`(신설) |
| 실제(차량 보고) | 활성화 차단 · Available · Active · 안전 전환 중 · 인계 완료 · MRC · 비활성 · 복구 검증 대기·완료 | status_report 2.1 `runtime_state`·`ddt_owner` |
| 판정(차량 로컬) | ALLOW · DENY · UNKNOWN + reasonCode | `safety_verdict`(신설) |
| 최신성 | 관측 시각 · 보고 시각 · 경과 · 연결 | observed_at·received_at |

- 화면은 이 층을 나란히 보인다. 예: "종료 요청 100 / 수신 92 / 전환 중 8 / 종료 확인 80 / 미확인 12".
- 오래된 실제 상태는 '판단 불가'로 보이고 정상으로 세지 않는다.

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
- 근거와 제안은 보고서 11장에 있다.

## 7. 경계
- FFP-F001~064는 보고서가 도출한 프로젝트 요구 제안이다. GTR이 이 플랫폼 구조·API·필드·ASIL을 직접 정한 것이 아니다.
- 문서 하네스(이 카탈로그·판정·보고서)가 통과해도 차량 안전성이나 규정 적합성의 증거가 되지 않는다. 릴리스에는 요구별 차량·플랫폼 시험 결과를 새로 연결한다.
- 시간·반응 한계(100 ms 등)를 규정값으로 넣지 않는다. 기능별 안전 분석에서 받는다.
