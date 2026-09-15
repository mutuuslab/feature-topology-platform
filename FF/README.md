# Feature Platform — 동작 프로토타입 (FF/)

`docs/` 상세 설계를 입력으로 한 UI/UX 동작 프로토타입. BDC 시드(FEAT-BDC-001)로 E2E 검증.

## 구성
- **`frontend/`** — Vite + React + TypeScript + Cytoscape. **자체 완결형**(시드+엔진 내장)으로 백엔드 없이 단독 실행. ← **현재 메인**
- **`backend/`** — NestJS + 인메모리 `GraphPort`(+ 4 Decision Engine·12 Consistency Rule·9 Gate·REST API). 빌드·스모크테스트 완료. **나중에 연동**.

## 실행 (프론트엔드)
```bash
cd FF/frontend
npm install
npm run dev          # http://localhost:9001   (포트 8000 금지)
```

## 화면 — 전 60화면 구현 (좌측 사이드바 G0~G10)
- **G0 홈**: Role Home(역할 프리셋)·Login/SSO·Onboarding·Home Customize·Global Search(⌘K)
- **G1 기준정보**: Catalog·Feature Detail(11탭)·Feature 등록(7-criteria)·Taxonomy Browser/Editor·BOM Editor·Artifact/Control Point Catalog
- **G2 관계**: Topology Graph(Cytoscape)·Edge Editor·Metamodel Viewer·Consistency Console·Violation Detail
- **G3 의사결정**: Decision Center·Impact·Verification Scope·Deployment Decision·Supplier Scope·DecisionReport
- **G4 변경관리**: CR List/Detail·CR Wizard(5단계)·ChangeSet·Baseline Diff·Version Timeline
- **G5 검증**: Test Evidence Manager/Detail·Release Readiness(9-Gate → HOLD)
- **G6 배포·운영**: Ops · Kill Switch(단계 복구)·OTA Campaign/Detail·Policy Lifecycle·Telemetry Explorer·Incident·Variant Matrix
- **G7 협력사**: Supplier Portal·API Release Package(10항목)·Package Detail
- **G8 연동**: Connector Hub/Detail·Sync Logs
- **G9 분석·감사**: Reports(정량효과)·Audit Log·Glossary
- **G10 관리자**: Users&Roles·Permissions Matrix·Org&Domains·Approval Workflow·Settings·Notifications

핵심 동작: Topology Cytoscape 그래프, Impact→Policy-only 자동판단, 9-Gate HOLD, Kill Switch 5→20→100% 복구, CR Wizard 파이프라인.

## E2E 검증 포인트 (덱과 일치)
- Catalog 집계, Feature Detail Health 5/6
- Impact: 2 Features·1 SWC·1 ECU·1 Supplier·3 Tests → **Policy-only (High)**
- Readiness: **8/9 PASS, G5 Verification PENDING(OTA-RB-002) → HOLD**
- Kill Switch → Safe Default(disabled) → 단계 복구

## 구현 화면만 노출 (기준 패키지 FP-DETAILED-1.1 / MENU 1.3, 2026-09-13)
제품 셸에는 **실제 구현된 화면만** 올린다. 요구사양 문서(기준 화면 정의서 `/ui/UIxx`, 기준 아키텍처 `/arch`,
개정 이력 `/spec/changelog`, 용어집 `/spec/glossary`)는 제품 화면·메뉴·참조 링크 어디에도 없다 —
정의서와 상세설계는 저장소 밖 기준 패키지에서 관리한다.
- 1차(기능별) = 기준 7 업무 그룹, 부서별 = 기준 9 역할이 소유한 구현 화면, Plane별 = 구현된 4 Plane.
- 이전 데모의 **604 FR / 47 family "기능명세서"**(Overview·FR Explorer·Coverage, `src/data/spec.json`)도 같은 이유로 제거했다.

## 백엔드 연동 (나중)
`frontend/src/data/engine.ts` 의 함수를 `fetch('/api/...')` 로 교체하고 `vite.config.ts` 의 `/api` proxy 주석 해제 → `backend`(포트 9101) 기동. 백엔드의 `GraphPort` 를 PostgreSQL+Apache AGE 어댑터로 교체하면 대안 A 완성(AGE는 Windows 네이티브 미지원 → docker 권장).

## 실행 (백엔드, 선택)
```bash
cd FF/backend
npm install && npm run build && npm start   # http://localhost:9101/api/catalog
```
