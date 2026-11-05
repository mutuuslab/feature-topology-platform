---
id: ARC-UNLEASH-LIVE
type: architecture
title: "Unleash 실제 런타임 통합 / Live Runtime"
status: in-review
version: 0.1.0
owner: feature-architect
cycle: 0
standards: [OpenFeature]
traces:
  depends_on: [ARC-FLAG-SOURCE]
last_updated: 2026-11-05
---

# Unleash 실제 런타임 통합

FF가 Feature Flag의 승인·배포·서명 원천이다. Unleash 서버는 수정하지 않은 공식 배포본을 별도 프로세스로 실행하고, OSS Edge는 차량별 평가를 담당한다. 고객 서버와 Windows Tauri 모두 같은 연결·검증 경계를 사용한다.

## 고정 자산

| 자산 | 고정점 | 배포·라이선스 |
|---|---|---|
| Unleash server | 8.3.1, `vendor/unleash`의 `51aaeb62a63a1753b7ce7d3b3b4e8a5aef89f4b4` | `mutuuslab/unleash` fork/submodule, 공식 npm 배포본의 SHA512 및 의존 lock, AGPL-3.0-or-later |
| OSS Edge | 20.6.0, `unleash-edge-v20.6.0` | 공식 Windows x64 ZIP SHA256 고정, MIT. Enterprise 실행 파일은 사용하지 않는다. |
| PostgreSQL | 18.3 | 한 인스턴스, `feature_platform`/`unleash` DB 및 로그인 역할 분리, PostgreSQL license |

정확한 URL·해시·컨테이너 digest는 `FF/tools/unleash/pins.json`, `server-package-lock.json`, `FF/docker/unleash/docker-compose.yml`이 원천이다. 자산 준비는 npm integrity와 Edge SHA256을 검사하고 라이선스와 source provenance를 배포 자산에 포함한다. PostgreSQL은 공식 설치본의 core 실행 파일과 DLL 의존을 그대로 복사한다. 로컬 PC에 추가 설치된 PostGIS·GUI는 포함하지 않는다.

공식 근거: [Unleash v8.3.1 source](https://github.com/Unleash/unleash/tree/v8.3.1), [Edge 20.6.0 release](https://github.com/Unleash/unleash-edge/releases/tag/unleash-edge-v20.6.0), [Edge OSS license](https://github.com/Unleash/unleash-edge/blob/unleash-edge-v20.6.0/LICENSE), [Edge frontend evaluation](https://docs.getunleash.io/concepts/front-end-api).

## 데이터와 실행

Native supervisor `FF/tools/unleash/runtime.mjs`는 기본으로 PostgreSQL 5543 → Unleash 4242 → Edge 3063 → FF 9171 순서로 실행한다. 먼저 모든 포트의 사용 여부를 검사한다. 다른 서비스가 포트를 사용하면 중단하며 그 프로세스를 종료하지 않는다. PostgreSQL을 초기화할 때 UTF-8/C locale과 SCRAM 인증을 사용하고 루프백에만 바인딩한다. 두 DB의 소유자를 나누고 PUBLIC의 DB CONNECT를 회수한다.

비밀번호, API 토큰, 차량 root, KEK는 설치별 무작위 값이다. private data 폴더를 현재 Windows SID에 제한하고 값을 stdout·Git·프로세스 인수로 내보내지 않는다. 로그는 줄 단위로 비밀을 지운 뒤 같은 private 폴더에 쓴다. 외부 KEK/KEK_FILE 설정은 유지한다. 기존 데모 KEK로 저장된 데이터는 FF의 기존 KEK 이전 경로를 사용한다.

차량 서명 순번은 migration 088의 VIN별 단조 증가 counter로 영속한다. 순번 할당과 서명을 같은 DB 트랜잭션으로 처리하여 프로세스 재시작·같은 밀리초 응답·서명 실패가 이전 활성 서명본의 재생을 허용하지 않는다.

각 sidecar의 readiness와 실제 Backend/Frontend 토큰을 확인한 뒤 FF를 시작한다. Edge pretrusted token/offline 모드를 사용하지 않는다. 하위 프로세스가 종료되면 FF·Edge·Unleash를 정리하고 이 supervisor가 시작한 PostgreSQL cluster만 clean stop한다. `stop` 명령과 Tauri stdin stop 신호도 같은 정리 경로를 쓴다. DB 데이터는 종료 시 삭제하지 않는다.

Tauri는 Node supervisor를 실행하고 `FF_DESKTOP_READY:<port>`를 받은 뒤 루프백 UI를 연다. 공식 server 파일의 긴 경로를 NSIS에 직접 넣지 않고 SHA256으로 검사하는 `sidecars.tar.gz`로 포함한다. 설치 후 private data 폴더로 원본 그대로 추출한다. 앱 종료 시 supervisor에 stop을 보내 정리 완료를 기다린다. Node·Unleash·Edge·PostgreSQL이 설치 자산에 포함되어 Docker가 필요하지 않다.

기존 Tauri `feature-platform.sqlite`가 있고 대상 PG DB가 비어 있으면 읽기 전용 SQLite backup을 별도 working copy로 만든 뒤 최신 schema를 적용하고 기존 `copySqliteToPg`로 이전한다. 테이블 행 수와 감사 체인 검증이 끝나야 부팅한다. 원본 SQLite는 바꾸거나 지우지 않는다. 이전 실패는 marker로 남겨 조용히 새 데모 DB를 열지 않는다. 사용자 데이터와 KEK는 함께 백업해야 한다.

데스크톱과 Docker에는 `data/fixtures`, `data/reference`, `data/source`가 포함된다. 따라서 통합된 개발비 basis와 C4 Excel 템플릿도 같은 앱의 자산으로 배포된다. 실제 통합 브랜치의 최신 backend/contracts/frontend를 빌드하며 별도 과거 앱을 복사하지 않는다.

## FF 원천과 충돌

내보내기는 DEPLOYED 정책이면서 현재 정책 전체와 일치하는 유효한 FF policy-purpose 서명 게시본이 있을 때만 허용한다. 초안, 미서명 또는 변조된 DB 내용은 Unleash로 나가지 않는다. FF 배포 이벤트와 최초 live 부팅은 사본을 동기화한다. 승인된 rollout 단계 변경은 FF에서 새 policy publication을 서명한 뒤 복제한다. 서버 수동 변경을 FF로 가져오거나 주기적으로 숨겨 덮어쓰지 않는다.

동기화 후 실제 정의를 다시 읽어 의미가 같아야 SYNCED를 기록한다. 비교에는 활성 상태, 전략 이름·disabled, 모든 parameters, 제약의 case sensitivity·연산·값, segments, variants, 의존 관계, FF 추적 태그가 포함된다. 다른 설정이 남아 있거나 서버를 확인하지 못하면 FAILED다. 원본과 사본의 불일치는 차량 서명 발행을 차단한다.

## 검증 경계

`backend/test/d01/unleash-vehicle.spec.ts`는 외부 전송을 대체한 인증·서명 경계 단위 시험이다. `unleash-vehicle-live.spec.ts`는 opt-in 실제 고정 server/Edge 통합 시험이며 모의 성공으로 대체하지 않는다. `tools/unleash/smoke.mjs`는 실제 실행 중인 FF HTTP와 PG DB, CMAC, Edge 결과, 독립 공개키 서명·TTL을 검사한다. `tools/unleash/runtime.test.mjs`는 포트 충돌·비밀 로그·고정 lock을 검사한다. 전체 verify와 최종 통합 자산 검증은 이 변경을 합친 브랜치에서 다시 수행한다.
