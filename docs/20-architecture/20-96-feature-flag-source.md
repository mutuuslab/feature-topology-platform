---
id: ARC-FLAG-SOURCE
type: architecture
title: "Feature Flag의 Git 소스·정책·차량 회신 연결"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 0
standards: [OpenFeature]
traces:
  depends_on: [ARC-FEATURE-REFDB]
last_updated: 2026-11-05
---

# Feature Flag의 Git 소스·정책·차량 회신 연결

Feature Flag의 정체는 `flagKey`다. Feature Version의 정책에 같은 키를 사용하고, 소비 애플리케이션의 SDK 호출 위치를 Git 커밋에 묶어 가져온다. 코드 검토는 기존 외부 연계의 MR·파이프라인을 따라가며, 배포와 차량 회신은 서명 게시본 원장의 실제 기록을 사용한다.

## 화면 설계

기존 Engineering Instrument의 SUIT·JetBrains Mono, 코발트 강조색, 간격·대비 토큰을 유지한다. 첫 화면의 강조 영역은 Flag 키와 정책 상태에 집중한다. Feature 상세의 **Feature Flag** 탭은 Git 커밋 → 정책 검토 → Unleash 평가 → 차량 배포 → 차량으로부터 수신을 다섯 단계로 보여 주고 좁은 폭에서는 두 열·한 열로 접는다. 각 단계에는 담당 역할과 실제 대상 링크가 있다. 소스 파일 해시·등록자·시각은 펼쳐서 확인한다.

Unleash 평가는 정책 평가 근거이며 차량 배포나 수신 성공의 증거가 아니다. **차량 배포**는 정확한 `/deployments/:publicationId`의 서명·전달 근거로 연결한다. **차량으로부터 수신**은 기존 `GET /api/publications/:id`에서 같은 게시본·Feature Version·Flag·정책 ID/개정과 서버의 서명 검증 결과 `valid=true`를 확인한 뒤 실제 일치 회신 수와 최근 수신 시각·대상 VIN을 표시한다. 게시본 생성 시각을 수신 시각으로 대신하지 않고, 다른 게시본이나 대상 밖 VIN은 제외한다. 게시본 없음과 미수신은 그대로 안내하며 지도는 해당 Flag로 한정한다. 정책/게시본/차량 회신 이벤트가 오면 관련 조회를 다시 읽는다. 외부 CodeBeamer/JIRA의 Flag 추적도 이 세 단계를 별도로 표시한다.

정책 상태 `DEPLOYED`는 차량의 ON을 뜻하지 않는다. 실제 적용은 차량별 조건·차단·서명 검증에 따라 달라지므로, 화면은 실제 게시본의 회신 수와 상태를 표시한다. 새 정책 개정본에 이전 개정본의 회신을 붙이지 않는다. Unleash는 정책 상세에서 동기화 상태와 차량별 평가를 확인한다. 코드 소스·정책이 없으면 다음 구현 담당자의 작업을 안내한다.

최신 5단계 회귀는 Flag8·외부20·기존 연계8, 합계36개 단위 시험과 타입·문구·토큰·간격 검사를 통과했다. 무효 서명·이전 정책 개정·다른 게시본·대상 외 VIN·서명본만 있고 미수신인 경우를 포함한다. 실제 API9101과 새 canonical UI에서 6Flag를 확인해, 연결된 게시본5개의 정확한 개정·회신 수·최근 시각·VIN과 IVI 음성 Flag의 미게시/미수신 안내가 모두 일치했다. 3Feature ×7폭의 상단/하단42 geometry 점검 결함0과 Feature 화면3개의WCAG22 포함 axe 위반0도 확인했다(`C:/tmp/ff-dept/codex-external/flags-five-review.json`). 실제 Flag가 연결된 외부항목을 대상으로 WCAG22를 확대해 Git 커밋 링크/해시 펼침의24px 미달을 발견했고 한정 CSS를 보완했다. 최종 UI4 canonical에서 실제 Flag가 연결된 CodeBeamer `CB-10017` 문서/표/상세와 JIRA `FFCR-1` 보드/목록/상세, 합계6모드의 WCAG22 포함 axe를 다시 실행해 위반0·JS오류0·API쓰기0을 확인했다(`flags-five-external-final.log`, `flags-five-external-final.json`). 앞선 실패는 `flags-five-before-target.json`에 보존했다.

## Git 스캔과 가져오기

```sh
cd FF
npm run flags:scan -- --repo .. --url https://github.com/mutuuslab/feature-topology-platform --ref HEAD --path FF/examples/feature-flag-consumer --out flag-sources.json
```

스캐너는 작업 파일 대신 `git show <commit>:<path>`의 확정 바이트를 읽는다. TypeScript AST로 정적인 SDK 호출의 키·파일·줄·호출식·기본값 분류를 추출하고 파일 SHA256과 전체 커밋을 남긴다. 동적 키는 미해결 수로 표시한다. 이 분석은 SDK 호출 이름을 찾는 정적 탐색이며 모든 언어·동적 호출을 해석하는 분석기는 아니다.

구현 담당자는 정책 화면의 **Git 스캔 가져오기**에서 JSON을 등록한다. CI는 같은 JSON을 `POST /api/flag-sources`로 보낼 수 있다. 운영은 실제 OIDC 신원과 IMPLEMENTER 권한을 사용하며, 토큰·저장소 자격 증명은 JSON에 넣지 않는다. `GET /api/flag-sources`는 가져오기 이력, `GET /api/feature-flags?featureId=FEAT-00022&version=1.0.0`은 정책과 결합한 연결을 반환한다.

같은 저장소·커밋의 원문은 덮어쓰지 않는다. 재스캔 시각만 바뀐 같은 내용은 기존 기록으로 응답한다. 호출 위치·파일 해시 등 내용이 바뀌면 충돌로 거부한다. 저장소별 최신 스캔만 현재 사용처로 연결하므로, 새 커밋에서 삭제한 호출이 옛 기록 때문에 계속 연결되지 않는다.

가져온 기록은 개발자·CI의 제출 기록이다. 원격 Git 서버의 독립 검증이나 MR 승인을 증명하지 않는다. 정책 없는 키도 전체 조회에 미연결 상태로 남기며 Feature에 임의로 붙이지 않는다. GitLab은 업무 코드·MR의 기존 원천이고 GitHub는 플랫폼과 Unleash 포크의 코드 저장소다.

## 실행 예제와 검증

사용자는 업무용 Git을 가상으로 구성하도록 정했다. 실제 고객 저장소에 접속하지 않고 가상 차량 앱 코드를 플랫폼 Git에 보관한다.

`FF/examples/feature-flag-consumer/distance.ts`는 Signal·Parameter 키의 실제 호출과 OFF 기본값을 가진 실행 예제다. `infotainment.ts`는 IVI4개 키의 실제 사용처를 더해 데모6개 Flag 모두에 Git 소스를 연결한다. 소비 예제 시험은 Flag 값에 따라 기본 제어·경고·파라미터 적용이 바뀌는지 검사한다. 이 예제는 고객 차량 코드의 대체물이 아니다. 데모의 소스 연결은 실제 커밋 `624960e9b919c98ccf127f00f9c320b9383dd171`를 가리키며 **가상 차량 앱 · 예제 커밋**으로 구분한다. GitHub Verify 작업도 해당 실행의 확정 커밋을 스캔한 JSON을 산출물로 남긴다.

하네스는 작업 중인 수정·주석·문자열을 스캔 결과로 혼동하지 않는지, 잘못된 경로·자격 증명 URL·서로 다른 파일 해시·권한 없는 쓰기를 거부하는지, 같은 스캔의 재시도·호출 삭제·오래된 회신을 정확히 처리하는지 검사한다. 화면 검사는 실제 소스 링크, 가져오기 오류 시 입력 보존, 조회 오류, 읽기 역할, 좁은 폭과 시연 모드의 배치를 포함한다.

`snapshot-client.ts`는 FF가 서명한 Edge 응답을 독립 공개키로 검증한 VIN별 캐시에 SDK 호출을 연결한다. F2 이상은 독립 로컬 Guard를 통과해야 하며, TTL 만료·다른 VIN·로컬 차단·검증 오류는 OFF로 돌아간다. 소비 예제 타입 검사도 하네스에서 실행해 비동기 SDK의 await 누락을 잡는다.

## 독립 외부 도구의 상세 설계와 업무 추적 (2026-11-05)

### 목적과 참조 근거

중요 시연에서 외부 항목을 단순한 상태 카드로 보이지 않게 하고, 요구 또는 이슈를 선택한 뒤 실제 플랫폼의 Feature Version·정책·Flag·코드·차량 근거를 따라가게 한다. `external.html`은 FF 메뉴를 포함하지 않는 독립 창이며, **가상 연계 시연** 표식을 유지한다. 고객의 실제 CodeBeamer/JIRA에 로그인하거나 쓰기를 보내는 화면은 아니다.

시각 참조는 사용자 지정 REA 작업 폴더의 다음 산출물이다. 새 원격 조사로 확대하지 않았다.

| 참조 | 확인한 범위 | 적용한 구조 |
| --- | --- | --- |
| `C:/project/2026-10-15_REA/targets/codebeamer-hub/REPORT.md` v2, `docview-313104.png`, `issue-37191.png` | 인증된 **CodeBeamer Classic** 화면의 보존 캡처 두 장을 직접 열어 확인했다. CodeBeamer X 화면으로 분류하지 않는다. | 작은 제품 머리글, 얇은 제품 탭, charcoal 트래커 맥락, cyan 액션·링크, 요구 ID 그룹 탐색·선택 문서·오른쪽 세부 사항/참조/의견의 세 패널, 표와 항목 상세의 촘촘한 속성 배치 |
| `C:/project/2026-10-15_REA/LLM-Rag-Jira/prototype/DESIGN.md`, `specs/issue-detail-design.md`, `prototype/styles/tokens.css`, `out/jira/detail-clone-1440.png` | REA 재구현 프로토타입·상세 설계와 그 클론 캡처를 확인했다. `REPORT-fidelity-gaps.md`가 관찰/추론/미확인을 구분하므로 원본 Jira와의 완전한 픽셀 일치를 주장하지 않는다. | 제품·검색 머리글, 프로젝트/선택 항목 맥락, 보드·목록·항목 상세, white issue canvas, 336px 세부 사항 rail, 설명·연계 근거·의견 |

캡처의 SLEXN 회사 로고, 개인 신원, 사내 프로젝트명과 요구 본문은 복사하지 않았다. FF의 모의 원장 데이터만 표시한다. 새 색은 중앙 토큰 `--ext-cb-accent`, `--ext-cb-header`, `--ext-cb-selected`, `--ext-jira-brand`를 사용하며 외부 화면 CSS에 원시 색을 넣지 않는다. CodeBeamer 문서 탐색의 그룹은 실제 `reqId` 접두부에 따른 화면상 그룹이다. 원장에 없는 부모·자식 요구 관계나 승인 계층을 만들어 내지 않는다.

### 구성과 표시값의 출처

| 영역/값 | 실제 출처 | 해석과 빈 값 처리 |
| --- | --- | --- |
| 항목 키·종류·제목·설명·상태·개정·최종 변경자·시각·의견 | `GET /api/integrations/mock/:system/items`의 `MockItem` | 서버 값을 표시한다. `updatedBy`를 항목의 담당자나 최초 작성자로 바꾸어 부르지 않는다. |
| CodeBeamer Tracker/Release/Working-Set/Submitted by/Assigned to/Risk/Verification Method/Requirement Status | `MockItem.fields`의 실제 동명 값 또는 명시한 별칭(`submittedBy/createdBy`, `assignedTo/assignee`) | 없으면 **확인 필요**. 스크린샷의 인명·Low·기한·기본 Working-Set을 채워 넣지 않는다. |
| JIRA 프로젝트 | 실제 이슈 키의 프로젝트 접두부 | 프로젝트 표시명·설정 존재를 추정하지 않는다. |
| JIRA 담당자·보고자·기한·우선순위·팀 | `fields.assignee/assignedTo`, `reporter/submittedBy/createdBy`, `dueDate/due`, `priority`, `team` | 원장에 없으면 **확인 필요**. 외부 작업 계정 선택기는 항목 담당자 지정 기능이 아니다. |
| 외부 Feature 참조 | JIRA `fields.featureId` + `fields.version` | ID와 Version이 둘 다 올바를 때만 그 Version을 연결한다. 빠진 Version을 최신으로 보충하지 않는다. |
| 상위 Epic 참조 | JIRA `fields.parentKey`와 같은 모의 원장의 해당 Epic 필드 | 실제 상위 항목이 있을 때만 연결한다. |
| CodeBeamer 요구→Feature Version | `fields.reqId`와 `featureDetail.feature.requirementIds`의 정확 일치 | 제목·설명 유사도로 매칭하지 않는다. 같은 요구를 쓰는 모든 Version을 보존한다. |
| Feature 이름·담당 조직·범위·Lifecycle | `GET /api/features`의 실제 요약 | 담당 조직은 연결된 Feature의 담당 조직으로 명시한다. 외부 이슈의 담당자로 오인하지 않게 한다. |
| 정책·Flag·제어점·개정·Git 위치·게시본 회신 | `GET /api/feature-flags` | JIRA CR에 policyId가 있으면 그 정책만 연결한다. 같은 Feature의 다른 정책이나 미연결 소스 키를 해당 CR의 근거로 붙이지 않는다. |
| Git 파일·줄·커밋·해시·등록자·가져온 시각 | Flag 응답의 `sources[]` | 개발자/CI의 제출 스캔으로 표시한다. 원격 Git 승인·MR 승인을 증명한다고 표시하지 않는다. GitLab/GitHub의 실제 커밋 경로 형식을 구분한다. |
| GitHub PR #9 | 실제 플랫폼 저장소의 고정 PR URL | 플랫폼 통합 변경을 여는 링크라고 표시한다. 현재 항목이 그 PR에서 승인됐다고 주장하지 않는다. |
| 차량 지도 | 실제로 연결된 Flag 응답의 `flagKey` | 키가 확인될 때만 `lens=activation&flagKey=...`로 연다. 이름을 추측해 지도 링크를 만들지 않는다. |
| 차량 배포·수신 | Flag의 `publicationId`와 `GET /api/publications/:id`의 서명 검증·현재 정책 개정·실제 회신 기록 | 배포 상세 링크와 수신 수/시각/VIN을 분리한다. 정책 DEPLOYED나 Unleash 평가를 차량 ON·배포/수신 성공으로 바꾸지 않는다. 생성 시각을 수신으로 채우거나 0 분모로 비율을 계산하지 않는다. |
| 현재 URL | 브라우저의 실제 전체 URL | 선택/복사할 수 있다. 왼쪽 제품 로고는 `href="/"`, 플랫폼 복귀는 실제 연계 화면으로 같은 창에서 이동한다. |

요구 ID는 Feature 목록 요약 API에 포함되지 않는다. 백엔드 계약을 바꾸지 않고 CodeBeamer 연결 조회 때만 Feature 상세를 읽으며, 동시 요청을 네 개로 제한하고 역할·Version 목록별로 캐시한다. 창을 닫으면 요청을 중지한다. 일부 상세가 실패하면 실패 건수를 알리고, 확인된 연결 외에도 추가 연결이 있을 수 있음을 표시한다. 조회 실패를 **연결 없음**으로 숨기지 않는다. 장기적으로 원장이 커지면 전용 일괄 역참조 API가 적합하지만 이번 범위에서는 새 서버 API를 만들지 않았다.

### 업무 시나리오

1. 요구 담당자는 CodeBeamer 문서에서 실제 요구를 선택한다. 트래커 속성·본문·최종 변경자와 연결 Feature Version을 확인한다. 표 전환에서 같은 항목을 누르면 세부 속성을 더 넓게 보는 항목 상세로 이동한다.
2. 검토 담당자는 외부 작업 계정을 확인하고 의견을 등록한다. 의견은 공유 모의 원장에 저장되고 기존 서명 webhook·수신함·drain 경로를 거친다. 댓글만으로 요구 본문 개정이나 G2 재검토를 만들지 않는다.
3. 요구 상태가 실제로 바뀌면 원장의 개정과 플랫폼 추적을 다시 읽는다. 기존 플랫폼 창도 변경 알림으로 갱신한다. JIRA의 승인·전이는 기존 권한·게이트·직무 분리 가드를 거친다. 거부되면 서버가 되돌린 상태와 이유를 표시한다.
4. 구현/출시/운영 담당자는 정확히 연결된 정책·Flag에서 Git 위치와 확정 커밋을 열고, 현재 게시본의 실제 회신 수와 Flag로 한정한 차량 지도를 확인한다. Git 제출·정책 승인·차량 회신은 별도 근거다.
5. 열람 계정 또는 알 수 없는 역할로 직접 진입하면 저장을 허용하지 않는다. 정적 설치는 저장 비활성과 이유를 표시한다. 고객의 실제 URL은 데모 placeholder 호스트 치환에 포함하지 않는다.

### 구현 범위와 검증 상태

완료한 화면 원천은 `FF/frontend/src/external/ExternalApp.tsx`, `external.css`, `trace.ts`, `FF/frontend/src/copy/external-demo.ts`다. 실제 필드 속성, 정확한 역참조, URL 선택/복사, 홈 로고 이동, 문서/표/항목 전환, 오류·부분 조회 표시를 구현했다. 서버의 `POST /api/integrations/mock/:system/act`에 `COMMENT`를 추가해 공백을 제거한 1~2000자 의견만 저장하며, 빈 의견·다른 동작과 섞인 본문·알 수 없는 필드는 거부한다. 의견과 상태 변경은 공유 모의 원장·서명 webhook·기존 수신함/drain으로 이어진다. UI 재구성은 이 경로와 기존 읽기 계약을 재사용한다. 생산용 OIDC 빌드는 `DEMO_EXTRAS` 분기를 제거하며, 실서버 모드에서 모의 변경을 거부하는 기존 서버 가드도 유지한다.

현재 실행으로 프런트 타입 검사, 외부 화면 단위 시험 **28개**, 문구·색상·간격 검사를 통과했다. 키 없이 직접 진입할 때 선택 키가 공유 URL에 빠지던 결함도 추가 회귀로 확인하고 수정했다. 화면 배치·접근성·별도 창의 아래 결과는 이전 UI의 시험을 전용한 값이 아니라 이번 Classic/JIRA 재구성의 실제 재실행이다.

실제 axe 검사에서는 원본에 가까운 cyan `#009fbd` 작은 글자가 white에서 3.13:1, 선택면 `#f4ffff`에서 3.07:1로 AA를 만족하지 못했다. 참조 스타일 재현과 접근성 보완을 구분해 장식 cyan을 유지하고 글자·활성 버튼은 별도 토큰 `--ext-cb-link`로 어둡게 조정했다. JIRA 선택 뷰는 brand-on-FF-soft 대비 4.37:1 문제를 white 면과 brand 밑줄로 바꾸고, CodeBeamer 제품 탭은 이름 있는 region으로 감쌌다. 이 AA 보완은 release-3를 게시한 실제 9012에서 재검증했다. 6모드 axe 전체 규칙 위반 0, 42조합의 상단/의견 84 geometry 측정 결함 0, JS 오류 0이다(`classic-final.log`, `classic-review.json`). 1366px PNG 6장을 저장하고 실제 화면을 직접 검토했다. 같은 release-3를 QA API9153에 연결한 전용 preview9162에서 팝업/연계 E2E도 10/10 통과했다(`classic-popup-final.log`): 4역할의 실제 CodeBeamer/JIRA popup 의견 저장·webhook 수신, JIRA 거부·되돌림, GitHub PR 새 창/확정 소스 링크를 확인했다.

구현하지 않은 범위는 실제 고객 CodeBeamer/JIRA 세션·REST/.spr 호출, 원본 제품의 전체 메뉴·프로젝트 관리·첨부·하위 요구 편집·타임시트·알림·원격 승인이다. 해당 제품 탭은 시연에서 지원하는 Trackers 외에는 비활성 안내를 제공한다. 미확인 사용자·기한·위험도·검증 결과를 그럴듯하게 생성해서 채우지 않는다. CodeBeamer Classic과 X의 기능·API·디자인을 혼합하지 않는다.

## 부록: 읽기 전용 데이터 분석실

### 목적과 구성

`/data/workbench`는 여러 업무 원장을 같은 표·조건 방식으로 비교한 뒤 원본 업무로 돌아가는 분석실이다. 첨부한 스프레드시트 화면의 출처 트리·조건 요약·중앙 표·필드·조회 이력 구조를 참조했다. 임의 SQL 실행, 외부 데이터베이스 연결, 파일 편집 기능은 구현하지 않았다.

왼쪽은 출처 트리와 저장 조회, 중앙은 일반 필터 폼·읽기 전용 조건 요약·조회 출처/시각·결과 표·이력, 오른쪽은 표시 필드와 선택 행 상세다. 1450px 이하에서는 상세/필드를 표 아래로 배치하고, 1050px 이하에서는 출처도 단일 열로 내려 놓는다. 중앙 표만 내부 스크롤을 갖고, 식별자·숫자·금액·원본 링크를 선택한 행에서 확인한다. 표의 50행 페이지 이동과 원장 다음 페이지를 읽는 동작을 구분한다.

### 네 원천과 값의 의미

| 출처 | 실제 GET | 표시값과 경계 |
| --- | --- | --- |
| Feature Flag·정책 연결 | `/api/feature-flags` | Flag 키, Feature Version, 정책 ID·개정·상태·제어점, 소스 위치 수, 현재 게시본 상태·회신 수/분모. 선택 행은 실제 Feature·정책·Git·Flag 적용 차량 지도를 연다. 정책 DEPLOYED를 차량 ON으로 바꾸지 않는다. |
| Feature DB 기준 행 | `/api/refdb/refs?limit=200&offset=...` | 식별·분류·ASIL·상태·규모 근거·출처·세부기능 수만 투영한다. 기준 행에 들어 있는 벤치마크 금액은 표·상세에 넣지 않는다. 다음 200행을 실제로 읽으며 페이지별 발행본이 다르면 경고한다. |
| 차량 최근 회신 | `/api/fleet/runtime` | 등록 차량의 VIN, 적용 범위, 연결/신뢰 상태, 최근 회신 게시본·종류·결과·시각과 확인된 Flag 키. `last=null`은 미확인으로 남고 APPLIED·정상·ON으로 채우지 않는다. 가중 모델 모집단과 실제 등록 차량 수를 합하지 않는다. |
| 개발비 산정 과제 | `/api/cost/projects` | 산정 과제·이름·상태·Feature 수·총 공수·계수표·수정 시각. 금액 허용 범위에서는 계산 원화와 과제 표시 통화 설정도 구분한다. 환율이 없는 이 목록 응답을 임의 환산하지 않는다. |

`totalCost`는 원화 계산값이고 프로젝트 `currency`는 표시 통화 설정이다. 열 제목을 **총 개발비 (원)** / **과제 표시 통화**로 분리한다. 금액은 기존 산정 화면과 같이 정수 단위로 표시하고 원장의 소수 값 자체를 수정하지 않는다. USD 설정을 원화 총액의 단위로 잘못 붙이거나 환산된 결과라고 주장하지 않는다.

모든 데이터 요청은 기존 API 클라이언트의 GET이다. 서버가 준 응답과 현재 브라우저 조회 시각(KST)을 구분해 표시한다. 403·조회 오류·깨진 응답이면 이전 결과 표와 선택 상세를 숨기고 이유를 보여 준다. 초기 지연에는 공통 `AsyncView` 골격이 나타난다.

### 필터·부분 조회·원본 이동

일반 필터 폼이 정본이다. 조건 요약은 사람이 읽는 설명이며 실행 가능한 SQL이 아니다. 같은 필드에서 고른 여러 값은 OR, 여러 조건 사이는 AND로 결합한다. 포함·같음·다름·여러 값·숫자 이상/이하·비어 있음 연산과 불러온 행 전체 검색을 제공한다. 비어 있거나 무한대인 숫자 조건을 0으로 치환하지 않는다. 현재 출처에 없는 필드 조건은 경고하고, 조건을 조용히 제거해 전체 행으로 넓히지 않는다.

폼 변경과 결과 적용 시점도 구분한다. **조건으로 조회**를 누르면 현재 조건을 적용하고 원장 GET을 다시 확인한다. 필터·행 수는 현재 불러온 범위에서 계산한다. Feature DB 200/전체 행처럼 부분 조회임을 표시하고 **다음 200개 불러오기**로 범위를 늘린다. 정적 설치에서는 기존 50행 스냅샷을 사용하고 저장된 부분 조회임을 알리며 서버 페이지 추가 요청을 하지 않는다.

행 번호 버튼이나 행을 선택하면 상세의 값과 원본 Feature·정책·기준 행·차량·게시본·산정 과제·Git 링크를 확인한다. 지도 링크는 실제 확인한 Flag 키가 있을 때만 만든다. 표 정렬·필드 표시·페이지는 조회 결과를 보는 동작이며 원장 데이터를 수정하지 않는다.

### 권한과 브라우저 저장

금액은 서버 `view=FULL`과 현재 계정의 `COST_ESTIMATOR`·`COST_APPROVER`·`COST_VIEWER`·`COST_BASIS_ADMIN` 중 허용 역할을 함께 확인한다. 어느 한쪽이 허용하지 않으면 MM_ONLY로 투영하며, 응답에 잘못 섞인 금액/통화도 표·상세에 넘기지 않는다. 역할 변경 때 이전 계정의 금액을 즉시 숨기고 새 조회 키로 읽는다. 데모의 화면 이름 **조회**를 MM_ONLY의 동의어로 사용하지 않는다. 실제 보유 역할과 서버 응답이 기준이다.

저장 조회와 이력은 **이 브라우저·현재 계정** 범위다. 키는 실제 actor ID+선택 역할로 분리한다. 출처·필터·검색어·표시 필드·이름, 실행 시각·성공/실패·행 수만 저장한다. 서버 응답·원장 행·금액 결과를 저장하지 않는다. 계정 변경 뒤 늦게 끝난 이전 요청은 새 계정 이력으로 기록하지 않는다. 저장소가 막히거나 저장한 내용이 손상돼도 화면을 멈추지 않는다. 이 기능은 서버 공유 조회나 중앙 감사 이력이 아니다.

### 업무 시나리오와 검증

1. 구현 담당자는 Flag 출처에서 키와 DEPLOYED 조건을 함께 적용한다. 행을 선택해 정확한 정책 개정·Git 소스·실제 Flag 지도까지 이동한다.
2. 기준 행 검토자는 도메인/ASIL/상태 조건을 비교한다. 일부만 로드했으면 범위를 확인하고 다음 페이지를 읽은 뒤 원본 기준 행을 연다.
3. 운영 담당자는 최근 회신 결과가 비어 있는 차량을 찾는다. 회신 없음과 실패·오프라인을 구분하고 해당 VIN 원장으로 이동한다.
4. 산정 역할은 공수와 원화 금액을 비교하고 원본 산정 과제로 이동한다. 비금액 역할은 공수 범위만 확인한다. 반복 조건은 현재 브라우저에 저장하고 다시 불러온다.

2026-11-05 현재 실행 검증은 다음과 같다. 전체 플랫폼 verify·최종 배포 판정은 통합 담당의 기록과 구분한다.

| 검사 | 결과·근거 |
| --- | --- |
| 분석실 단위 시험 | `FF/frontend/src/__tests__/workbench.test.tsx` 14/14 통과. AND/OR·GET만 호출·부분 조회·원본 링크·MM_ONLY/FULL 방어·역할 변경·403 때 기존 값 제거·null 회신·로컬 저장·손상 응답·로딩·원화 정수 표시/표시 통화 분리를 포함한다. |
| 실제 업무 E2E | `FF/e2e/tests/data-workbench.spec.ts` 2/2 통과. 조건/저장 조회/정책·지도 연결과 비금액 역할/null 차량 회신을 실제 서버로 확인했다. |
| 공통 화면 하네스 | `ux.spec.ts`의 분석실 가로 넘침/500/403/지연 골격 4개와 `three-second.spec.ts`의 분석실 1개, 합계 5/5 통과. 오류 검사를 성공/빈 화면으로 대체하지 않았다. |
| 배치·접근성 | 4출처 ×1024/1280/1366/1440/1600/1920/2560px =28조합, 상단·선택 상세 56 geometry 측정 결함 0. axe 네 출처 전체 규칙 위반 0, JS 오류 0, API 쓰기 요청 0. |
| 수정 전·후 증거 | 행 번호 접근성 이름과 숫자 머리글 정렬 실패를 실제 브라우저에서 확인하고 수정했다. `C:/tmp/ff-dept/codex-external/workbench-before-aa.json`에 실패를 보존했고, `workbench-review.json`, `workbench-final.log`, `workbench-e2e-final.log`, `workbench-harness-final.log`에 최신 통과를 기록했다. 실행 산출물을 저장소에 일괄 넣지 않는다. |

**총 개발비 (원)** / **과제 표시 통화** 문구도 14개 단위 시험 뒤 최종 UI4의 실제 라이브9012에서 각각의 표 정렬 버튼으로 확인했다(`C:/tmp/ff-dept/codex-external/workbench-currency-final.log`). 타입 검사와 문구·토큰·간격 lint도 통과했다. 1024px 미만 모바일 정밀 배치와 모든 보조 엔진 검사는 이 전용 결과에 포함하지 않는다.

### 구현과 후속 제안의 구분

분석실 원천은 `FF/frontend/src/screens/data/Workbench.tsx`, `workbench-data.ts`, `workbench.css`, `FF/frontend/src/copy/workbench.ts`이며 기존 라우트 표에 `/data/workbench`만 추가한다. 새 백엔드 계약·SQL 실행기·업무 원장을 만들지 않았다.

1366px 시각 검토에서 발견한 긴 Flag 키의 중간 줄바꿈은 수정했다. Flag·Feature·정책·기준 행·VIN·게시본·산정 ID와 Version은 한 줄로 유지하고 표 내부에서 가로 스크롤한다. 실제 배포 화면에서 식별자 한 줄과 문서 가로 넘침 0을 확인했다. 선택 상세는 여전히 표 아래에 놓이며, 접을 수 있는 상세 drawer와 저장조회 폼 접기는 **제안이며 아직 구현하지 않았다**.
