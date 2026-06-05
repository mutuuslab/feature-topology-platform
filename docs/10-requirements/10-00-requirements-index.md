---
id: REQ-INDEX
type: requirement
title: "요구사항 인덱스 / Requirements Index"
status: approved
version: 1.0.0
owner: requirements-engineer
cycle: 6
standards: [ISO/IEC/IEEE-29148]
last_updated: 2026-06-05
---

# 요구사항 인덱스 / Requirements Index

FR-1~FR-30 (기능) + NFR-1~7 (비기능). 각 FR은 모듈 폴더에 1파일로 ISO/IEC/IEEE 29148 형식 + Gherkin 인수기준으로 상세화.

## 기능 요구사항 (FR)
| FR | 제목 | 모듈 | 우선순위 | 핵심 엔티티 | 핵심 화면 |
|---|---|---|---|---|---|
| [FR-1](10-A-master-data/FR-1-feature-definition.md) | Feature Definition | A | Must | ENT-FEATURE | SCR-130 |
| [FR-2](10-A-master-data/FR-2-taxonomy.md) | Feature Taxonomy | A | Must | ENT-TAXONOMYNODE | SCR-110/111 |
| [FR-3](10-A-master-data/FR-3-feature-bom.md) | Feature BOM | A | Must | ENT-FEATUREBOM/BOMITEM | SCR-120 |
| [FR-4](10-A-master-data/FR-4-catalog.md) | Feature Catalog | A | Must | ENT-FEATURE | SCR-100 |
| [FR-5](10-B-topology/FR-5-relationship-edge.md) | Relationship Edge | B | Must | EDG-* | SCR-210 |
| [FR-6](10-B-topology/FR-6-topology-graph.md) | Topology Graph | B | Must | (graph) | SCR-200 |
| [FR-7](10-B-topology/FR-7-metamodel.md) | Metamodel (18 Entity) | B | Must | ENT-* | SCR-230 |
| [FR-8](10-B-topology/FR-8-consistency-rules.md) | Consistency Rules (12) | B | Must | RULE-* | SCR-220 |
| [FR-9](10-C-variant-runtime/FR-9-variant-filter.md) | Variant Filter | C | Must | ENT-VARIANTRULE | SCR-220(Var) |
| [FR-10](10-C-variant-runtime/FR-10-control-gate.md) | Control Gate | C | Must | ENT-CONTROLPOINT | SCR-141 |
| [FR-11](10-C-variant-runtime/FR-11-runtime-state.md) | Runtime State | C | Should | ENT-TELEMETRYEVENT | SCR-620 |
| [FR-12](10-C-variant-runtime/FR-12-activation-decision.md) | 활성화 판단 (3중 Guard) | C | Must | — | SCR-610 |
| [FR-13](10-D-deploy-verify/FR-13-deployment-decision.md) | Deployment Decision | D | Must | ENT-DEPLOYMENTUNIT | SCR-320 |
| [FR-14](10-D-deploy-verify/FR-14-verification-scope.md) | Verification Scope | D | Must | ENT-TESTCASE | SCR-310 |
| [FR-15](10-E-ops-telemetry-audit/FR-15-operations.md) | Operations/Telemetry/Audit | E | Must | ENT-TELEMETRYEVENT | SCR-620/630/640 |
| [FR-16](10-E-ops-telemetry-audit/FR-16-killswitch-rollback.md) | Kill Switch / Rollback | E | Must | ENT-ROLLBACKPLAN | SCR-650 |
| [FR-17](10-F-decision-engines/FR-17-impact-engine.md) | Impact Engine | F | Must | ENG-IMPACT | SCR-300 |
| [FR-18](10-F-decision-engines/FR-18-verification-engine.md) | Verification Engine | F | Must | ENG-VERIFY | SCR-310 |
| [FR-19](10-F-decision-engines/FR-19-deploy-engine.md) | Deploy Engine | F | Must | ENG-DEPLOY | SCR-320 |
| [FR-20](10-F-decision-engines/FR-20-supplier-engine.md) | Supplier Engine | F | Must | ENG-SUPPLIER | SCR-330 |
| [FR-21](10-G-governance/FR-21-lifecycle.md) | Feature Lifecycle | G | Must | LCS-* | SCR-610 |
| [FR-22](10-G-governance/FR-22-release-readiness.md) | Release Readiness (9 Gate) | G | Must | GATE-* | SCR-510 |
| [FR-23](10-G-governance/FR-23-baseline-changeset.md) | Baseline & ChangeSet | G | Must | ENT-FEATUREBOM | SCR-420/421 |
| [FR-24](10-G-governance/FR-24-audit-log.md) | Audit Log | G | Must | — | SCR-910 |
| [FR-25](10-H-integration/FR-25-tool-integration.md) | 외부 도구 연동 | H | Must | INT-* | SCR-800 |
| [FR-26](10-H-integration/FR-26-supplier-package.md) | Supplier API Package | H | Should | INT-SUPPLIER-PKG | SCR-710 |
| [FR-27](10-I-ui/FR-27-dashboard-catalog.md) | Dashboard/Catalog UI | I | Must | — | SCR-010/100 |
| [FR-28](10-I-ui/FR-28-feature-detail.md) | Feature Detail UI (11탭) | I | Must | ENT-FEATURE | SCR-101 |
| [FR-29](10-I-ui/FR-29-impact-center.md) | Impact Center UI | I | Must | — | SCR-300 |
| [FR-30](10-I-ui/FR-30-release-readiness.md) | Release Readiness UI | I | Must | GATE-* | SCR-510 |

## 비기능 요구사항 (NFR)
→ [10-80-nfr.md](10-80-nfr.md) (NFR-1 성능 · NFR-2 보안 · NFR-3 가용성 · NFR-4 감사 · NFR-5 확장성 · NFR-6 국제화 · NFR-7 접근성)

## 제약·전제
→ [10-90-constraints-assumptions.md](10-90-constraints-assumptions.md)

---
출처/근거: PPT 전 슬라이드 · ISO/IEC/IEEE 29148:2018.
