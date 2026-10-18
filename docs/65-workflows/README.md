---
id: WF-INDEX
type: workflow
title: "담당자 업무 절차 / Role Workflows"
status: draft
version: 0.1.0
owner: governance
cycle: 0
traces:
  depends_on: [FLW-FEATURE-REGISTER, FLW-KILLSWITCH, FLW-RELEASE-READINESS]
last_updated: 2026-10-18
---

# 65-workflows · 담당자 업무 절차

Feature Platform의 각 담당자가 **언제, 무엇을 받아, 무엇을 하고, 무엇을 내놓는지**를 정한다.
`60-flows/`가 화면 클릭 순서라면, 여기는 조직 역할 사이의 책임(RACI)과 인계, 플랫폼 권한을 정한다.

- **보는 곳:**
  - `out/index.html`: 스윔레인, 활동, 산출물, '내 역할 보기', 담당자별 절차서, 정합성, 커버리지를 담은 단일 파일
  - `out/processes/FPW.<n>.md`: 프로세스별 문서. docs 프런트매터와 Mermaid 흐름도를 포함한다.
  - `out/roles/<R-ID>.md`: 담당자별 업무 절차서
  - `out/workflows.json`: Feature Platform이 읽는 데이터(FF `npm run workflow:sync` → `contracts/src/generated/workflows.ts`). 스윔레인 좌표 포함
- **단일 소스:** `model/common.yaml`, `model/processes/*.yaml`. `out/`은 생성물이므로 손으로 고치지 않는다.
- **사실 소스:** `_source/`. 손으로 고치지 않고 추출기로 만든다.

## 무엇에 맞추는가

| 기준 | 내용 | 추출 |
|---|---|---|
| 표준 보고서 v1.1 (FF_Safety_Guide_v2) | 규칙 181개, 역할이 지정된 규칙 62개, 역할 어휘 14개, Gate G1~G8과 승인자 | `scripts/extract_guide.py` |
| 플랫폼 인증·권한 `http://localhost:9012/admin/iam` | 역할 17개, 권한 79개(2026-10-18 스냅샷), 직무 분리 12개, 데모 계정, 화면 경로 | `scripts/extract_platform.mjs` |

**정합성 규칙** (검증기가 강제):
- IAM의 사람 역할은 모두 어느 조직 역할에 매핑된다.
- 활동에 적은 플랫폼 action은 그 활동을 수행(R)하는 역할의 IAM 권한으로 허용된다.
- 화면 경로는 실제 라우트에 있다.
- 보고서와 플랫폼이 어긋나는 곳은 자동으로 검출되며, 결정(`common.yaml alignment`) 없이는 게이트를 통과하지 못한다.

## 명령

```bash
cd docs/65-workflows
python -I scripts/extract_guide.py                 # 보고서가 바뀌었을 때
node scripts/extract_platform.mjs                  # 플랫폼(9012) 실행 중, 권한이 바뀌었을 때
python -I scripts/check.py --partial --live        # 작성 중 게이트(실행 중인 /admin/iam과 스냅샷 대조 포함)
python -I scripts/check.py --live                  # 최종 게이트 — 13개 프로세스, 규칙 62/62
```

`ALL GATES PASS`가 나와야 완료다. 작성 규칙은 [SCHEMA.md](SCHEMA.md), 진행 상태는 [PROGRESS.md](PROGRESS.md)에 있다.

## 프로세스

| ID | 프로세스 | 보고서 Gate |
|---|---|---|
| FPW.1 | Feature 등록·분류 | G1 |
| FPW.2 | HARA·변경 영향 판단 | G2 |
| FPW.3 | 안전요구 확정 | G3 |
| FPW.4 | 안전 설계·정책 설계 | G4 |
| FPW.5 | 검증·V&V | G5 |
| FPW.6 | 서명 배포 | G6 |
| FPW.7 | 출시·활성화·단계적 확대 | G7 |
| FPW.8 | 운영·긴급 차단·복원 | G8 |
| FPW.9 | 사후 검토·Flag Retirement | – |
| FPW.10~13 | 협력사, 보안·키·취약점, 운영 데이터·데이터 보호, 규정·Compliance Profile (지원) | – |
