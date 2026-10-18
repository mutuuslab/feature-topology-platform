# 프로세스 YAML 작성 가이드 (model/processes/FPW.<n>.yaml)

기준 구현: `FPW.1.yaml`(등록·판정형), `FPW.5.yaml`(검증형), `FPW.8.yaml`(이벤트·2인 승인형). 구조를 그대로 따른다.
사실 소스는 `_source/guide_rules.json`(보고서 규칙·Gate·역할 어휘)과 `_source/platform_iam.json`(/admin/iam 권한표·직무 분리·화면)이다.
작성 중에는 `python -I scripts/wf_model.py --partial`이 `OK`를 낼 때까지 고친다.

## 최상위 키

```yaml
process:
  id: FPW.8                       # common.yaml process_plan 의 id
  name: Operation, Kill & Restore # 영문명
  name_ko: 운영·긴급 차단·복원     # process_plan 의 name_ko 와 같아야 한다
  related: [FLW-KILLSWITCH]       # 선택. docs/_meta/id-registry.yaml 에 있는 ID만
  gates: [G8]                     # 이 프로세스가 판정하는 보고서 Gate(process_plan gates 와 같게)
  ref: 표준 보고서 7장 ...         # 근거 장·절 (사람이 읽는 표기)
  purpose_ko: >-                  # 목적 한두 문장
  outcomes:                       # 이 프로세스가 보장하는 결과, O1..On. 모두 활동이 다뤄야 한다
    - {id: O1, text_ko: ...}
  rules: [FFG-..., ...]           # 이 프로세스가 다루는 보고서 규칙. 각 규칙은 활동 하나 이상이 이행해야 한다
  entry_criteria: [...]           # 1-3개
  exit_criteria: [...]            # 2-4개
  work_products: [...]            # 아래
  activities: [...]               # 아래
```

## 산출물(work_products)

```yaml
    - key: WP-KILL-REQ            # 전역 유일, 대문자, WP- 접두사
      name: 긴급 차단 요청          # 한국어
      en: Kill Request
      kind: output                # output = 이 프로세스가 만든다 / input = 외부·다른 조직이 준다
      from: ...                   # input 만. 누가 주는가
      content: [...]              # 2-5개, 문서·기록에 실제로 들어가는 항목
      retained: true              # 선택. 감사·당국 제출용 보존 기록이라 후속 사용 활동이 없다
```
- output WP는 다른 활동이 입력으로 쓰거나 `retained: true`여야 한다(끊긴 산출물 금지).
- 다른 프로세스가 만든 WP는 `inputs`에서 키로만 참조하고 다시 정의하지 않는다.
- 아직 작성하지 않은 프로세스가 만들 WP는 `kind: input`, `from: <역할>(FPW.n 작성 예정)`으로 두고,
  그 프로세스를 작성할 때 output으로 옮긴다(현재: WP-COMPLIANCE-PROFILE → FPW.13, WP-SAFETY-REQ → FPW.3).

## 활동(activities)

```yaml
    - id: FPW.8-A05               # <프로세스>-Ann, 흐름 순서대로
      name: 긴급 차단 2인 승인      # 동사구, 괄호 앞 24자 이내
      trigger: ...                # 선택. 앞 활동 없이 사건으로 시작하는 활동만(예: 분기 정기 일정)
      gate_decision: G5           # 선택. 보고서 Gate 판정 활동. A는 6.1절 승인자여야 한다
      outcomes: [O2]
      rules: [FFG-PLT-005]        # 이 활동이 이행하는 규칙
      independent_of: [FPW.5-A04] # 선택. 독립 검토·독립 V&V — R이 대상 활동의 R과 달라야 한다
      raci: {R: [R-SM, R-CSM], A: R-SM, C: [R-REG], I: [R-OPS]}
      inputs: [WP-...]
      outputs: [WP-...]
      steps: [...]                # 3-6개, '~한다'로 끝나는 구체적 행동
      checks: [...]               # 1-3개, 완료를 확인할 수 있는 기준
      platform:                   # 선택. 플랫폼에서 하는 일
        actions: [approveKill]    # /admin/iam 권한표 action 이름. R[0] 역할의 IAM 역할이 허용돼야 한다
        screens: [/ops/kill]      # frontend 라우트 경로
        gates: [G5, G6]           # 판정 등록하는 플랫폼 Gate(GATE_META)
      next: [FPW.8-A06]           # 같은 프로세스 안의 다음 활동. 되돌림은 steps에 쓰고 next로 만들지 않는다
```

## RACI 규칙

- A는 정확히 1명. R=A는 허용하되 R·C·I 사이 중복과 A의 C·I 중복은 금지.
- 스윔레인은 R의 첫 역할 기준이다. 플랫폼 action은 R의 첫 역할이 실행한다고 보고 권한을 대조한다.
- 보고서 규칙의 "적용"에 역할이 있으면, 그 역할이 R 또는 A인 활동이 그 규칙을 `rules`에 넣어야 커버리지에 잡힌다.
- 직무 분리 쌍(`common.yaml sod`)
  - `role` 수준이면 앞 활동의 R과 뒤 활동의 R·A가 겹치면 안 된다.
  - `person` 수준이면 뒤 활동에 그 분리를 강제하는 플랫폼 action이 있어야 한다.

## 역할·정합성

- 역할은 `common.yaml roles`에만 정의한다. 보고서 어휘 14개와 Gate 승인 칸의 Release Manager, IAM에만 있는 역할(기준정보·상품)을 쓴다.
- `platform_roles`는 /admin/iam의 역할이다. IAM의 사람 역할은 모두 어느 조직 역할에든 매핑돼야 한다.
- 검증기가 보고서↔IAM 불일치를 자동으로 검출한다(Gate 승인자 권한, 라우트 요약의 역할 이름). 검출된 불일치마다
  `common.yaml alignment`에 결정(절차로 해소 / 플랫폼 수정 필요 / 보고서 수정 필요 / 오탐)을 남긴다.

## 텍스트 규칙

- 한국어 '~한다'체. 보고서 규칙 문장을 15어절 이상 그대로 옮기지 않는다(절차는 규칙의 실행 방법을 쓴다).
- 금지어: Digital Twin, 디지털 트윈, 트윈, twin. `FF/harness/guide/harness/terms.json` 용어 규칙을 따른다("증적" 금지 → "Evidence").
- `: `가 들어간 리스트 항목은 따옴표로 감싼다.
