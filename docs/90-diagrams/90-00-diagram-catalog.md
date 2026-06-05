---
id: DIAG-CATALOG
type: diagram
title: "다이어그램 카탈로그 / Diagram Catalog"
status: approved
version: 1.0.0
owner: feature-architect
cycle: 53
last_updated: 2026-06-05
---

# 다이어그램 카탈로그 / Diagram Catalog

| ID | 타입 | 위치/임베드 | 문서 |
|---|---|---|---|
| DIAG-ERD-METAMODEL | erDiagram | `erd/DIAG-ERD-METAMODEL.mmd` | [[30-00-metamodel-overview]] |
| DIAG-FLW-BDC | flowchart | `class/DIAG-FLW-BDC.mmd` | [[30-60-feature-edges]],[[99-00-bdc-overview]] |
| DIAG-FLW-CONCEPT / FIVE-OUTPUTS | flowchart (embed) | 00-overview | [[00-20-concept-feature-topology]],[[00-30-five-outputs]] |
| DIAG-STA-LIFECYCLE/CR/RUNTIME | stateDiagram (embed) | 40-60 | [[40-60-lifecycle-state-machine]] |
| DIAG-FLW-CONSISTENCY-CHECK | flowchart (embed) | 40-10 | [[40-10-consistency-rules]] |
| DIAG-FLW-DECISION-PIPELINE | flowchart (embed) | 20-30,40-50 | [[20-30-decision-engine-pipeline]] |
| DIAG-SEQ-DEPLOY-DECISION | sequenceDiagram (embed) | 40-50,60-20 | [[40-50-engine-supplier]] |
| DIAG-SEQ-KILLSWITCH | flowchart (embed) | 60-50 | [[60-50-kill-switch-rollback-flow]] |
| DIAG-SEQ-SUPPLIER-SYNC | sequenceDiagram (embed) | 60-60 | [[60-60-supplier-release-package-flow]] |
| DIAG-FLW-GATES | flowchart (embed) | 40-70,60-30 | [[40-70-release-readiness-gates]] |
| DIAG-C4-CONTEXT/CONTAINER | flowchart (embed) | 20-00 | [[20-00-architecture-overview]] |
| DIAG-STANDARDS-LANDSCAPE | flowchart (embed) | 00-90 | [[00-90-standards-landscape]] |

## 규약
구조=erDiagram/classDiagram · 시간행위=stateDiagram/sequenceDiagram · 결정로직=flowchart(+DMN YAML) · 시스템형상=C4(flowchart). 독립 소스는 `.mmd`, 본문 설명용은 임베드.
