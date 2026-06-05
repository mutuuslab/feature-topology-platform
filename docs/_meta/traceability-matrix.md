---
id: META-TRACE-MATRIX
type: meta
title: "추적성 매트릭스 / Traceability Matrix"
status: approved
version: 1.0.0
owner: governance
cycle: 52
last_updated: 2026-06-05
---

# 추적성 매트릭스 / Traceability Matrix

각 문서의 `traces:` 프런트매터 집계 뷰. 모든 FR이 ≥1 SCR·≥1 TC와 연결되고, 모든 SCR이 ≥1 FR에 매핑됨을 보장.

## 1. FR → 엔티티/룰·엔진/화면/테스트 (전 30개)
| FR | 엔티티/룰·엔진 | 화면(SCR) | TC |
|---|---|---|---|
| FR-1 | ENT-FEATURE / R01,R02 | SCR-130,100,101 | TC-001 |
| FR-2 | ENT-TAXONOMYNODE | SCR-110,111 | TC-002 |
| FR-3 | ENT-FEATUREBOM,BOMITEM / R12 | SCR-120 | TC-003 |
| FR-4 | ENT-FEATURE | SCR-100 | TC-004 |
| FR-5 | EDG-* / EQ1~EQ4 | SCR-210,200 | TC-005 |
| FR-6 | ENG-IMPACT | SCR-200 | TC-006 |
| FR-7 | ENT-* (18) | SCR-230 | TC-007 |
| FR-8 | RULE-R01~R12 | SCR-220,221 | TC-008 |
| FR-9 | ENT-VARIANTRULE | SCR-220,101 | TC-009 |
| FR-10 | ENT-CONTROLPOINT | SCR-141,610 | TC-010 |
| FR-11 | ENT-TELEMETRYEVENT | SCR-620 | TC-011 |
| FR-12 | VARIANTRULE,CONTROLPOINT | SCR-610,650 | TC-012 |
| FR-13 | ENG-DEPLOY,DEPLOYMENTUNIT | SCR-320 | TC-013 |
| FR-14 | ENG-VERIFY,TESTCASE | SCR-310 | TC-014 |
| FR-15 | TELEMETRYEVENT,DTC | SCR-620,630,640,910 | TC-015 |
| FR-16 | ROLLBACKPLAN,CONTROLPOINT | SCR-650 | TC-016 |
| FR-17 | ENG-IMPACT | SCR-300 | TC-017 |
| FR-18 | ENG-VERIFY | SCR-310 | TC-018 |
| FR-19 | ENG-DEPLOY | SCR-320 | TC-019 |
| FR-20 | ENG-SUPPLIER | SCR-330,711 | TC-020 |
| FR-21 | LCS-* | SCR-610,101 | TC-021 |
| FR-22 | GATE-G1~G9 | SCR-510 | TC-022 |
| FR-23 | FEATUREBOM / R12 | SCR-420,421,422 | TC-023 |
| FR-24 | (audit) | SCR-910 | TC-024 |
| FR-25 | INT-* | SCR-800,801,810 | TC-025 |
| FR-26 | INT-SUPPLIER-PKG,SUPPLIERFUNCTION | SCR-710,711 | TC-026 |
| FR-27 | — | SCR-010,100 | TC-027 |
| FR-28 | ENT-FEATURE | SCR-101 | TC-028 |
| FR-29 | ENG-IMPACT | SCR-300 | TC-029 |
| FR-30 | GATE-* | SCR-510 | TC-030 |
| NFR-1~7 | — | SCR-A01,910 | TC-031~037 |

## 2. SCR → FR 역참조 (모든 화면 ≥1 FR)
| SCR 그룹 | 대표 매핑 |
|---|---|
| G0(000,001,010,011) | FR-27, NFR-2 |
| G1(100~141) | FR-1,2,3,4,28 |
| G2(200~230) | FR-5,6,7,8 |
| G3(300~341) | FR-17,18,19,20,29 |
| G4(400~422) | FR-21,23,24 |
| G5(500~510) | FR-14,22,30 |
| G6(600~650) | FR-13,15,16 |
| G7(700~711) | FR-20,26 |
| G8(800~810) | FR-25 |
| G9(900~920) | FR-24 |
| G10(A00~A50) | NFR-2 |

## 3. 검증 결과 (cycle 53 검증기)
- ✅ 30/30 FR 이 ≥1 SCR + ≥1 TC 연결.
- ✅ 모든 SCR 그룹이 ≥1 FR 매핑.
- ✅ 18 Entity·10 Edge·12 Rule·4 Engine·9 Gate·6 Lifecycle 등록(id-registry).
- ⚠️ TC-001~037 는 후속 구현 단계에서 실제 테스트로 구현(현재 ID 예약).
