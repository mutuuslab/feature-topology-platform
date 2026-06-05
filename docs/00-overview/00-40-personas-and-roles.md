---
id: OVERVIEW-PERSONAS
type: overview
title: "페르소나 & 역할 모델 / Personas & Role Model"
status: approved
version: 1.0.0
owner: governance
cycle: 4
traces:
  satisfies: [FR-27, NFR-2]
  realized_in_screen: [SCR-010, SCR-A00, SCR-A01]
last_updated: 2026-06-05
---

# 페르소나 & 역할 모델 / Personas & Role Model

## 1. 역할 모델: 하이브리드 (Hybrid)
- **공통 워크스페이스** — 모든 사용자가 동일 메뉴 구조(좌측 그룹 사이드바)를 본다.
- **역할 프리셋** — 7개 페르소나별 기본 랜딩 대시보드·핀 항목·Quick Action을 조정.
- **RBAC** — 항목별 가시성(hidden)/읽기전용/편집을 verb로 제어.

## 2. 7개 페르소나 + Admin
| 코드 | 페르소나 (KO / EN) | 기본 랜딩 | 주요 화면 | 대표 권한 verb |
|---|---|---|---|---|
| P1 | 기획 / Planning | Catalog | Catalog·Feature Detail(Summary/Taxonomy)·Reports | view, create, run-engine |
| P2 | 시스템 / Systems | Topology Graph | Topology·Detail(Topology/BOM)·Impact | view, create, edit, run-engine |
| P3 | SW / Software | Decision Center | Detail(BOM/Control/Deploy)·ChangeSet·Decision | view, create, edit, run-engine, deploy*, rollback |
| P4 | 검증 / Verification | Verification | Verification·Release Readiness·Detail(Verify) | view, edit, approve**, run-engine |
| P5 | OTA / Deployment | OTA Campaign | OTA Campaign·Policy Lifecycle·Kill Switch | view, edit, run-engine, deploy, kill, rollback |
| P6 | 협력사관리 / Supplier | Supplier Portal | Supplier Portal·API Package·Decision(Supplier) | view, create, edit, run-engine |
| P7 | 운영 / Operations | Ops Dashboard | Ops·Telemetry·Incident·Kill Switch | view, run-engine, kill, rollback |
| — | Admin / Governance | Admin Home | Admin/RBAC·Approval·Audit·Consistency Console | all (incl. approve, admin) |

`*` domain-scoped · `**` Verification Gate only.

## 3. RBAC verb (10종)
`view · create · edit · delete · approve · run-engine · deploy · kill · rollback · admin`
범위(scope): **Domain**(Body/ADAS/Connectivity…) × **Lifecycle-gate**(예: Verification Gate는 P4만 flip).

## 4. "조직별 다른 언어" 문제 → Feature ID 통합
7개 조직이 같은 기능을 다르게 부른다(PPT S36): 기획 "스마트 도어 잠금" · 시스템 "Remote Door Lock" · SW "BDC_PolicyControl_v3" · 협력사 "BDC_FUNC_032" · 검증 "HIL-BDC-001" · OTA "PKG-POLICY-BDC" · 운영 "EVT_BDC_POLICY". → **하나의 FEAT-BDC-001**로 통합 추적.

## 5. 화면 매핑
권한 매트릭스 상세 → SCR-A01 (사이클 43) · 역할별 홈 → SCR-010 (사이클 35).

---
출처/근거: PPT S19,S36,S43 · 사용자 확정(하이브리드 역할 모델).
