---
id: WF-PROP-NEW-ROLES
type: workflow
title: "신설 역할 제안 — 고객 지원·정비 거점 / Proposed Roles: Customer Support, Service Site"
status: draft
version: 0.1.0
owner: governance
cycle: 0
related: [WF-INDEX, WF-FPW-8]
last_updated: 2026-11-07
---

# 신설 역할 제안 — 고객 지원·정비 거점

> 결정 D-ADS-7(2026-11-07 확정, 기본안): 계약에 없는 역할은 **기존 역할로 대응**하고, 신설은 이 문서의 2개만 **제안**한다.
> 이 문서는 제안이다. 업무 절차 모델(`model/*.yaml`)·계약 역할(`FF/contracts/src/enums.ts` ROLES)·IAM 스냅샷은 고치지 않았다. 역할 추가는 묶음 F0만 한다(공통 지시 v2).

## 1. 기존 역할로 대응한 것 (신설하지 않음)

| 설계가 쓰던 역할 | 대응 역할 | 근거 |
|---|---|---|
| 분석 전용 | `AUDITOR`(운영/감사 조회자, 읽기 전용) | 쓰기 권한이 필요 없다 |
| 독립 검토자 | `SAFETY_OFFICER` 중 그 산출물의 작성자가 아닌 사람 | 직무 분리 규칙(`contracts/src/rules/duty-separation.ts`)이 작성자 ≠ 검토자를 강제 |
| 공장 품질(출고 품질 보류 결정) | `BOM_APPROVER` | P5 구현(`/baselines/eol`, `d05-ext/data-sync/eol.service.ts`)이 이미 이 위임으로 동작 |
| 커머스 운영 | `PRODUCT_APPROVER`·`OPERATOR` | 상품 출시 승인·운영 조치로 나뉜다(D-ORC-3·5) |

## 2. 신설 제안 2개

ORC-UI09(사건 번호 하나로 — 주문·설치·상태·원격 조치·정비 이관)는 아래 두 직무가 서로 다른 범위를 보고, 고객 동의 범위로 칸을 가린다. 기존 역할 중 이 범위와 맞는 것이 없다.

| 제안 역할 | 하는 일 | 볼 수 있는 것 | 할 수 없는 것 | 주로 쓰는 절차 |
|---|---|---|---|---|
| 고객 지원(`CUSTOMER_SUPPORT`) | VOC·장애 접수, 사건(service_case) 열기·연결, 고객 확인 요청, 정비 거점 인계 | 사건·주문·설치 단계·차량 상태 요약(고객 동의 범위 안) | 원격 조치·긴급 차단 실행·승인, 정책 변경 | FPW.8 운영·긴급 차단·복원(접수·인계 활동) |
| 정비 거점(`SERVICE_SITE`) | 인계받은 사건의 진단 요약·부품·작업 항목 기록, 입고·수리 결과 회신 | 인계받은 사건과 그 차량(VIN) 범위 | 다른 거점 사건 조회, 원격 조치·정책·차단 | FPW.8(인계·결과 회신 활동) |

- 직무 분리: 두 역할 모두 원격 조치·긴급 차단의 요청자·승인자가 될 수 없다(OPERATOR·OPS_LEAD 몫 유지).
- 데모 계정: 겸직 0 원칙(`e2e/static/static.spec.ts`·`e2e/tests/p11.spec.ts`)을 지키려면 계정 2개가 늘거나, 기존 9계정 안에서 재배치해야 한다 — 채택 때 정한다.
- 고객 동의 범위 밖 칸은 역할과 무관하게 '고객 동의 범위 밖'으로 가린다(ORC-UI09 설계).

## 3. 채택하면 바뀌는 것

1. 계약 `ROLES`·`ROLE_LABEL`·직무 분리 표(묶음 F0만).
2. 업무 절차 모델 FPW.8 활동의 담당 역할 diff → `python -I scripts/check.py` → `npm run workflow:sync`(D-ADS-4).
3. IAM 정합성 게이트용 스냅샷 재추출(`scripts/extract_platform.mjs`), 데모 계정 시드.
4. ORC-UI09 화면의 BlockedAction 문구(누가 할 수 있는지)에 새 역할 이름.

채택 전까지 ORC-UI09는 기존 역할(`OPERATOR`·`AUDITOR`)로 착수한다(묶음 P7b).
