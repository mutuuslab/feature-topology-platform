---
id: WF-ROLE-RDA
type: workflow
title: "Feature DB 관리자 업무 절차서 / Feature DB Administrator Procedure"
status: draft
version: 0.3.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-1
    - WF-FPW-14
last_updated: 2026-11-08
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-RDA · Feature DB 관리자 업무 절차서

> Feature DB 기준 행 변경 요청을 최종 승인하고 버전을 발행하며, 분류·출처와 정기 점검 일정을 관리한다.

- IAM 역할: REFDB_ADMIN(Feature DB 관리자)
- IAM 데모 계정: steward
- 매핑 근거: 보고서 어휘 밖. Feature DB 설계(30-95) 8.1절 IAM REFDB_ADMIN, 데모 계정 steward

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.14-A03 변경 승인·반려 — 수행·책임
- 프로세스: FPW.14 Feature DB 운영
- 시작: 앞 활동 완료
- 입력: WP-REF-CHANGE-REQ, WP-REF-ADD-REQ, WP-REF-REVIEW → 출력: WP-REF-DECISION
- 플랫폼: `decideRefChange`, `/master/feature-db/changes/:id`, `/master/feature-db/changes`
1. 변경 요청·자동 점검 결과·도메인 검토 의견을 함께 보고 승인 또는 반려를 정한다
2. 마지막 검토 의견이 반대·보완이면 승인하지 않고, 반려하거나 요청자에게 보완을 맡긴다
3. 판정 사유를 남긴다 — 요청 중 행의 상태 확정(활성·검토 필요·폐기)과 연결 Feature 알림은 다음 발행 때 이루어진다
- [ ] 승인자가 요청자와도, 그 요청의 도메인 검토자와도 다른 사람이고 판정 사유가 있다
- [ ] 승인된 변경은 발행 전까지 발행 대기로 표시되어 등록 화면에 반영되지 않았다

### FPW.14-A04 Feature DB 버전 발행 — 수행·책임
- 프로세스: FPW.14 Feature DB 운영
- 시작: 앞 활동 완료
- 입력: WP-REF-DECISION → 출력: WP-REFDB-RELEASE
- 플랫폼: `publishRefRelease`, `/master/feature-db/changes`
1. 발행 대기인 승인 요청을 모아 다음 발행 번호로 묶는다
2. 품질 지표(상태 미입력·출처 없는 행·12개월 경과 행)를 확인하고 발행 노트에 적는다
3. 발행해 전체 정규화 해시를 기록하고 등록 화면이 새 버전을 쓰는지 확인한다
4. 승인된 추가 요청의 요청 중 행이 활성(근거 부족이면 검토 필요)이 되고, 반려된 추가 요청의 요청 중 행이 폐기와 사유로 확정되었는지 확인한다
5. 폐기로 확정된 행에 연결된 Feature의 Feature Owner에게 다른 행으로 다시 연결하라는 알림이 갔는지 확인한다
6. 바뀐 기준 행을 쓰는 Feature에 '기준 행이 바뀜' 표시가 붙었는지 확인한다
- [ ] 발행 번호·묶인 요청 목록·정규화 해시가 발행 기록에 있다
- [ ] 발행 대기 요청 수가 0이다
- [ ] 반려된 추가 요청의 요청 중 행이 남아 있지 않다

### FPW.14-A05 출처 정기 점검 — 수행·책임
- 프로세스: FPW.14 Feature DB 운영
- 시작: 출처의 다음 점검일 도래(Feature DB 화면 알림)
- 입력: WP-REFDB-RELEASE → 출력: WP-REF-SOURCE-REVIEW
- 플랫폼: `recordSourceReview`, `/master/feature-db`
1. 기한이 지난 출처(AUTOSAR·VSS·ISO·UN 규정·Euro NCAP 등) 목록을 Feature DB 화면 알림에서 연다
2. 출처마다 새 판·개정 여부를 확인하고, 규정 출처는 법규 담당 의견을 받는다
3. 개정이 기준 행에 영향을 주면 해당 행의 변경 요청이 나오도록 담당 도메인 검토자에게 넘긴다
4. 점검 결과와 새 다음 점검일을 기록한다
- [ ] 기한이 지난 출처마다 점검 결과와 새 다음 점검일이 있다

### FPW.14-A06 플랫폼 분류 계층 관리 — 수행·책임
- 프로세스: FPW.14 Feature DB 운영
- 시작: Feature DB 발행 또는 플랫폼 분류 확장·수정 요청
- 입력: WP-REFDB-RELEASE → 출력: WP-PLATFORM-TAXONOMY
- 플랫폼: `createTaxonomyNode`, `updateTaxonomyNode`, `deleteTaxonomyNode`, `/master/taxonomy/levels`
1. 발행 원본의 도메인·클러스터·컴포넌트를 조회하고 필요한 플랫폼 노드의 수준과 상위를 확인한다
2. 플랫폼 노드를 등록하거나 명칭·설명을 수정한다. 상위는 정확히 한 단계 위여야 한다
3. 삭제 전 하위 노드와 배치 Feature가 없는지 확인하고 삭제 사유와 재사용 금지 묘비를 보존한다
4. Feature 등록 담당자에게 같은 수준의 배치 후보와 L0부터의 경로를 인계한다
- [ ] 발행 원본 분류는 직접 수정하지 않았고 원본 변경은 Feature DB 변경 요청으로 처리했다
- [ ] 노드 ID 재사용·잘못된 상위·하위 또는 배치가 있는 노드 삭제가 거부된다

## 2. 협의·통보 받는 활동

- FPW.1-A01 Feature 등록·초안 작성 (통보)
- FPW.1-A06 Feature DB 추가 요청 (통보)
- FPW.14-A01 변경 요청 작성 (통보)
- FPW.14-A02 자동 점검·도메인 검토 (통보)

## 3. 보고서가 이 역할에 지정한 규칙

- 없음
