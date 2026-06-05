---
id: SCR-900
type: screen
title: "Reports / Analytics & Audit 스펙"
status: draft
version: 0.1.0
owner: governance
cycle: 51
standards: [UNECE-R156, ISO-24089]
traces:
  satisfies: [FR-24]
  realized_in_screen: [SCR-900, SCR-910]
  verified_by: [TC-024]
last_updated: 2026-06-05
---

# Reports / Analytics & Audit 스펙

## 1. 정량효과 리포트 (SCR-900, PPT S27/S34) — 목표치(가설)
| 지표 | Before | After(목표) | 측정 정의 |
|---|---|---|---|
| 영향도 분석 시간 | 2~3일 | 수 분(95%↓) | CR 생성→Impact 완료 |
| 검증 누락률 | 15~20% | <2%(90%↓) | 사후 발견 누락/총 |
| 배포 판단 시간 | 1~2주 | 즉시(90%↓) | 변경→배포방식 확정 |
| 협력사 Gap | 양산 후 | 사전 | Gap 발견 시점 |
| Feature 중복 | 10~15% | <3%(80%↓) | 중복 등록/총 |
| 불필요 Binary OTA | 30~40% | <5%(85%↓) | Binary/총 배포 |

> 정량치는 Mutuus Lab 가설 — PoC/Baseline 실측 검증 필요(NFR 측정 항목으로 추적).

## 2. Audit Log 스펙 (SCR-910, FR-24)
- 레코드: `{actor, ts, action, target(Feature ID), before, after, reason, approval}`.
- append-only·불변(NFR-4). 필터(actor/action/feature/기간)·Export(CSV/PDF).
- R156 SUMS 증적: 배포 이력·RxSWIN·cohort 추적.

## 3. 표준 리포트
Release Readiness 현황·Coverage·Impact 이력·Traceability Health·Connector Sync 상태.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S27,S34) |
