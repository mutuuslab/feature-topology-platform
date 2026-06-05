---
id: ARC-SECURITY
type: architecture
title: "보안·규제 아키텍처 / Security & Regulatory"
status: draft
version: 0.1.0
owner: verification-safety
cycle: 33
standards: [UNECE-R155, UNECE-R156, ISO-24089, ISO/SAE-21434, ISO-26262]
traces:
  satisfies: [NFR-2, FR-22, FR-24]
  implemented_by: [GATE-G7, GATE-G8, GATE-G9]
last_updated: 2026-06-05
---

# 보안·규제 아키텍처 / Security & Regulatory

## 1. 규제 → 시스템 매핑
| 규제/표준 | 요구 | 시스템 반영 |
|---|---|---|
| UNECE R156 (SUMS) | SW 업데이트 관리·RxSWIN·배포 무결성 증적 | GATE-G8 OTA·FR-24 Audit·배포 이력(어느 SW가 어느 차량에) |
| UNECE R155 (CSMS) | 사이버보안 관리체계 | GATE-G7 Security·RBAC(NFR-2) |
| ISO 24089 | SW 업데이트 엔지니어링 work product | 배포 Gate·ChangeSet·Evidence |
| ISO/SAE 21434 | TARA·사이버 보안 수명주기 | Security Impact → Security Gate(R09) |
| ISO 26262 | 기능안전·ASIL | Safety Impact → Safety Gate(R08), ASIL 승인 escalation |

## 2. RBAC (NFR-2)
verb 10종 × Domain × Lifecycle-gate 스코프. 모든 변경 액션 verb 검증 + 불변 감사(FR-24). 승인 워크플로(SCR-A20)에서 ASIL 등급별 추가 승인.

## 3. RxSWIN 추적
배포 단위(DeploymentUnit)에 RxSWIN 연계, Audit로 "어느 Feature/SW 버전이 어느 cohort에" 추적 — R156 감사 증적.

## 4. 갭 (보강 필요)
Uptane(OTA 무결성 프레임워크), AUTOSAR UCM 연계, RxSWIN 발번 규칙 상세 — 사이클 47/후속.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (표준 register 기반) |
