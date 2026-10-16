---
id: SCR-IA
type: screen
title: "정보구조 & 네비게이션 셸 / IA & Nav Shell"
status: implemented
version: 2.1.0
owner: feature-architect
cycle: 34
traces:
  satisfies: [FR-27, NFR-2, NFR-6]
  realized_in_screen: [SCR-010, SCR-A50]
last_updated: 2026-10-16
---

# 정보구조 & 네비게이션 셸 / IA & Nav Shell — MENU 2.0

구현 원천은 `FF/frontend/src/routes.tsx` 하나다. 메뉴·breadcrumb·⌘K·IA 하네스(`__tests__/ia.test.tsx`)·e2e 메뉴 순회·접근성 검사가 모두 이 배열을 읽는다.
화면 이름 = 메뉴 라벨 = 화면 h1 = breadcrumb 마지막 칸.

## 1. 셸 레이아웃
```
┌────┬──────────────┬──────────────────────────────────────────────────────────────┐
│ 레 │ 그룹 패널     │ 상단바: [Feature ID·이름 검색] [⌘K 명령] [역할▾ ☐내 역할 메뉴만]   │
│ 일 │ (232, 접기)   │         [알림] [테마] [실시간 모션] [시연 모드 P] [언어]          │
│ 64 │              ├──────────────────────────────────────────────────────────────┤
│    │ 그룹의 메뉴   │ Breadcrumb: 그룹 ▸ 메뉴 화면 ▸ 하위 화면                         │
│ 8  │ 항목          │ ┌──────────────────────────────────────┬────────────────────┐ │
│ 그 │              │ │ 본문 (PageHeader · KPI · Panel · 표)  │ 컨텍스트 드로어 380 │ │
│ 룹 │              │ │                                      │ (Feature ID 요약)  │ │
└────┴──────────────┴─┴──────────────────────────────────────┴────────────────────┘
```
- **차량 운영·안전** 그룹은 어두운 관제실 톤(`data-zone="ops"`)으로 바뀌어 지금 운영 모드임을 보인다.
- 밀도(1366~1536 compact · 1920 comfortable)와 **시연 모드**(`P`, 18px 기준·고대비·PoC 단계 표시줄 고정)는 같은 토큰의 다른 값이다.

## 2. 메뉴 트리 — 업무 기준 8그룹 (메뉴 55)
```
⌂ 홈              내 대시보드 / · 검토함 /admin/approval · 표준 따라하기 /learn · PoC 6단계 진행 /poc · 42 컴포넌트 아키텍처 /arch/components
▸ Feature 정의     Feature 제안 /feature/propose · Feature Registry /features · Feature 등록 /master/define · 변경요청 /change/cr · Taxonomy /master/taxonomy
▸ 구성·Topology    BOM 기준선·확정 승인 /baselines · Topology·의존관계 검증 /arch/topology · 변경 영향 분석 /analysis/impact · Variant·지원 조건 /variant-conditions
▸ 기준정보         UPG·UPG-VC /master/upg · SW·Artifact /master/artifacts · SW 구조 /master/structure · SW EO /change/eo · 제어점 /master/control-points · 데이터 사전점검 /precheck
▸ 검증·Gate        품질 기준·Evidence /verify/evidence · 분야별 검증 이력 /validations · 컴플라이언스 /verify/compliance · 품질 피드백 /quality/feedback
                   · CARLA 가상검증 /validations/virtual · 실험·효과 /experiments · 요구·안전 추적 /trace/design
▸ 상품·출시        Feature Catalog 상품 /products · 사용 권한·체험권 /entitlements · 활성화 판단 /activation/decide · 정책·검증·승인 /policies
                   · Flag 은퇴 /flag-retirements · 서명 배포·차량 회신 /deployments
▸ 차량 운영·안전   Fleet 실시간 적용 현황 /fleet/live · 차량별 적용 상태 /fleet/vehicles/ego-01 · 긴급 차단·복구 /ops/kill · 이상 징후 대응 /ops/anomalies
  (관제실 톤)      · 운행 중 감시 지표 /ops/safety-kpi · 장애·VOC /ops/incidents · 운영 데이터·이벤트 /ops/telemetry · Platform 이벤트 /events
⚙ 연계·감사·관리   외부 연계 현황 /integration/connectors · OpenFeature 범위 /integration/openfeature · 데이터 동기화 /integration/sync · Legacy 연계 /integration/legacy
                   · 현장 지원 포털 /field · 협력사 이관 /supplier/portal · 감사 이력 /audit · 감독 기록 /audit/oversight · 플랫폼 인증·권한 /admin/iam
                   · 보안·인증서 /admin/security · 데이터·규제 기록 /admin/data · 체험 전환 분석 /biz/trials · 설정 /admin/settings · 디자인 시스템 /_design
```

## 3. 메뉴 밖 화면 규칙
- **하위 화면(drill-down)**: 부모(`parent`)가 명시된 화면만 둔다 — Feature Version 상세 `/features/:id/:ver`, 상품 상세·구성, 정책 상세·작성, 게시본 상세, 따라하기 시나리오.
  고아 라우트(부모 없는 비메뉴 라우트)는 IA 하네스가 막는다.
- **이전 주소**: 예전 화면 주소(55개)는 `legacyTo()`로 대응 v2 화면에 넘겨 준다(예: `/catalog` → `/features`, `/topology/:id` → `/arch/topology?feature=:id`). 화면 코드는 지웠다.
- **3D 시연 화면**: `/twin/impact`·`/twin/simulation`·`/twin/fleet`·`/twin/vehicle/:vin`·`/twin/incident`는 BDC 데모 장면으로, 각 v2 화면의 하위 화면이다.
  별도 진입점 `twin.html`도 같은 장면을 쓴다.
- **역할별 첫 진입**: 처음 열면 역할의 기본 화면으로 간다(`store.tsx` roleHome — 모두 v2 화면). 내 대시보드는 메뉴로 간다.

## 4. 역할 적용
- 모든 역할이 같은 트리를 보고, 「내 역할 메뉴만」을 켜면 그 역할이 쓰는 메뉴만 남긴다(부서별·Plane별 모드는 없앴다).
- 동작 권한은 화면에서 미리 보이고(버튼 비활성 + 이유) 서버가 다시 검사한다(`X-Actor-*` 헤더, 거부도 감사 기록).
- 검토함은 승인할 일을 모아 **내 차례인지**를 보인다 — 차단·복원은 서버와 같은 `contracts` `approvalCheck`(요청자·중복·차단 승인자 제외).

## 5. 딥링크·검색
- 상태는 URL에 둔다: `/features/FEAT-00022/1.0.0?tab=safety`, `/features?lifecycle=PROPOSED`, `/ops/kill?id=KILL-00001`.
- 상단 검색은 Feature ID를 입력하면 바로 이동하고, 이름이면 Registry 검색(`/features?q=`)으로 간다.
- ⌘K 명령: 영향 분석·변경요청·검토함·긴급 차단·사전점검·PoC와 Feature 검색.

## 6. 품질 기준 (하네스)
- 메뉴 55 + 하위 화면 전부 axe(WCAG 2.1 AA) serious/critical **0** — 화면별 허용 건수 없음.
- 1366·1536·1920에서 가로 넘침·잘림·겹침 없음(레이아웃 e2e).
- 문구는 `copy/ko.ts`에서만, 원시 색상은 토큰 파일에서만, 보고서 v1.1 용어 규칙(Evidence 등) 위반 0.

## 7. 라벨 정책 (NFR-6)
한글 라벨 + 영문 기술용어·ID(Feature, Baseline, Gate, Evidence, Kill Switch, OpenFeature). ID·코드는 영문 고정. 디자인 토큰은 [[70-30-tokens-color-type]].

## 변경 이력
| 버전 | 날짜 | 내용 |
|---|---|---|
| 0.1.0 | 2026-06-05 | 초안 (사용자 확정: 좌측 그룹 사이드바·하이브리드·KO+EN) |
| 2.1.0 | 2026-10-16 | P11 — API만 있던 기능의 화면: Flag 은퇴, 감독 기록(직무 분리·사후 검토·변경 기록·재-HARA), 데이터·규제 기록(SUMS·Data Act·보존), 운행 중 감시 지표 반영 (메뉴 55) |
| 2.0.0 | 2026-10-14 | MENU 2.0 구현 반영 — 업무 기준 8그룹·메뉴 51, 하위 화면·이전 주소 규칙, 역할 첫 진입·검토함, 접근성 하드 규칙 (P10) |
