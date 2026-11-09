---
id: TC-COST-DB-FIRST-20261109
type: reference
title: Feature DB 우선 비용 산정 초기 검토 기록
status: in-review
version: 1.0.0
owner: verification-safety
cycle: 1
last_updated: 2026-11-09
related: [TC-COST-PURCHASING-20261109]
---

# Feature DB 우선 비용 산정 검토

> 초기 분리 구현의 역사 기록이다. 현재 구매 6종 구현·통합 및 실제 file 브라우저 완료 증거는 [후속 검토](cost-purchasing-completion-2026-11-09.md)를 따른다. 아래 보류 상태를 현재 상태로 해석하지 않는다.

작업 브랜치 `feat/cost-db-first-20261109`. 비개발비 Publish와 분리한다. 원본 workbook은 읽기 전용이며 회사의 원가·기술·계약·지급 승인을 새로 확정한 기록이 아니다.

## 원천 대조

지정 원본 `C:/2026-05-31_Claude_PPT/Automotive_SW_개발비_산정도구_FeatureDB_v1.3.xlsx`와 `FF/data/source/feature_db_v1.3.xlsx`의 SHA-256은 모두 `7d22d08a1f5406f18eb44b9acc9a4605e0eb1d3cb232a821c8629f9e9fe0d244`이다. Artifact Tool로 24개 시트와 비용 관련 범위/수식을 읽었고 원본은 저장·재계산·수정하지 않았다.

`FF/tools/cost/audit-source.ts`로 기존 importCostBasis의 읽기 전용 결과와 v1.3.json을 재귀 대조했다. 26개 최상위 영역의 값 차이 0이며 원본 SHA도 실행 전후 동일하다. T-shirt/ASIL/재사용/Lifecycle/품질, PERT·변형·신뢰수준, COCOMO·프리셋, KOSA/엔지니어링/사내단가·공정·역할 구성, 대가 방식·AACE·공통 인력, benchmark·환율·VAT, MBD·교정·직접경비·38개 체크리스트가 이미 연결돼 있다. 누락 계수를 임의로 추가하지 않는다.

원본 안내 `00_안내`는 Feature DB의 AF 수량/AG 변경 유형에서 시작한다. 기존 UI의 빈 과제 → 등록 FF Feature 검색은 이 시작점과 달랐다. 새 UI는 기준 행 검색 → 출처·발행·계수·포함/제외 범위 확인 → 실제 Feature 선택 연결 → 과제명/대상 자동 채움 → 줄 입력 순으로 바꾼다. 원본 BW의 기준 공수와 조달·패키지·라이선스 항목·과금 방식, 규모 근거 등급·확인일·등록 버전은 별도 원천에 보존하고 관련 필드는 읽기 전용으로 표시한다.

원본의 운영비·로열티는 NRE 밖이며 초기 등급·ASIL과 공통 인력, MBD 기준 y에는 과제별 근거 확인이 필요하다. 이 한계를 안내에 넣는다. 16~18 RFQ·회신·협력사 비교와 19 계약 후 변경은 기존 D-COST-6 및 별도 계획의 후속 범위로 연결하며 이번 작업에 구현됐다고 표시하지 않는다.

## 구매 6명 Concern 반영

근거는 키트의 [계획](../../../../docs/plans/cost-needs-review-2026-11-09.md)·[구매 6명 원천 부록](../../../../docs/plans/cost-needs-review-2026-11-09-evidence.md)과 `C:/project/2026-10-19/분석결과/4축_분석_전체.md`의 해당 6개 절이다. 품질 3명·개발 8명은 검토 범위에서 제외했다.

| 담당 | 이번 산정 흐름 반영 | 별도 계획으로 연결한 부분 |
|---|---|---|
| 05 이영규 | 포함/제외 범위·기준/출처 표시, 미확인 값의 임의 0·자동 삭감 금지 안내 | 지역별 WBS/인증 시험 동일 범위 견적 비교와 보류액 회신 |
| 12 정규철 | 계수·단가 버전과 원천 SHA·사유 보존, 기준 관리자 발행/작성자·승인자 분리 유지 | 튜닝 작업 사전의 실적 기반 승인, 계약 포함/시험 중복 비용 판단 |
| 13 고호준 | 기준/Feature 변경 시 재확인·제출 거부, 승인 원천 개정 포인터와 암호화 이력, 비용 승인과 회사 계약/지급·기술 승인 구분 | 실제 변경점–WBS–시험–증빙 심사와 정산 검수 |
| 15 이지혜 | Feature DB 우선 선택, 실제 Feature의 요구/적용 범위 캡처, 원천/입력 이력 분리, 미해결 값을 확정 비용으로 보이지 않게 결측 거부 | 요구–작업 다대다, 협력사 견적 자동판정 8종·라이선스 조건 확정 |
| 21 김대윤 | 원천 버전/해시/이전 개정 보존, 미확인 모델을 임의 계수나 0으로 대체하지 않음 | 최초 Terms/가격 모델·인상 요인·잔차·물량 시나리오 |
| 23 권기범 | 조달/사용권/과금 필드와 범위 표시, 실제 등록 Feature와 요구 연결 선택, 변경 원천 재확인 | MCU 다후보·다ECU 배정·손익분기/민감도·부담 주체 회신 |

이 표는 Concern의 검토와 현재 D07 범위의 구현 대응이며, 6명 현업 업무 도메인이 전부 구현됐다는 판정이 아니다. 실제 회사의 승인 주체/전결 합의나 실자료 검증은 이 작업에서 만들어 내지 않는다.

## 구현 경계

- D-COST-9는 사용자 후속 요청에 따라 기준 행 직접 사용 + 실제 Feature 선택 연결로 갱신했다. `feature_id/version` NULL 쌍과 `REFERENCE` 역할을 사용하며 가짜 Feature/ID를 만들지 않는다. 기존 Feature API/빈 과제 API는 이전 호출자 호환용이고 새 UI는 최소 1개 기준 행을 함께 저장한다.
- 발행·원천/Feature SHA를 확인한 뒤 원자적으로 저장한다. 필요한 계수가 없거나 캡처가 없으면 추정 금액을 만들지 않는다. 프로젝트 입력은 원천 갱신 때도 보존한다.
- 원천 원문·엔진 사실·Feature 요구/범위·출처는 KEK 봉인한다. 원천 개정과 승인 포인터는 추가 전용이며 삭제한 줄 번호도 재사용하지 않는다. 번들 판정에 쓰는 비선택 중복 대상도 원천에 포함한다.
- 개발 역할은 공수와 금액 필드 4개가 제거된 원천만 본다. 금액 역할만 별도 원천 원문을 열람하며 COST_VIEW 감사가 남는다. 승인 시 작성자≠승인자, 승인 결과 SHA 고정과 기존 권한을 유지한다.
- 정적 시연의 변경은 브라우저 로컬 시뮬레이션이다. 새로운 raw 원천 수집은 snapshot-api가 직접 시작한 fresh `:memory:` 공개 예시 시드 서버로만 한다. 사용자 DB·외부 자격증명은 이 수집 경로에서 받지 않는다. 실제 사내 원가/사용자 자료를 공개 캡처에 섞지 않는다.

검증 증거와 현재 체크포인트는 마감 시 아래에 추가한다.

## 체크포인트와 남은 검증 (Publish 우선 전환)

2026-11-09 비용은 이번 noncost Publish에서 제외한다. native 시작점 c96da770 이후 UI/static 후속을 별도 커밋으로 보존한다.

- native 새7·기존20·migration6 PASS. 관련4파일 병렬 실행에서37/38 PASS, 기존 calibration 대량시드1건20초 timeout이 있었다. 기준 ordinal 캐시로 반복1052행 파싱을 제거한 뒤 calibration 파일5/5 재실행 PASS(전체24.36초, 개별 제한 완화 없음).
- frontend type PASS, static5/5 PASS, 영어9434/9434 및 실제타입9541 invalid0. OpenAPI562생성, 운영UI initial295.3/297KiB·일반화면최대32.7/40KiB PASS.
- 자체 API9610에서 IAM24roles224permissions110screens dist_diff0, model오류0·경고0/59docs/pytest7 ALL GATES PASS. 원본9543/9570/9580 및 root9610외 포트를 건드리지 않았다.
- 비용 전용 API9610(PID77252), UI9611 preview(PID69756)와 독립DB는 보존한다. 실제 Chromium 검증은 아직 실행완료 전이다. 첫 실행은 bundled Python에 Playwright가 없어 시작 전 실패했으며, 기존 C:/Python314/python.exe에 Playwright가 있는 것까지 확인했다. 운영 UI 브라우저/원천 갱신·승인 UI/전역 snapshot 새캡처·static 생산물 검사/최종 UI 바뀐 뒤 추가 회귀 및 workflow실행 연결은 남았다.
- 실행 증거는 키트 out/cost-db-first-20261109/ 아래에 있고 미완 비용을 Publish 완료로 가산하지 않는다. root의 긴급 RC 도구·문서·CI 게이트 마감을 우선 지원한다.
