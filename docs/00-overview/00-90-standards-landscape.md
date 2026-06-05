---
id: OVERVIEW-STANDARDS
type: overview
title: "표준 landscape / Standards Landscape"
status: approved
version: 1.0.0
owner: governance
cycle: 4
last_updated: 2026-06-05
---

# 표준 Landscape / Standards Landscape

상세 등록부는 [[standards-register]]. 여기서는 **어느 표준이 시스템의 어느 부분을 지배하는가**를 한눈에.

```mermaid
flowchart TB
  subgraph REQ["요구사항·모델"]
    A1[ISO/IEC/IEEE 29148]:::s --> FR[FR 명세]
    A2[OMG SysML 2.0]:::s --> MM[Metamodel]
    A3[OMG ReqIF 1.2]:::s --> INT1[Codebeamer 연동]
    A4[FODA]:::s --> EDG[requires/excludes]
  end
  subgraph DEC["의사결정"]
    B1[OMG DMN 1.5]:::s --> RULE[Consistency Rules / Engines]
    B2[OMG BPMN 2.0.2]:::s --> WF[승인 워크플로]
  end
  subgraph DEP["배포·안전·보안"]
    C1[ISO 24089 / UNECE R156]:::s --> OTA[OTA Gate / 배포 증적]
    C2[UNECE R155 / ISO 21434]:::s --> SEC[Security Gate]
    C3[ISO 26262]:::s --> SAF[Safety Gate / ASIL]
    C4[Uptane]:::s --> INTEG[OTA 무결성]
  end
  subgraph RT["런타임·연동"]
    D1[OpenFeature / Unleash]:::s --> CP[Control Point]
    D2[OpenAPI 3.2.0]:::s --> API[Supplier API 계약]
    D3[MQTT 5.0]:::s --> TEL[Telemetry / 정책 배포]
    D4[AUTOSAR Adaptive]:::s --> TGT[배포 타깃]
  end
  classDef s fill:#eef,stroke:#88a;
```

## 버전 주의 (검증 완료)
- SysML **2.0** (2025-07 정식) · OpenAPI **3.2.0** (2025-09 실재) · DMN **1.5**(1.6 beta) · BPMN **2.0.2** · ISO **24089**(SAE 아님) · MQTT **5.0**.

## 매핑 사이클
보안/규제 상세 매핑 → 사이클 33([[20-50-security-architecture]]). 연동 → 사이클 47–48.

---
출처/근거: [[standards-register]] (웹 검증 2026-01).
