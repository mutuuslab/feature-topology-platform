---
id: FR-24
type: requirement
title: "Audit Log — 불변 감사 추적"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 12
standards: [ISO-24089, UNECE-R156]
traces: { implemented_by: [], realized_in_screen: [SCR-910], verified_by: [TC-024], depends_on: [FR-21] }
last_updated: 2026-06-05
---

# FR-24 · Audit Log — 불변 감사 추적

## 1. 개요
정책 변경자·시간·승인·배포 이력을 불변(append-only)으로 보관한다. Lifecycle Event는 모두 Audit 대상.

## 2. 명세
- 기록 항목: actor·timestamp·action·target(Feature ID)·before/after·reason·approval.
- 대상 이벤트: 등록·수정·승인·배포·Kill·Rollback·Baseline 변경·연동 sync.
- 필터·검색·Export(SCR-910). Feature ID 기준 귀속.

## 3. 업무 규칙
- append-only, 수정/삭제 불가(NFR-4).
- R156 SUMS 증적·RxSWIN 추적 가능하도록 배포 이력 보존.

## 4. 인수 기준 (Gherkin)
```gherkin
Scenario: Kill Switch 실행 감사
  Given 운영자가 FEAT-BDC-001을 Kill 한다
  When 액션이 실행된다
  Then actor·time·reason·scope가 불변 감사 로그에 기록되고 SCR-910에서 조회된다
```

## 4. 데이터 / 화면
(audit store) · SCR-910 Audit Log Explorer.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S17,S26) |
