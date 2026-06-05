# Feature Platform / Feature Topology — 설계 문서 리포지토리

현대자동차 SDV **Feature Lifecycle & 통제 관리 시스템(Feature Topology)** 의 요구사항 정의 + 상세 설계 문서 저장소.
모든 산출물은 **Markdown + YAML + Mermaid 다이어그램**으로 구조화되며, `feature_topology_0528_slide11_quality_revision.pptx`(43 slides) 분석을 기반으로 ~50 사이클에 걸쳐 작성된다.

> **핵심 명제** — Feature Topology = Feature BOM + Feature Modeling + Decision Context.
> Feature ID를 공통 Key로 요구사항·SW·ECU·API·Variant·Policy·Test·Supplier·Telemetry를 연결해
> **① 영향도 ② 검증범위 ③ 배포방식 ④ 책임범위 ⑤ 복구경로**를 사전 자동 계산하는 ASoT(Authoritative Source of Truth).
> ALM·PLM·Feature Flag를 **대체하지 않고 연결**한다.

## 폴더 구조

| 폴더 | 내용 |
|---|---|
| `00-overview/` | 비전·범위·ASoT 포지셔닝·5대 산출물·7 페르소나·표준 landscape |
| `10-requirements/` | FR-1~FR-30 (모듈 A–I) + NFR + 제약 + index |
| `20-architecture/` | C4·모듈·엔진 파이프라인·런타임 제어·보안·배포 토폴로지 |
| `30-data-model/` | 18 Entity·10 Edge·9 Relationship·Taxonomy L0~L5·BOM 11영역·ID Key |
| `40-rules-engines/` | 12 Consistency Rules·4 Decision Engines·Lifecycle·9 Gates·Baseline/ChangeSet |
| `50-screens/` | 화면 인벤토리·IA/사이드바·60개 화면 (1파일/화면) |
| `60-flows/` | E2E 사용자/시스템 플로 |
| `70-design-system/` | 디자인 원칙·네비셸·컴포넌트·토큰·KO/EN 라벨·접근성 |
| `80-integration/` | Codebeamer·PLM·Unleash·OTA·MQTT·Supplier Package·API 계약 |
| `90-diagrams/` | Mermaid 소스 (erd/class/state/sequence/flowchart/c4/journey) |
| `99-reference-data/` | FEAT-BDC-001 전체 토폴로지 (모델 검증용 worked example) |
| `_templates/` | 문서 타입별 템플릿 + frontmatter-schema.yaml |
| `_glossary/` | 용어집(KO/EN)·표준 register·약어 |
| `_meta/` | traceability-matrix·cycle-log·id-registry.yaml |

## 문서 규약

- **모든 문서**는 [_templates/frontmatter-schema.yaml](_templates/frontmatter-schema.yaml) 의 YAML 프런트매터로 시작한다.
- **추적성 ID 스킴**은 [_meta/id-registry.yaml](_meta/id-registry.yaml) 에 등록·검증된다 (orphan 금지, 양방향 무결성).
- **UI 언어**: 한글 위주 + 영문 기술용어 병기. **ID/코드**는 영문 고정.
- **다이어그램**: `90-diagrams/<type>/` 에 소스 보관, 본문에서 상대경로 include.

## 탐색 가이드

1. 처음이면 → [00-overview/00-00-vision.md](00-overview/00-00-vision.md)
2. 무엇을 만드는가 → [10-requirements/10-00-requirements-index.md](10-requirements/10-00-requirements-index.md)
3. 데이터 구조 → [30-data-model/30-00-metamodel-overview.md](30-data-model/30-00-metamodel-overview.md)
4. 화면/UX → [50-screens/50-00-screen-inventory.md](50-screens/50-00-screen-inventory.md) · [50-screens/50-IA-information-architecture.md](50-screens/50-IA-information-architecture.md)
5. 실제 예시 → [99-reference-data/99-00-bdc-overview.md](99-reference-data/99-00-bdc-overview.md)

## 진행 상태

작성 진행은 [_meta/cycle-log.md](_meta/cycle-log.md) 에서 사이클별로 추적한다.

---
출처/근거: Mutuus Lab Feature Topology 설계안 · ISO/IEC/IEEE 29148:2018 · OMG SysML 2.0 · OMG ReqIF 1.2.
