---
id: SCR-710
type: screen
title: "협력사 & 연동 화면군 / Supplier & Integration (G7, G8)"
status: draft
version: 0.1.0
owner: supplier-liaison
cycle: 42
traces:
  satisfies: [FR-26, FR-20, FR-25]
  implemented_by: [INT-SUPPLIER-PKG, INT-CODEBEAMER, INT-UNLEASH, ENT-SUPPLIERFUNCTION]
  realized_in_screen: [SCR-330, SCR-510]
  verified_by: [TC-026, TC-025]
last_updated: 2026-06-05
---

# 협력사 & 연동 화면군 / Supplier & Integration

## SCR-700 · Supplier Portal (N)
- 협력사 전용 워크스페이스(RBAC 외부 스코프): 담당 Feature·패키지 상태·요청. Supplier SSO.

## SCR-710 · API Release Package Intake (P, S32)
```
┌ 협력사 ▸ API Release Package ─ SUP-BDC-A / BDC_FUNC_032 ──────────[+ Upload]┐
│ 10-Item Checklist                        Mapped: FEAT-BDC-001              │
│ 1 API Contract ✅  2 Human Doc ✅  3 Feature Mapping ✅  4 Capability ✅     │
│ 5 Variant Compat 🟠  6 Diagnostics ✅  7 Safety/Sec ✅  8 SDK/Mock ✅        │
│ 9 Test Evidence 🟠(cov 78%)  10 Release Note ✅                            │
├────────────────────────────────────────────────────────────────────────────┤
│ Supplier Gate(⑥): 🟠 2 incomplete → 불통과  [Validate][Run Supplier Engine] │
└────────────────────────────────────────────────────────────────────────────┘
```
- 10항목 검증(OpenAPI 3.2)·매핑(Supplier↔OEM)·Supplier Gate(G6) 연동.

## SCR-711 · Package Detail (N)
- 단일 패키지: 10항목 상세·gate 상태·매핑 경로(Feature→Function→SWC→ECU→API→Test→Acceptance).

## SCR-800 · Connector Hub (P, S38)
- 커넥터 카드: Codebeamer·PLM·Unleash·OTA·MQTT — 상태(연결/오류)·last sync.

## SCR-801 · Connector Detail (N)
- REST/Webhook 설정·필드 매핑·인증·동기화 주기·충돌 해소 정책.

## SCR-810 · Sync Logs (N)
- 양방향 sync 이력·conflict·재시도(outbox). Audit 연계.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S32,S38) |

## file:// 공급사 업무 시연 (2026-11-09)

담당: `taxonomy_static_followup`. 연결 서비스와 실차 적용을 제외한 공급사 원장 업무를 브라우저 시연 엔진에서 처리한다. 패키지·매핑·SWC·추가 산출물 기록·수락 기준 개정·제출·독립 검수는 IndexedDB 오버레이와 공통 CAS 트랜잭션에 저장한다. 캡처 원천과 기존 서명은 변경하지 않으며 로컬 생성·수정 결과에는 `LOCAL_SIMULATION` 출처를 둔다.

- 서버와 같은 요청 스키마·역할·Feature/버전 귀속·동일 공급사 SW/ECU 연결·패키지 버전 증가·필수 10항목·참여자와 다른 검수자를 적용한다. 기준 개정 후 이전 검수 합격을 현재 합격으로 재사용하지 않는다.
- 본문은 URI에서 내려받지 않는다. 보관한 UTF-8 JSON을 WebCrypto SHA-256으로 재계산하고 대상 manifest·메타데이터·OpenAPI 3.2/Protobuf 구문을 확인한다. 원문이 없으면 신고 상태로 남고, 불일치하면 검수 합격을 막는다. 본문은 감사·이벤트에 복제하지 않는다.
- 기존 산출물·검수는 추가 이력으로 보존한다. 새 패키지에 산출물을 이어받아도 이전 패키지 버전에 묶인 본문을 새 버전의 일치 근거로 바꾸지 않는다. G6 PASS 요청은 현재 공급사 검수 사실을 다시 읽는다.
- 공급사 책임 범위는 새 매핑·패키지·본문 검증 상태를 재계산한다. 연락처와 Feature 공통 추적 근거는 캡처 출처를 유지하며 Version 결속을 추정하지 않는다. 원천이 없으면 오류로 남긴다.

검증: `supplierStatic.test.ts` 9건과 화면·등록·추적 영향 회귀를 합쳐 35건 통과. native와 브라우저 본문 검증 결과 비교, 해시 변조·미보관 원문·중복 동시 작성·독립 검수 거부·기준 개정·이어받기·이력 보존을 포함한다. 실제 file 브라우저 저장·재열기·다중 창 결과는 후속 증거로 기록한다.
