# Digital Twin Demo — Vehicle Operational Twin + Simulation Twin

Feature Platform 데모(`FF/frontend`, Vite + React 18 + TypeScript, dev port **9001**)에 **VIN 단위 Vehicle Operational Twin**과
**Simulation Twin(What-if)**을 추가한 결과 문서다.

모든 차량·Feature·Policy 데이터는 **합성(Synthetic) 데모 데이터**이며 실제 차량, 실제 VIN, 실제 OTA 채널과 연결되어 있지 않다.

---

## 1. Digital Twin의 목적

Feature Platform은 **의도(Intent)**와 **정책(Policy)**을 관리한다. Digital Twin은 **차량별 사실(Fact)**과 **실행 결과(Result)**를 관리한다.

| 질문 | 담당 |
| --- | --- |
| 이 기능은 무엇으로 구성되는가? (Feature ID, SW/HW, 의존·충돌, 적용조건) | Feature·BOM·Topology |
| 무엇을 어떤 조건으로 제공·판매하는가? (상품 ID, Entitlement, 시장·차종) | Catalog |
| 어느 차량에 어떤 상태를 요구하는가? (Target rule, Desired State, Policy Version) | Feature Policy |
| **실제 VIN 차량은 무엇을 보유하고 어떻게 반응했는가?** (As-Built, As-Deployed, Reported, Effective) | **Digital Twin** |
| **지금 이 순간 실제 활성화해도 되는가?** (차량 상태, 안전 조건, Safe Default) | Vehicle Local Guard |

핵심 명제 두 가지를 데모에서 실제로 재현한다.

> **Deployment ≠ Release** — 바이너리가 배포된 것과 기능이 릴리스(활성화 가능)된 것은 다르다.
>
> **Desired ≠ Effective** — 중앙이 ON을 요구해도 차량 로컬 조건(센서 Stale, SOC, Safe State)에 따라 차단될 수 있다.

해결하려는 문제는 "기능을 켰는데 왜 안 켜졌는지, 켰는데 왜 위험한지"를 **VIN 단위로 설명 가능하게** 만드는 것이다.

---

## 2. Feature Platform과의 책임 분리

- **Digital Twin은 제5 Plane이 아니다.** 기존 4-Plane / 6 Domain / 49 Core Component 체계를 그대로 유지하고, Twin 계층은
  기존 컴포넌트를 연결하는 **Digital Twin Adapter/Facade**로 배치했다.
- 배치 위치
  - **Control Plane**: Twin 데이터를 조회해 대상 차량(Cohort/Canary)을 계산하고 제외 사유를 산출 → `/twin/impact`
  - **Quality Plane**: Twin 기반 What-if/가상 차량 검증으로 품질 게이트 Evidence 생성 → `/twin/simulation`, `Release Readiness`의 `Twin What-if Gate`
  - **Governance + Monitoring Plane**: VIN별 Twin 상태, 불일치, Evidence, Incident 관리 → `/twin/fleet`, `/twin/vehicle/:vin`, `/twin/incident`
  - **Vehicle Plane**: 실제 상태·진단·Feature 실행 결과 전송(데모에서는 Vehicle Simulator가 대체)
- Twin은 Feature 정의를 복사하지 않는다. `Feature ID` + `Feature Version` + `Topology/Policy Version`만 참조한다(이중 원천 방지).
- **Binary OTA와 Policy-only Release를 분리**한다. One-Binary에 이미 포함된 기능은 Policy-only로 활성화하고,
  미포함 차량은 `REQUIRES_BINARY_OTA`로 분류해 별도 OTA 경로로 보낸다. What-if 결과의 `선행 조건`이 이 판정이다.

---

## 3. 전체 아키텍처

```
┌──────────────────────────────────────────────────────────────────────┐
│ UI (React)  G12 Digital Twin — 기존 6 도메인 중 '운영' 도메인 안에 배치 │
│  /twin/fleet  /twin/impact  /twin/simulation  /twin/vehicle/:vin  /twin/incident
└───────────────▲──────────────────────────────────────────────────────┘
                │ useTwin() / useTwinOptional()
┌───────────────┴──────────────────────────────────────────────────────┐
│ state/twinStore.tsx  (TwinProvider)                                  │
│  · useSyncExternalStore 로 스냅샷 구독                                │
│  · rate(0/1/5배속) · scope · targetRule · simInputs 를 localStorage   │
│  · 감사 로그는 기존 AppReducer(AUDIT)로 전달                          │
└───────────────▲──────────────────────────────────────────────────────┘
                │ DigitalTwinPort (interface)
┌───────────────┴──────────────────────────────────────────────────────┐
│ data/twin/simulator.ts  (MockTwinProvider = 데모용 Digital Twin 저장소)│
│  · Fleet/Policy 상태 저장 · Vehicle Simulator(수신→검증→평가→보고)     │
│  · Rollout/Cohort/Canary · Incident · Kill-Switch · Closed Loop 12단계 │
│  · Event Journal(최대 800건, newest-first)                            │
└───────────────▲──────────────────────────────────────────────────────┘
                │ 순수 함수 (부수효과 없음)
┌───────────────┴──────────────────────────────────────────────────────┐
│ data/twin/engine.ts                                                  │
│  evaluateEligibility · evaluateLocalGuard(GS-01..GS-10) ·            │
│  reconcile(Desired/Reported/Effective) · computeConvergence ·        │
│  runImpactAnalysis · runSimulation(What-if) · computeFleetStats      │
└──────────────────────────────────────────────────────────────────────┘
   types.ts(계약/상수)   fleet.ts(합성 30 VIN)   events.ts(저널)   port.ts(인터페이스)
```

교체 지점은 `state/twinStore.tsx` 하나다. `DigitalTwinPort` 구현만 Eclipse Ditto / AWS IoT Device Shadow / KUKSA 어댑터로
바꾸면 화면 코드는 수정 없이 실제 백엔드에 연결된다.

---

## 4. 데이터 소유권

| 데이터 | 소유(SoT) | 이 데모에서 |
| --- | --- | --- |
| Feature 정의(구성·의존·완화) | Feature Registry | 기존 `src/data/model.ts` (Twin은 ID만 참조) |
| BOM / Topology Version | BOM/Topology | 기존 화면, Twin은 `topologyVersion` 참조 |
| Entitlement | Catalog | Twin의 `FeatureInstance.entitlement` (합성) |
| Desired State / Policy Version | Feature Policy | `DEMO_POLICY`(POL-0042, seq 42), `REVOKED_POLICY`(POL-0039) |
| As-Built / As-Deployed | 제조·OTA(CCS) | 합성 30 VIN (`buildDemoFleet`) |
| Reported | Vehicle Agent | Vehicle Simulator가 생성 |
| Effective | Local Guard | `engine.evaluateLocalGuard` 순수 함수 |
| Observed / DTC | Telemetry | 합성 신호 + DTC(P0A7F-00, U0111-87) |
| Incident / Evidence / Audit | Governance | `TwinIncident` + 기존 Audit Log |

Twin은 Feature 정책을 **소유하지 않는다**. 정책 버전을 참조하고 `POLICY_VERSION_OUTDATED`로 표시할 뿐이다.

---

## 5. Desired · Reported · Effective 정의

7개 상태를 VIN별로 구분한다.

1. **As-Designed**: 설계상 요구 SW/HW/Feature 구성
2. **As-Built**: EOL에서 실제 장착·설정된 구성(HW Capability, BMS/FW 버전, UPG-VC)
3. **As-Deployed**: 현재 설치된 One-Binary 버전(`OB-2.7.0` 등)
4. **Desired**: 중앙 Policy가 요구하는 Feature 상태(`policyVersion`, `effectiveFrom`, `offlineTtl`)
5. **Reported**: Vehicle Agent가 수신·적용했다고 보고한 상태(`receivedAt`, `appliedAt`, `policyVersion`)
6. **Effective**: Local Guard 평가 후 실제 실행 가능한 상태 + `blockReason`
7. **Observed**: Telemetry·DTC·성능·안전 이벤트

수렴 판정(engine.reconcile):

| Desired | Reported | Effective | 판정 | 라벨 |
| --- | --- | --- | --- | --- |
| ON | ON | ON | CONVERGED | 정상 수렴 |
| ON | ON | BLOCKED | GUARDED | 차량 로컬 조건으로 차단 |
| ON | OFF | OFF | PENDING | 전송 대기·정책 불일치 |
| OFF | ON | ON | CRITICAL_DRIFT | 즉시 Incident (`EFFECTIVE_DRIFT_DETECTED`) |
| ON/UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | 통신·버전·Telemetry 원인 분석 필요 |

UNKNOWN은 원인과 권장 조치를 함께 표시한다(`UnknownCauseNote`).

---

## 6. 대표 시나리오 — `Battery Preconditioning Optimization v2`

- Feature: `F-BAT-PRECOND` v2.0.0, Safe Default = **OFF**
- 필요 HW: Battery Heater / 필요 SW: BMS ≥ 3.2 / 필요 신호: SOC, Battery Temperature, Charging Schedule
- 정책: `POL-0042` (seq 42), Offline TTL 24h, 시장 KR/US, 변종 `UPG-VC-04`

데모 진행 순서(화면에서 그대로 클릭):

1. `/twin/fleet` — 30 VIN 합성 Fleet에서 Feature 등록·As-Built·판정 상태 확인
2. `/twin/impact` — 시장·차종·UPG-VC·Binary 조건 입력 → 대상/제외 미리보기(제외 사유 포함)
3. `/twin/simulation` — 11개 What-if 프리셋(저온, 저 SOC, 통신 단절, Stale 신호, HW 부족, Entitlement 없음 등) 실행
4. `/twin/fleet` — `Policy 활성화`(CANARY/FLEET) → Policy-only 차량과 Binary OTA 필요 차량 분리
5. Vehicle Simulator가 수신 → Signature 검증 → Flag 평가 → Local Guard → Effective → Telemetry 보고
6. `/twin/fleet` — Converged / Pending / Blocked / Stale / Drifted / Unknown 분포 실시간 확인
7. `/twin/incident` — 장애 주입(센서 이상, Drift, 통신 두절 등 7종) → Incident 생성 + Rollout 자동 Pause
8. `/twin/incident` — 승인 2단계 Gate 통과 후 Kill-Switch 실행 → 대상 차량 `Effective=OFF` 수렴 확인
9. `/twin/incident` — 부분 복구(정상 Cohort만 재활성) → 재수렴 확인 → Incident Close
10. `/twin/vehicle/VIN-DEMO-029` — 전 과정 Timeline/Evidence/Audit 확인

---

## 7. 화면 설명

| 화면 | 경로 | 주요 기능 |
| --- | --- | --- |
| **Twin Fleet** | `/twin/fleet` | Fleet 통계(판정·건강·Eligibility 분포), Convergence 게이지, Rollout 카드(활성/일시정지/재개), 문제 VIN 표, 필터(시장/차종/UPG-VC/판정/상태/검색) |
| **Twin Impact Preview** | `/twin/impact` | Target rule 입력 → 즉시 활성화 가능 / Binary OTA 선행 / HW 부족 / Entitlement 없음 / Twin Stale 사유별 분류, 품질 게이트 3종, 승인 후 `Production Rollout 실행`(Admin) |
| **What-if Simulation** | `/twin/simulation` | 11개 프리셋 + 신호 입력(SOC, 온도, 신호 경과시간, 통신, BMS/HW, Policy 버전) → 실제 차량과 **동일한** Evaluator·Local Guard로 Effective 결과 산출, Gate Evidence 표시 |
| **Vehicle Twin 상세** | `/twin/vehicle/:vin` | As-Designed→As-Built→As-Deployed→Desired→Reported→Effective→Observed 타임라인, DRE 3단 비교, 기능 구성, 신호 그래프, DTC |
| **Closed-Loop Incident** | `/twin/incident` | 장애 주입 7종, Incident 카드(심각도/상태/영향 VIN/원인), 12단계 Closed Loop 진행표, Kill-Switch(승인 필요), 부분 복구, Close |
| **Live Visual Twin** | `/twin/live` | RFTwin 스타일 실시간 관제 화면 — `LIVE/PAUSED` 배너·sim 시각·`tick`·`evt #n`, 배속 `0×/1×/5×`+`+5s`+`⟲ 초기화`, **3D 공장 뷰**(116 m × 60 m, 기본 탭)·**3D 차량 뷰**·**Fleet 평면도** 3탭, 부품 상태 10종, Recent Events(live), KPI·Telemetry·Explanation 패널 |

기존 화면과의 연결(회귀 없이 Cross-link만 추가):

- `Fleet`(`/fleet`): Twin 집계 카드 + `Twin 상세 →` 버튼
- `Release Readiness`(`/readiness/:id`): `Twin What-if Gate` 카드(통과/경고) + Simulation/Impact 링크
- `Ops · Incident`(`/ops/incident`): Digital Twin Incident 목록 + `Twin Incident 콘솔 →`
- 좌측 네비게이션: 기존 **운영 도메인** 안에 `G12 Digital Twin` 그룹 추가, 부서별 보기에서는 `운영 P7 → Twin`, `OTA P5 → Twins`, `검증 P4 → Gate`에 노출
- `Live Visual Twin`(`/twin/live`)은 다른 Twin 화면과 **같은 Store**(`useTwin`)를 읽으므로, 여기서 Kill-Switch를 실행하면
  Fleet/Incident 화면의 수렴 상태도 함께 바뀐다(별도 화면이 아니라 같은 Twin의 시각화 뷰).

### 7.1 Live Visual Twin 상세 (`/twin/live`)

레퍼런스 UI(RFTwin: 로봇 공장 Digital Twin)의 **실시간 관제 문법**을 차량 도메인으로 옮긴 화면이다.

| 영역 | 내용 | 데이터 출처 |
| --- | --- | --- |
| 상단 바 | `LIVE/PAUSED`, sim 시각(`10:00:00Z`), `tick`, `evt #n`, 배속 `0×/1×/5×`, `+5s`, `⟲ 초기화`, `VIN` 선택, Rollout scope·수렴률, 데이터 등급 배너 | `snapshot.clock`, `snapshot.events`, `snapshot.rollout`, `snapshot.convergence` |
| **3D 차량 뷰** | 차체·배터리 팩·히터·BMS·VCU·CGW·HVAC·Guard·충전·안테나 10개 파트를 상태 색으로 표시. X-ray(차체 투명), 카메라 프리셋(외관/배터리 팩/E·E 아키텍처), 선택 파트 wireframe, 클라우드→안테나→CGW→VCU→Guard→BMS→배터리 **정책 신호 펄스**(Rollout 활성 시) | `twin.asDesigned/asBuilt/asDeployed`, `featureInstances[F-BAT-PRECOND]`, `context`(VSS 신호), `killSwitch` |
| **3D 공장 뷰** (기본 탭) | EOL · 출하 공장 전체(116 m × 60 m)를 5개 공정 셀·컨베이어·AMR·출하 야드 30대·Andon 으로 표현. 카메라 프리셋 8종/투어/라벨 LOD/선택 VIN 추적 → **§7.2** | `snapshot.clock.simTimeMs`, `snapshot.verdicts`, `snapshot.rollout`, `twin.killSwitch` |
| **Fleet 평면도** | Cohort 별 타일 30대, 색 = Reconciliation, 클릭 = VIN 선택, `KS` 배지 = Kill-Switch 적용, 활성 중 브로드캐스트 링 + 상태 변화 펄스 | `snapshot.verdicts`, `twin.killSwitch` |
| 부품 목록/상세 | 각 파트의 상태(정상·활성 / 전이 중 / Guard 차단 / 미장착 / 오프라인)와 **출처 라벨**(`As-Designed (identity)`, `As-Built (EOL 스냅샷)`, `As-Deployed (ecuSoftware)`, `Feature Instance Desired/Reported/Effective`, `Reported.guardResult`, `Vehicle Signal (VSS)`) | 동일 |
| 우측 레일 | KPI(수렴률·활성화 VIN·Drift/Unknown·미해결 Incident), 선택 VIN 카드(DRE 3단 + 상세/Incident/What-if 링크), Incident 진행 카드, Telemetry(SOC·온도·경과 TTL Sparkline), **Explanation 패널**(원인 코드·설명·권장 조치·적용 경로·conf %·인간 승인 필요), Recent Events(live), 7-state 패널 | `snapshot.stats`, `verdict.verdictReason`, `runSimulation`과 동일한 Reason Code 정의 |

- **Recent Events(live)** 는 `journal`(차량이 실제로 보낸 이벤트, `#seq`)과 `twin.auditTrail`(Twin 이력, `audit` 라벨)을
  시간 역순으로 병합해 최대 16행을 보여준다. `journal`은 세션 시작 시 비어 있으므로 시드된 이력이 함께 노출된다.
- **Fleet 스코프 이벤트 표기**: journal 의 `vehicle.context.updated`는 개별 VIN이 아니라 Fleet 브로드캐스트로
  `vin = "VIN-DEMO-* (28)"` 형태를, Kill-Switch 해제 요청은 `vin = "ALL"`을 싣는다. 피드는 이를 VIN으로 위장해
  보여주지 않고 **`전체 28대` / `전체`** 로 표기하며, 해당 행은 클릭 대상(`role="button"`)에서 제외한다
  (선택 VIN 변경은 실제 Twin VIN 행에서만 일어난다).
- **3D 미지원/실패 시 자동 강등**: `WebGL` 컨텍스트가 없거나 렌더 중 예외가 나면 오류 화면 대신 **2D SVG 개략도**로
  바뀐다(부품 선택·상태 색상·상세 패널은 동일). 3D는 `three` + `@react-three/fiber` + `@react-three/drei`를
  `React.lazy` 청크로 분리해 초기 번들에 포함하지 않는다.
- **Kill-Switch**: `kill` 권한(Admin/P7)에서 선택 VIN에 실행 → 해당 차량 `Desired/Effective = OFF`(Safe Default),
  Rollout 일시정지, 피드에 `kill-switch.requested/applied` 적재, 평면도 타일에 `KS` 배지.

### 7.2 공장 스케일 Plant Twin (`/twin/live` › `3D 공장 뷰` 탭)

RFTwin(로봇 공장) 씬 아키텍처 — 라벨 LOD, 공유 머티리얼, 카메라 프리셋 리그, 투어, FPS 미터, AMR 보간 — 를
**자동차 EOL · 출하 공장**으로 이식한 화면이다. 스케일은 로봇 공장과 동급인 **116 m × 60 m** 이며 원점은 공장 중앙,
차량은 `+X` 방향(입고 → 출하)으로 흐른다.

| 구역 | 위치 | 내용 |
| --- | --- | --- |
| `VIN REG` | x = −50 | 입고 · VIN 등록 (2 station) |
| `FLASH` | x = −34 | ECU 플래싱 · One-Binary 주입 (4 station) |
| `BATTERY` | x = −16 | 배터리 팩 장착 · 프리컨디셔닝 (4 station) |
| `CALIB` | x = +2 | ADAS · SW 캘리브레이션 (4 station) |
| `EOL TEST` | x = +20 | 최종 검사 · Andon 보드 (2 station) |
| 컨베이어 | z = 0, x = −56 → +26 | 6개 WIP 바디가 1.8 m/s 로 이송 |
| 출하 야드 | x = 40 / 46 / 52 | 30 슬롯, 색 = Reconciliation, `KS` 배지, 클릭 = VIN 선택 |
| 출하 게이트 | x = +57 | `OUTBOUND GATE` |
| 물류 | 서측 x = −56.6 / z = −16…8 | 슈퍼마켓 랙 4열, 충전 패드, CCTV 4대 |

- **셀 상태 8단계**: `RUNNING` 가동 / `IDLE` 대기 / `WAITING` 작업 대기 / `WARNING` 경고 / `BLOCKED` 정지(배포 중단) /
  `ERROR` 이상 / `SAFETY` 안전 정지(Kill-Switch) / `OFFLINE` 통신 없음. 셀 색은 `snapshot.verdicts` 를 집계한
  결과로만 정해지며(예: `FLASH` 는 Binary OTA 대상이 남아 있는데 Rollout 이 일시정지되면 `BLOCKED`),
  각 셀 카드에 한국어 사유 한 줄이 함께 표시된다.
- **station 배정**: 셀마다 `snapshot.verdicts` 에서 해당 공정 단계에 맞는 VIN 을 VIN 순으로 뽑아 station 위 차량에
  배정한다(남는 station 은 VIN 없는 WIP 차량으로 채운다). 클릭 = VIN 선택, 더블클릭 = `/twin/vehicle/:vin` 이동.
- **카메라 프리셋 8종**: 전체 조망 / VIN 등록 / 플래싱 / 배터리 / 캘리브레이션 / EOL 시험 / 출하 야드 / Andon · Control.
  셀 카드를 누르면 그 셀 프리셋으로 이동하고, 조작(드래그/휠)하면 프리셋 하이라이트가 풀린다.
- **투어**: `▶ 투어` 시 7초(`TOUR_DWELL_MS`) 체류 후 다음 프리셋으로 자동 진행 (`⏸ 투어 정지` 로 중단).
- **선택 VIN 추적**: `📍 선택 VIN 추적` 을 켜면 카메라가 선택 차량을 따라간다(프리셋보다 우선).
- **라벨 LOD**: `자동 / 전체 / 이상만 / 숨김` 4모드. `자동` 은 거리 티어(52 m / 26 m) · 화면 픽셀 크기 보정 ·
  최소 픽셀 컬링 · 화면 밖 컬링 · 겹침 회피(우선순위 cap 20)를 150 ms 스로틀 프레임에서 수행한다.
- **결정론**: 컨베이어 위치, AMR 6대의 왕복 경로, 셀 상태, 야드 색은 전부 `snapshot.clock.simTimeMs` 의 순수 함수다
  (`Math.random()` · 벽시계 미사용). 그래서 `0×`(정지)·`5×`·`+5s`·`⟲ 초기화` 가 씬에 그대로 반영되고 단위 테스트가 가능하다.
- **2D 강등**: WebGL 컨텍스트가 없거나 렌더 중 예외가 나면 `PlantSchematic2D`(의존성 없는 SVG 평면도)로 바뀐다.
  평면도에서도 셀 상태 색 · 컨베이어 WIP · AMR · 야드 30대 클릭/더블클릭이 모두 동작한다.
- **모듈 경계**: 레이아웃·상태 SoT 는 `src/scene/plantLayout.ts`(React/three 무의존 순수 모듈), 프리미티브 라이브러리는
  `src/scene/plantProps.tsx`, 씬은 `src/scene/PlantScene.tsx`, 라벨 시스템은 `src/scene/labels.tsx` 이다.
  셀 좌표·station 배치·프리셋·AMR 경로를 바꾸려면 `plantLayout.ts` 만 고치면 된다.

### 7.3 정본 IA 화면 — Feature 등록 · Feature BOM · Topology

Twin 화면과 같은 셸에서 열린다. 세 화면 모두 각 영역 하단에 **정본 영역 계약**(`src/components/SpecAreaFacts.tsx`)을 붙여,
Task · 입력/검증 · API · 역할 정책 · 인수 조건을 기준 문서 원문 그대로 노출한다.

| 화면 | 경로 | 영역 수 | 정본 |
|---|---|---|---|
| Feature 등록 (Revision 기준) | `/master/define` | 7 | Detailed Screen & API Reference v1.1 `UI02` |
| Feature BOM | `/master/bom` | 6 | v1.1 `UI04` |
| Topology와 변경 영향 | `/arch/topology` | 7 | Feature Topology Definition v0.8 · SW Detailed Design v4.6 `UI05` |

- **UI05 엔진**: 관계 사전 15종 → 그래프 → 규칙 검증 → Snapshot 동결(SHA-256) → Capability 평가 → 변경 영향 경로.
  상단은 6단계 파이프라인(단계마다 `pass`/`fail`/`blocked` 톤), 하단은 Twin 런타임 아키텍처 뷰다.
  두 뷰는 **같은 시뮬레이터 시계**를 쓴다 — `0×` 로 두면 패킷 애니메이션이 함께 멈춘다(`data-paused`).
- **관계 저장 게이트 판정 순서**: 역할 `403` → 형식 `422` → 중복 `409` → 기준선 동결 `412` → `202`.
- **정직한 실패 노출**: 현재 시드 데이터에서는 사전 외 관계형(`derives`/`uses_api`/`applies_to`/`realized_by`)과
  미해결 참조(`POLICY-BDC-PREV`), 중복 조건행이 실제로 검출되어 일부 단계가 `fail` 로 표시된다. 이는 연출이 아니라 검증 결과다.

---

## 8. Simulator 사용법

- **속도**: 화면 상단 `시간 배속` 선택 — `0×(정지)` / `1×` / `5×`. `0×`이면 Step 버튼으로 수동 진행.
- **Policy 활성화**: `/twin/fleet` → Rollout 카드에서 `CANARY`/`FLEET` 선택 후 활성화.
  - Canary는 합성 Fleet에서 소수 VIN만 대상으로 삼고, One-Binary 미포함 VIN은 `Binary OTA 대상`으로 분리한다.
- **What-if**: `/twin/simulation` → 프리셋 클릭 또는 입력 변경 → `Simulation 실행`. 동일 로직 재사용 검증이 목적이므로
  차량과 시뮬레이터의 판정 결과가 다르면 버그다.
- **장애 주입**: `/twin/incident` → 7종 중 선택(Deploy 권한 필요). 주입 즉시 Incident + Rollout Pause 발생.
- **Kill-Switch**: 동일 화면, `kill` 권한(Admin) 필요. 실행하면 대상 VIN이 `Effective=OFF`(Safe State)로 수렴한다.
- **복구**: `부분 복구` → 원인이 제거된 Cohort만 재활성, Drift/Stale은 별도 처리 후 Close.
- **Live Visual Twin**(`/twin/live`): 기본 탭인 **3D 공장 뷰**에서 `▶ 투어` / 카메라 프리셋 / `📍 선택 VIN 추적` /
  라벨 모드(`자동·전체·이상만·숨김`)로 116 m × 60 m EOL · 출하 라인을 돌아본 뒤, 셀 카드를 눌러 문제 공정으로 바로 이동한다.
  `3D 차량 뷰` 탭에서는 `▶ 재생/⏸ 정지`·배속·`+5s`로 시간을 흘려보내면서 3D 파트 색과 Event 피드를 관찰하고,
  `X-ray`로 차체를 투명하게 만들어 배터리 팩·BMS를 확인한다. `Fleet 평면도` 탭에서는 30대 타일 펄스를 본다.
  Event 피드에서 실제 VIN 행을 클릭하면 그 차량으로 전환되고, `전체 N대` 행은 Fleet 브로드캐스트이므로 선택되지 않는다.
- **상태 영속**: `시간 배속`·`scope`·`Target rule`·`Simulation 입력`은 `localStorage['fp.twin.v1']`에 저장되어
  새로고침 후에도 유지된다. Fleet Twin/Incident 상태 자체는 **휘발(mock)** 이며 새로고침 시 시드 상태로 재구성된다(§12 참조).

---

## 9. API와 Event

데모에서는 네트워크가 아닌 in-process Port로 동일 계약을 구현했다(`src/data/twin/port.ts`).

**Port (DigitalTwinPort)** — 실제 백엔드로 교체할 때 구현할 메서드:

| 메서드 | 역할 |
| --- | --- |
| `getSnapshot()` / `subscribe(fn)` | Twin 스냅샷 조회·구독(불변 스냅샷, 캐시 무효화 기반) |
| `setRate(r)` / `tick(ms)` | Simulator 시간 진행 |
| `activatePolicy(scope, rule, actor)` | Desired State 배포 |
| `pauseRollout(reason, actor)` / `resumeRollout(actor)` | Rollout 중단·재개 |
| `killSwitch(featureId, reason, actor)` / `releaseKillSwitch(actor)` | 안전 정지·해제 |
| `injectFault(faultId, actor)` | 장애 주입 |
| `advanceClosedLoop()` / `recoverCohort(scope, actor)` / `closeIncident(id, actor)` | Closed Loop 진행·부분 복구·종료 |
| `setGate(gate, ok, actor)` | 품질 게이트 승인 |
| `replace(vins)` | Twin 저장소 교체(테스트/초기화) |

**Event** — 모든 상태 변화는 `TwinEvent`로 저널에 적재되고, 저널은 최신순(`newest-first`)으로 노출된다.
`ingest`는 중복 이벤트 ID를 거부하며 최대 800건을 보존한다. 이벤트 종류: `policy.activated`, `rollout.paused`,
`rollout.resumed`, `vehicle.received`, `vehicle.verified`, `flag.evaluated`, `guard.blocked`, `effective.changed`,
`telemetry.observed`, `fault.injected`, `killswitch.engaged`, `killswitch.released`, `incident.opened`,
`incident.closed`, `cohort.recovered`.

실제 연계 시 매핑: Eclipse Ditto `things/{thingId}/features/{featureId}/desired` ↔ `Desired`,
`.../reported` ↔ `Reported`, Thing 상태 이벤트 → 위 Event 종류로 변환.

---

## 10. Safety · Security 고려사항

- **Safe Default**: 모든 Feature는 `OFF`를 기본값으로 두고, 통신 두절/정책 만료 시 `SAFE_DEFAULT_APPLIED`로 복귀한다.
- **Local Guard 우선**: 중앙 요청이 있어도 차량 로컬 안전 조건(GS-01..GS-10: SOC, 배터리 온도 신호 신선도,
  Power Mode, 주행 상태 등)을 통과하지 못하면 `BLOCKED` 처리한다. `Effective`는 항상 Guard 결과다.
- **Offline TTL**: `DEMO_POLICY.offlineTtl = 86400s`. 만료된 캐시 정책은 적용하지 않는다(`OFFLINE_POLICY_CACHE_VALID` vs `SAFE_DEFAULT_APPLIED`).
- **정책 무결성**: Vehicle Simulator가 `Signature Verified` 이벤트를 남긴다. 서명 검증 실패는 수신 단계에서 거부된다(데모는 시뮬레이션).
- **정책 버전 역전 방지**: 이전 정책(`POL-0039`, seq 39) 수신 시 `POLICY_VERSION_OUTDATED`로 거부한다.
- **Kill-Switch는 승인 2단계**: `kill` 권한 + 승인 게이트 통과가 필요하며 모든 실행이 Audit Log에 기록된다.
- **최소 권한**: 조회는 전 역할 허용, 활성화/장애 주입은 `deploy`, Kill-Switch는 `kill`, 게이트 승인은 `approve` 권한 필요.
- **합성 데이터 고지**: 화면 배너(`ClassificationBanner`)에 데모용 합성 데이터임을 상시 표시한다.
- **PII 없음**: VIN은 `VIN-DEMO-###` 형식의 합성 값이며 실제 차량을 식별할 수 없다.

---

## 11. 실제 시스템 연계 방향

| 단계 | 내용 |
| --- | --- |
| 1단계(현재) | JSON Twin Store + 가상 VIN + in-process Vehicle Simulator (합성·결정론적) |
| 2단계 PoC | `DigitalTwinPort` 구현을 **Eclipse Ditto** 어댑터로 교체(Ditto Thing = Twin), **COVESA VSS** + **Eclipse KUKSA**로 차량 신호 정규화(SOC/온도/충전 스케줄을 VSS 경로로 조회·구독) |
| 3단계 고도화 | vECU/Plant Model을 **FMI 3.0 FMU**로 패키징하여 Co-Simulation. 동일 `engine.ts` 판정 로직을 FMU와 교차 검증 |

교체 순서: `port.ts` 구현 추가 → `twinStore.tsx`의 provider 주입만 변경 → 화면/엔진/테스트는 그대로 재사용.

---

## 12. 알려진 제한사항

- **Mock 수준**: Fleet/차량/신호는 모두 합성이며 확률적 노이즈가 아닌 결정론적 시드로 생성된다(데모 재현성 우선).
- **영속 범위**: `시간 배속`·`scope`·`targetRule`·`simInputs`만 `localStorage`에 저장된다. Twin/Incident/Rollout 상태는
  새로고침 시 초기 시드로 재구성된다(실제 시스템에서는 Twin Store가 SoT이므로 이 제약이 사라진다).
- **실제 연계 없음**: CCS(OTA) 채널, 실제 Binary Repository, 차량 Agent, PKI/서명 검증 서버와 연결되어 있지 않다.
  서명 검증·OTA 설치·재시동은 이벤트로만 표현된다.
- **신호 연계 없음**: VSS/KUKSA 표준 경로가 아니라 내부 `SignalKey`를 사용한다.
- **Simulation Twin 범위**: 검증 대상은 Feature Policy + Local Guard 조합이며, 물리 모델(배터리 열모델 등)은 포함하지 않는다.
- **품질 게이트**: 데모 데이터에서는 FAIL이 발생하지 않고 PASS/WARN만 나온다(Advisory Gate).
- **다국어**: Twin 화면 라벨은 한국어 중심이며 일부 영문 토큰(Reason Code, HW Capability)을 병기한다.
- **접근성**: 주요 컨트롤에 `aria-label`/`role`을 부여했으나 전문 스크린리더 감사(audit)는 수행하지 않았다.
- **3D 표현 한계**: Live Visual Twin의 차량은 실제 CAD/GLTF가 아니라 **Box/Cylinder 프리미티브 조합**이다. 파트 위치·형상은
  설명 목적이며 실차 치수가 아니다. 파트-ECU 매핑도 `Feature Topology`의 정의를 참조하는 수준으로 단순화했다.
- **3D 스크린샷**: 헤드리스 브라우저(Playwright)에서는 WebGL 백엔드에 따라 캔버스가 검게 나올 수 있다. 이 경우에도 화면은
  2D 개략도로 강등되어 기능 검증에는 영향이 없다.
- **공장 뷰 표현 한계**: §7.2 의 공장은 실제 EOL 라인의 CAD/BIM 이 아니라 프리미티브 조합이다. 셀 간격·컨베이어 길이·
  야드 배치는 설명 목적의 값이며, station 대수와 셀 순서만 공정 흐름을 따른다. 실제 라인 데이터(라인 밸런싱, 택트,
  설비 상태)와는 연결되어 있지 않다.
- **공장 뷰와 Twin 상태의 관계**: 셀 상태(`RUNNING`/`BLOCKED`/`SAFETY` 등)는 PLC/설비 신호가 아니라 **Fleet 판정
  (Eligibility · Reconciliation · Rollout · Kill-Switch)** 을 공정 단계별로 집계한 파생값이다. 즉 "라인이 멈췄다"가 아니라
  "이 단계에 할 일이 남아 있는데 배포가 멈춰 있다"를 뜻한다. 실제 시스템에서는 라인 컨트롤러 신호를 별도 소스로 병합해야 한다.
- **공장 뷰 성능**: 라벨은 `THREE.CanvasTexture` 캐시 + 150 ms 스로틀 LOD 로 관리하고 그림자·후처리는 쓰지 않는다.
  동시 표시 라벨 수는 모드별 상한(우선순위 기준)으로 제한되므로, 라벨을 전부 켠 상태에서도 프레임당 비용이 급증하지 않는다.
- **Live 피드 혼합**: `Recent Events`는 세션 `journal`(실제 이벤트)과 시드된 `auditTrail`(Twin 이력)을 라벨로 구분해 섞어 보여준다.
  실제 시스템에서는 `auditTrail`도 이벤트 스트림에서 생성되므로 두 라벨이 하나로 합쳐진다. 한편 Fleet 브로드캐스트 이벤트는
  여전히 단일 행(`전체 N대`)으로 표시되므로, 실제 시스템에서는 VIN별 팬아웃 이벤트로 분해해 보여주는 편이 낫다.

---

## 13. 실행 방법

```powershell
cd c:\project\2026-06-04_Feature_Platform\FF\frontend
npm install          # 최초 1회
npm run dev          # http://localhost:9001
```

- 테스트: `npm test` (vitest, 15 files — `twinPlant.test.tsx` 가 §7.2 공장 뷰, `twinUi.test.tsx` 가 라우팅 통합을 담당)
- 빌드: `npm run build` (`tsc -b && vite build`)
- 화면 확인 시 역할을 **Admin**으로 두어야 활성화/Kill-Switch/승인이 가능하다(기본 역할 `기획 P1`은 조회만 가능).

---

## 14. 성능 — 렌더 경계 설계 (Twin Fleet 진입 버벅거림 대응)

### 14.1 문제

`Twin Fleet` 메뉴를 누르면 화면이 눈에 띄게 버벅였다. 원인은 연산량이 아니라 **리렌더 범위**였다.

| 증상 | 실제 원인 |
|---|---|
| Fleet 진입 시 앱 전체가 다시 그려짐 | `store.tsx` 의 `LIVE_TICK`(2초)이 `state` 를 새로 만들고, 단일 `AppCtx` value 가 매번 재생성되어 **앱 전역 구독자 전부**가 리렌더 |
| Twin 데이터가 바뀌지 않아도 하위 카드가 리렌더 | `twinStore` 구독이 **스냅샷 전체** 단위 → 선택자(selector) 단위 분리 없음 |
| KPI 숫자 애니메이션이 프레임마다 커밋 | `charts.tsx` 의 `CountUp` 이 rAF 프레임마다 `setState` (8개 카드 기준 초당 ~400 커밋) |
| 표 행이 매 tick 새로 그려짐 | `simulator.ts:687` `reevaluate()` 가 매 tick verdict 객체를 새로 생성 → 행 단위 `memo` 가 절대 bail-out 못 함 |
| 화면 밖 카드도 레이아웃 계산 | Fleet 하단 대형 카드(문제 차량 목록 / VIN별 상태)가 뷰포트 밖에서도 렌더 비용 지불 |

측정으로 확인한 사실: 엔진 자체는 병목이 아니다. `createTwinProvider()` 13.4ms(앱 루트에서 1회),
`tick(1000)` p50 0.59ms · p95 1.48ms(30대), `getSnapshot()` 0.25ms. 반면 Worker 로 넘길 payload 의 `structuredClone` 비용은
**4.96ms**(tick 의 약 8배)이고, Worker 는 DOM/Style/Layout 을 옮길 수 없다. 따라서 **이 규모에서는 Web Worker 가 이득이 아니다**
(수천 대 규모나 물리 연산이 들어갈 때만 유효 — §14.4 참조).

### 14.2 적용한 구조 (대안 A — 렌더 경계 재설계)

1. **앱 컨텍스트 2분할** (`store.tsx`): `AppShellCtx`(role·navMode·lang·theme) + `AppApiCtx`(dispatch·can).
   `can` 은 `[state.role]` 로 메모이즈, `shell` 은 4개 원시값으로 메모이즈. → 2초 tick 마다 Routes 요소 트리가 재생성되지 않는다.
2. **`useT()` 를 shell 컨텍스트로 이동** (`i18n.ts`): 번역 훅이 LIVE_TICK 에 반응하지 않는다.
3. **twin api 슬라이스 분리** (`state/twinStore.tsx`): `api`(rate·step·scope·simInputs·커맨드 등)를 **tick 에 의존하지 않는**
   `useMemo` 로 고정하고, 스냅샷은 별도 컨텍스트로 분리.
4. **선택자 훅 `useTwinSel(select, isEqual)`**: `useSyncExternalStore` 기반. 비교자는 `twinShallowEqual` /
   `twinArrayEqual`(매 tick 새 배열이 오는 투영용) / `twinDeepEqual`(깊이 3 컷오프). `select`·`isEqual` 은 ref 로 고정하므로
   인라인 화살표 함수를 그대로 써도 되고, 마지막 값 cache 로 `getSnapshot` 안정성을 보장한다.
5. **Fleet 페이지 분해** (`pages/twin.tsx`): 제목·부제·KPI·수렴 카드·도넛·사유 바·웨이브 표·이벤트 타임라인·롤아웃 컨트롤·
   필터 블록을 컴포넌트 경계로 분리하고 각자 필요한 슬라이스만 구독. 필터 상태는 `FleetFilterBlock` 이 소유한다.
6. **행 단위 memo** (`components/twin.tsx`): `simulator` 특성상 verdict 객체 동일성이 매 tick 바뀌므로
   `twinVinSignature()`(화면에 실제로 그리는 15개 필드 문자열) 로 비교한다. 다국어 대응을 위해 `lang` 을 prop 으로 넘겨 비교자에 포함.
7. **`CountUp` DOM 직접 쓰기** (`components/charts.tsx`): rAF 루프에서 `el.textContent` 만 갱신, 첫 페인트 전 `useLayoutEffect` 로 "0" 고정. per-frame `setState` 제거.
8. **오프스크린 카드 렌더 유예** (`styles.css`): `.cv-auto`(≈760px 추정) / `.cv-auto-tall`(≈2600px 추정) 로
   `content-visibility:auto` + `contain-intrinsic-size:auto`. `auto` 키워드가 첫 렌더 후 실측 높이를 기억하므로 스크롤 점프는 추정 오차(~6%)에 그친다.
   (레이아웃 스크롤 컨테이너는 `main.main` 이다. jsdom 은 `content-visibility` 를 무시하므로 단위 테스트에는 영향이 없다.)

### 14.3 측정 결과 (1366×768, Vite dev, swiftshader, 3초 관측)

| 이동 경로 | 대상 표시 (before → after) | Script (b → a) | Layout (b → a) | 50ms+ long task (b → a) |
|---|---|---|---|---|
| `/twin/impact` → Twin Fleet (Fleet 마운트) | 412 → **391 ms** | 264 → **219 ms** | 214 → **165 ms** | 223 ms 1건 → **0건** |
| `/twin/live`(3D) → Twin Fleet (**사용자가 겪은 경로**) | 739 → **505 ms** | 1170 → **852 ms** | 203 → **133 ms** | 2건(221·750) → 3건(97·122·568) |
| `/twin/live` → `/twin/impact` (3D 해제만) | 397 → 387 ms | 960 → 979 ms | 55 → 57 ms | 696 ms 1건 → 2건(75·730) |
| `/twin/impact` → `/twin/live` (3D 마운트만) | 1275 → 1404 ms | 1566 → 1611 ms | 133 → 149 ms | 4건 → 5건 |

**해석(과장 없이)**: 이득은 대안 A 가 다루는 구간에 집중된다 — Fleet 마운트 비용(Script·Layout)과 첫 경로의 long task 제거.
케이스 3·4 는 코드 경로가 그대로이며 **3D 씬 dispose / WebGL 컨텍스트 마운트**가 지배한다(700ms 내외 단일 long task).
케이스 2 는 실행 편차가 커서(3회 반복 시 long task 363 / 555 / 582ms) **방향과 크기만** 신뢰해야 한다.
swiftshader 소프트웨어 렌더링 측정이므로 실 GPU 에서는 절대값이 작아지지만 순서(dispose ≫ Fleet 마운트)는 유지된다.

### 14.4 남은 과제 (대안 A+)

- **3D 상주 호스트**: R3F 언마운트가 씬 dispose + WebGL teardown 을 유발해 537~730ms long task 를 만든다.
  `/twin/live` 를 별도 라우트로 두지 않고 **상주 호스트 + `frameloop="never"`**(화면 밖일 때 정지)로 바꾸면 이 비용이 사라진다.
- **Worker + delta 프로토콜(대안 B)**: twin 이 수천 대이거나 물리 모델(FMU)이 들어갈 때. 지금 도입하면 clone 비용이 이득을 상쇄한다.
- **시간축 분리 원칙**: 데이터는 1초 commit, 시각은 단일 rAF/CSS 보간. (Fleet 애니메이션은 이미 이 원칙을 따르고, `CountUp` 이 그 예시다.)

### 14.5 테스트 게이트

- Twin UI 스모크(`src/__tests__/twinUi.test.tsx`)에 **Fleet → VIN 상세 이동** 통합 테스트가 있다.
  두 페이지 모두 lazy 라우트이므로 청크 로드 + Suspense 재시도 + 무거운 페이지 마운트가 겹치면 기본 1000ms 를 넘길 수 있어
  해당 단언에만 여유 timeout 을 준다(검증 대상은 '이동'이지 '지연'이 아니다).
- 회귀 확인: `npm test` 로 전체 스위트, `npx tsc --noEmit` 로 타입. 라이브 확인은 `probe-f.mjs`(20개 항목 생존 확인).

---

## 15. 공유 · 배포 — 공개 URL 과 링크 한정 정책

| 용도 | 주소 |
|---|---|
| 앱 (권장 공유 주소) | `https://feature-topology.pages.dev` |
| 앱 — GitHub Pages 미러 | `https://mutuuslab.github.io/feature-topology-platform/` |
| 독립 Digital Twin 콘솔 | `https://feature-topology.pages.dev/twin` |
| 소스 저장소 | `https://github.com/mutuuslab/feature-topology-platform` |

- **배포 경로**: `main` push → Actions `cloudflare.yml` → Cloudflare Pages 프로젝트 `feature-topology`.
  GitHub Pages(`pages.yml`)는 수동 실행 전용이며 동일 산출물을 `GITHUB_PAGES=1` base 로 다시 빌드한다.
- **딥링크**: Cloudflare Pages 는 `public/_redirects`(`/*  /index.html  200`)로 SPA fallback 을 처리해
  `/twin/fleet` 같은 하위 경로가 그대로 열린다. GitHub Pages 미러는 `dist/404.html` 로 대체되므로 하위 경로는 404 상태코드로 응답하되 화면은 뜬다.
- **링크 한정(주소를 아는 사람만)**: `public/robots.txt`(`Disallow: /`), `public/_headers`(`X-Robots-Tag: noindex, nofollow`),
  두 HTML 엔트리의 `<meta name="robots" content="noindex, nofollow">` 로 검색엔진 수집을 차단한다.
  (GitHub Pages 는 `_headers` 를 지원하지 않아 meta 태그가 그 역할을 대신한다.)
  로그인·비밀번호 게이트가 아니므로 **주소를 아는 사람은 누구나 열람**할 수 있다는 점을 전제로 공유한다.
- **진짜 접근 제어가 필요하면**: Cloudflare Zero Trust(Access) 정책으로 이메일 OTP 를 요구해야 한다. 현재는 미적용.
- 방문자 기본 역할은 `기획 P1`(읽기 전용). 배포·Kill-Switch·승인 시연은 좌상단 역할 스위치를 **Admin** 으로 바꾼 뒤 진행한다.

---

## 16. 참고 — 외부 표준

- AWS IoT Device Shadow: Desired/Reported/Delta 문서 구조의 표준 사례
- Eclipse Ditto: Digital Twin 상태 저장소(Thing/Feature/desired/reported)
- COVESA VSS / Eclipse KUKSA: 차량 신호 정규화와 Target Value 처리
- FMI 3.0: vECU FMU 패키징과 Co-Simulation

---

## 17. 차량 Twin 3D 렌더 품질 — Option A (절차적 스튜디오 환경)

### 17.1 문제

`/twin/vehicle/<VIN>` 의 차량이 "둥근 상자 두 개"로 보였다. 원인은 **형상이 아니라 재질과 조명**이다.

1. **환경맵 부재** — `MeshStandardMaterial(metalness 0.55)` 은 반사할 대상이 없으면 거의 검게 렌더된다. 이것이 주 원인이다.
2. **광원 2개 + 그림자 없음** — ambient 0.55 · directional 0.95 뿐이라 차체가 바닥에서 떠 보였다.
3. **유리가 보이지 않음** — 불투명 캐빈 박스가 유리 박스를 완전히 포함해 창이 아예 그려지지 않았다.
4. **바퀴 = 실린더 + 납작한 상자 5개** — 타이어 단면 · 스포크 · 제동 질량이 없었다.

### 17.2 적용한 구조

- **재질**: 페인트 · 유리 · 림을 `MeshPhysicalMaterial`(clearcoat / envMapIntensity) 로 승격. 유리는 불투명도 0.62 로 낮추고 반사를 우선했다.
- **환경**: `drei` `<Environment>` 안에 `<Lightformer>` 5장(천장 스트립 · 좌우 소프트박스 · 후면 림 · 바닥)을 넣어 **절차적으로** 환경맵을 만든다.
  네트워크 HDR 자산을 받지 않으므로 오프라인 · 사내망에서도 동일하게 렌더된다.
- **접지**: 키 라이트 `castShadow` + `<ContactShadows>` + `ACESFilmicToneMapping`(exposure 1.05).
- **형상**: 그린하우스(유리) + 루프 패널 + A/B/C 필러 + 후드 · 테일게이트 · 사이드 실 · 범퍼 · 휠 아치(토러스),
  휠은 토러스 타이어 + 림 배럴 + 5-스포크 + 허브 + 브레이크 디스크 · 캘리퍼.
- **불변 조건**: 모든 모션은 여전히 `clock.rate` / `clock.simTick` 파생값뿐이다. `rate 0` → 부품 펄스 · 흐름 패킷 · 카메라 투어 정지.
- **테스트**: drei 를 통째로 스텁하는 테스트는 새로 쓴 export(`Environment` / `Lightformer` / `ContactShadows`)까지 스텁해야 한다.
  빠지면 vitest 가 "No export is defined on the mock" 으로 실패한다.

### 17.3 측정 (1366×768, swiftshader, 동일 카메라 프리셋, 캔버스 픽셀만)

| 지표 | 이전 | 이후 | 배수 |
|---|---|---|---|
| 평균 휘도 | 9.46 | 18.97 | ×2.0 |
| 중앙값(차체 면) | 3 | 13 | ×4.3 |
| p90 | 14 | 40 | ×2.9 |
| p99(하이라이트) | 97 | 127 | ×1.3 |
| 휘도 > 40 픽셀 비율 | 2.2 % | 10.0 % | ×4.5 |

배경 픽셀(휘도 < 6) 비율은 0.6 % 로 양쪽 동일하다 — 배경이 아니라 **차체 구간만** 밝아졌다는 뜻이고, 반사 성분이 실제로 더해졌다는 증거다.
