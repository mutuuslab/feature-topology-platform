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

기존 Engineering Instrument의 SUIT·JetBrains Mono, 코발트 강조색, 간격·대비 토큰을 유지한다. 첫 화면의 강조 영역은 Flag 키와 정책 상태에 집중한다. Feature 상세의 **Feature Flag** 탭은 Git 커밋 → 정책 검토 → Unleash 평가 → 차량 회신을 가로 순서로 보여 주고 좁은 폭에서는 두 열·한 열로 접는다. 각 단계에는 담당 역할과 실제 대상 링크가 있다. 소스 파일 해시·등록자·시각은 펼쳐서 확인한다.

정책 상태 `DEPLOYED`는 차량의 ON을 뜻하지 않는다. 실제 적용은 차량별 조건·차단·서명 검증에 따라 달라지므로, 화면은 실제 게시본의 회신 수와 상태를 표시한다. 새 정책 개정본에 이전 개정본의 회신을 붙이지 않는다. Unleash는 정책 상세에서 동기화 상태와 차량별 평가를 확인한다. 코드 소스·정책이 없으면 다음 구현 담당자의 작업을 안내한다.

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

`FF/examples/feature-flag-consumer/distance.ts`는 Signal·Parameter 키의 실제 호출과 OFF 기본값을 가진 실행 예제다. `distance.test.ts`는 Flag 값에 따라 기본 제어·경고·파라미터 적용이 바뀌는지 검사한다. 이 예제는 고객 차량 코드의 대체물이 아니다. 데모의 소스 연결은 실제 커밋 `1160d92de3af1a9cbaadc7241c2fa09baee39d4b`를 가리키며 **가상 차량 앱 · 예제 커밋**으로 구분한다. GitHub Verify 작업도 해당 실행의 확정 커밋을 스캔한 JSON을 산출물로 남긴다.

하네스는 작업 중인 수정·주석·문자열을 스캔 결과로 혼동하지 않는지, 잘못된 경로·자격 증명 URL·서로 다른 파일 해시·권한 없는 쓰기를 거부하는지, 같은 스캔의 재시도·호출 삭제·오래된 회신을 정확히 처리하는지 검사한다. 화면 검사는 실제 소스 링크, 가져오기 오류 시 입력 보존, 조회 오류, 읽기 역할, 좁은 폭과 시연 모드의 배치를 포함한다.
