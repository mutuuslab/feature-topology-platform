---
id: WF-REFERENCE-ANALYSIS
type: workflow
title: "업무 레퍼런스 모델 현황·벤치마크 분석"
status: draft
version: 0.1.0
owner: governance
cycle: 0
traces:
  depends_on: [WF-INDEX]
last_updated: 2026-11-08
---

# 업무 레퍼런스 모델 — 1차 분석 체크포인트

기준은 현재 `http://127.0.0.1:9480/procedures`와 e47f8c09의 절차 원천이다. 격리 작업은 `harness/procedures-20261108`, 신규 검토 포트는 9481이다. 이 문서는 **전수 구조 인벤토리와 대표 화면/문서 형식 검토**이며, 97개 활동의 상세 업무 정의까지 모두 검토·개선 완료했다는 판정이 아니다.

## 확인한 현재 내용

- YAML 14프로세스, 97활동, 59성과, 93산출물 정의, 14부서, 25조직역할, 13데모 담당자다. 59성과에는 모두 활동 연결이 있지만 이는 링크 존재의 확인이며 업무 적정성·달성 증거의 확인과 다르다.
- MENU 2.0의 8그룹에서 104화면을 추출했고, 활동에는 고유 65화면이 연결된다. 39화면은 직접 연결되지 않았다. 대시보드·절차 허브 같은 보조 화면과 원가·IAM·연계 등 실제 업무 공백 후보를 구분해 검토해야 한다. 필드/버튼 수준 연결은 97활동 중 6개다.
- 구매/원가의 R-CE·R-CA·R-CV·R-CBA와 시스템관리 R-SYS는 역할 카탈로그에 있지만 프로세스 활동에서 쓰이지 않는다. IT인프라·보안운영팀은 수행 1개/책임 0개, 개인정보보호팀은 수행·책임 각1개이므로 부서 명단이 있다는 이유로 부서 전체 업무가 정의됐다고 볼 수 없다.
- 9480에서 허브/전체 지도/FPW.1 상세가 실제 HTTP200, pageerror0이고 390px 본문 가로 넘침은 없었다. 현재 화면은 내 업무 흐름·담당자별 흐름·전체 지도·내 목록과 활동/산출물 카드 중심이며, 명시적인 BP 정의와 성과 대응 행렬은 없다.

## 지정 PDF 포맷과 우리 모델의 대응

사용자 지정 `Automotive-SPICE-PAM-v40.pdf`는 153쪽, 2,049,002bytes, SHA256 `d254c8f4c84c6bcc6d644f28472db1475d31b9b42ad0f93f7374c39759543819`다. 표지는 4.0 / 2023-11-29 / Released이며 SYS.2 p36~37, MAN.3 p89~91, SUP.1 p79~80의 본문·표를 직접 추출하고 대표 페이지를 렌더해 확인했다. 공식 VDA QMC도 해당 4.0 판을 제공한다. 공식 사이트의 후속 4.1 존재와 관계없이 이번 벤치마크는 사용자가 지정한 4.0 포맷으로 고정한다.

| 지정 PDF의 구조 | 우리 업무 모델의 원천/확장 방향 |
| --- | --- |
| Process ID / Name / Purpose | 기존 FPW ID·한/영 이름·purpose_ko 유지, 업무 경계와 달성 목적 보강 |
| 번호가 있는 Process Outcomes | 기존 O1..On 유지, 확인 가능한 성과와 근거를 구체화 |
| ProcessID.BPn + 이름·정의 | 별도의 BP 정의·식별자를 추가하고 기존 활동 ID와 연결. 기존 실행 이력 ID는 바꾸지 않음 |
| BP에 붙은 Note·타 프로세스 참조 | 업무 예/주의/외부 수행/관련 절차를 구분한 Note. Note로 권한·승인 기준을 새로 만들지 않음 |
| Output Information Items × Outcomes | 기존 WP ID·내용을 보존하며 산출물별 성과 근거를 명시적으로 연결 |
| Base Practices × Outcomes 행렬 | BP별 성과 커버리지와 검토 가능한 증거를 제시. 링크 존재를 달성/승인 완료로 표시하지 않음 |
| 프로세스 간 참고·정보 연계 | 우리 모델의 입력·출력, RACI, 진입/완료 기준, 인계·next를 함께 제시 |

4.0은 **Output Information Items**와 BP를 성과에 대응시키며, 고정 입력 문서·활동 순서를 그대로 강제하는 형식은 아니다. 우리 모델의 입력/출력 WP·책임·수행 순서는 현재 업무 원천에 맞춘 확장이다. 표준의 BP 본문·로고를 복제하거나 ASPICE 적합/능력수준 승인을 주장하지 않는다. 공식 원문 링크: [VDA QMC 4.0](https://vda-qmc.de/wp-content/uploads/2023/12/Automotive-SPICE-PAM-v40.pdf), [공식 출판 목록](https://vda-qmc.de/en/automotive-spice/automotive-spice-veroeffentlichungen/).

## 원천·데이터 계약 판단

단일 원천은 `model/common.yaml`과 `model/processes/*.yaml`이다. `check.py`/`wf_model.py`와 `build_json.py`가 `out/workflows.json`을 만들고, `FF/tools/workflow-sync.ts`가 contracts의 workflows/workflow-map/departments 및 backend workflow-index를 만든다. UI는 `data/workflows.ts`로 지연 로딩한다. 생성물을 직접 고치거나 별도 중복 업무 카탈로그를 만들지 않는다.

추가 계약 후보는 `base_practices[{id,name,definition,notes,outcomes,activity_ids}]`, 산출물별 명시적인 `outcomes`, 관련 프로세스/입출력 인계 정보다. 활동↔BP↔성과↔산출물, 부서↔조직역할↔RACI↔플랫폼 화면을 검증한다. 기존 FPW/활동/WP ID, 역할·API 권한, Gate 승인 기준과 진행 기록을 보존한다. 사전 확정한 BP나 업무 정의의 존재와 실제 수행 완료/정식 승인 상태는 분리한다.

다음은 14부서별 실제 업무와 39화면 후보를 의미 검토해 기존 절차 보강/신규 지원 절차/단순 조회 화면을 결정하고, 요구·설계와 원문 BP를 작성하는 단계다. 이후 원천 생성·추적성/권한 회귀·1366/390 화면 검증을 거쳐 9481 후보를 제공한다. 기존9480/RC9475는 변경하지 않는다.

증빙: workspace `out/resume-20261107/procedure-model-inventory.json`, `procedure-reference-pdf-inspection.json`, `procedure-current-ui.json` 및 `procedure-current-*.png`. 로컬 원본 경로는 감사용으로만 유지하며 게시용 UI가 사용자 PC의 PDF/파일 경로에 의존하게 만들지 않는다.
