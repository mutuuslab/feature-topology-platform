---
id: ARC-RULES-OVERVIEW
type: rule
title: "룰 & 엔진 개요 / Rules & Engines Overview"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 21
standards: [OMG-DMN-1.5]
traces:
  satisfies: [FR-8, FR-17, FR-18, FR-19, FR-20]
  realized_in_screen: [SCR-220, SCR-340]
last_updated: 2026-06-05
---

# 룰 & 엔진 개요 / Rules & Engines Overview

## 1. 구성
| 종류 | 수 | 문서 |
|---|---|---|
| Consistency Rules | 12 + Edge 품질 4 | [[40-10-consistency-rules]] |
| Decision Engines | 4 | [[40-20-engine-impact]]~[[40-50-engine-supplier]] |
| Lifecycle/CR/Runtime SM | 3 | [[40-60-lifecycle-state-machine]] |
| Release Readiness Gates | 9 | [[40-70-release-readiness-gates]] |
| Baseline/ChangeSet | — | [[40-80-baseline-changeset]] |

## 2. DMN형 결정표 포맷 (모든 룰/엔진 공통)
```yaml
decision: <id>
inputs: [...]
rules:           # hit policy: FIRST (위→아래 우선)
  - { when: "<condition>", then: "<output>" }
default: "<fallback>"
```

## 3. 룰 성격별 분리(설계 권고)
- 구조 불변식 → 그래프 제약(SHACL형) · 만족성(requires/excludes) → SAT/BDD · 정책 결정 → DMN/Drools.
- (대안 B 전환 시 엔진별 분리 — [[20-30-decision-engine-pipeline]])

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 |
