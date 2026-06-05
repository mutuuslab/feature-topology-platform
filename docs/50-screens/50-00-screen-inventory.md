---
id: SCR-INVENTORY
type: screen
title: "화면 인벤토리 / Screen Inventory (60)"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 34
traces:
  satisfies: [FR-27, FR-28, FR-29, FR-30]
last_updated: 2026-06-05
---

# 화면 인벤토리 / Screen Inventory (60)

(P)=PPT 근거 / (N)=신규. 그룹별 상세 스펙은 각 `50-XX-*` 파일.

| ID | 화면 (KO / EN) | G | P/N | 상세 |
|---|---|---|---|---|
| SCR-000 | 로그인·SSO / Login | G0 | N | [[50-10-home-screens]] |
| SCR-001 | 온보딩 / Onboarding | G0 | N | 〃 |
| SCR-010 | 역할별 홈 / Role Home | G0 | P | 〃 |
| SCR-011 | 홈 커스터마이즈 | G0 | N | 〃 |
| SCR-100 | Feature Catalog | G1 | P | [[50-20-master-data-screens]] |
| SCR-101 | Feature Detail (11탭) | G1 | P | 〃 |
| SCR-110 | Taxonomy Browser | G1 | N | 〃 |
| SCR-111 | Taxonomy Editor | G1 | N | 〃 |
| SCR-120 | BOM Editor | G1 | P | 〃 |
| SCR-130 | Feature Definition Wizard | G1 | P | 〃 |
| SCR-140 | Artifact Catalog | G1 | N | 〃 |
| SCR-141 | Control Point Catalog | G1 | N | 〃 |
| SCR-200 | Topology Graph | G2 | P | [[50-30-topology-screens]] |
| SCR-210 | Edge Editor | G2 | N | 〃 |
| SCR-220 | Consistency Rule Console | G2 | N | 〃 |
| SCR-221 | Violation Detail | G2 | N | 〃 |
| SCR-230 | Metamodel Viewer | G2 | N | 〃 |
| SCR-300 | Impact Analysis Center | G3 | P | [[50-40-decision-screens]] |
| SCR-310 | Verification Scope | G3 | P | 〃 |
| SCR-320 | Deployment Decision | G3 | P | 〃 |
| SCR-330 | Supplier Scope | G3 | P | 〃 |
| SCR-340 | Decision Center | G3 | N | 〃 |
| SCR-341 | DecisionReport Viewer | G3 | N | 〃 |
| SCR-400 | CR List | G4 | N | [[50-50-governance-screens]] |
| SCR-401 | CR Detail | G4 | N | 〃 |
| SCR-410 | CR Wizard (5-step) | G4 | N | 〃 |
| SCR-420 | ChangeSet List | G4 | P | 〃 |
| SCR-421 | Baseline Diff | G4 | P | 〃 |
| SCR-422 | Version Timeline | G4 | N | 〃 |
| SCR-500 | Test Evidence Manager | G5 | N | [[50-60-verify-deploy-screens]] |
| SCR-501 | Evidence Detail | G5 | N | 〃 |
| SCR-510 | Release Readiness Center | G5 | P | 〃 |
| SCR-600 | OTA Campaign Manager | G6 | N | [[50-70-ops-screens]] |
| SCR-601 | Campaign Detail | G6 | N | 〃 |
| SCR-610 | Policy Lifecycle Board | G6 | P | 〃 |
| SCR-620 | Operations Dashboard | G6 | P | 〃 |
| SCR-630 | Telemetry Explorer | G6 | N | 〃 |
| SCR-640 | Incident Manager | G6 | P | 〃 |
| SCR-641 | Incident Detail | G6 | N | 〃 |
| SCR-650 | Kill Switch Console | G6 | P | 〃 |
| SCR-700 | Supplier Portal | G7 | N | [[50-80-supplier-integration-screens]] |
| SCR-710 | API Release Package Intake | G7 | P | 〃 |
| SCR-711 | Package Detail | G7 | N | 〃 |
| SCR-800 | Connector Hub | G8 | P | 〃 |
| SCR-801 | Connector Detail | G8 | N | 〃 |
| SCR-810 | Sync Logs | G8 | N | 〃 |
| SCR-900 | Reports / Analytics | G9 | P | [[50-90-admin-shared-screens]] |
| SCR-910 | Audit Log Explorer | G9 | P | 〃 |
| SCR-920 | Glossary | G9 | P | 〃 |
| SCR-A00 | Users & Roles | G10 | N | 〃 |
| SCR-A01 | Permissions Matrix | G10 | N | 〃 |
| SCR-A10 | Org & Domains | G10 | N | 〃 |
| SCR-A20 | Approval Workflow Config | G10 | N | 〃 |
| SCR-A30 | Settings | G10 | N | 〃 |
| SCR-A40 | Notifications Center | G10 | N | 〃 |
| SCR-A50 | Global Search / Command Palette | G10 | N | 〃 |
| PAT-EMPTY/LOAD/ERROR/NOPERM/RPANEL/QA | 공통 패턴 | — | N | [[50-90-admin-shared-screens]] |

**합계: 60 화면 (PPT 12 + 신규 48) + 6 공통 패턴.** IA → [[50-IA-information-architecture]].

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 |
