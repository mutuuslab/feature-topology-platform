---
id: TC-FLAG-PLATFORM-BENCHMARK-2026-11-09
type: reference
title: "Unleash·LaunchDarkly 비교와 Feature Platform 보완 원장"
status: in-review
version: 0.1.0
owner: verification-safety
cycle: 1
last_updated: 2026-11-09
---

# Unleash·LaunchDarkly 비교와 Feature Platform 보완 원장

2026-11-09 / root / 관찰 RC `6c4ecde1`. 기능 이름이 있다는 사실과 같은 버전에서 검증한 동작을 분리한다. 전체 벤더 기능을 그대로 추가하는 요구가 아니며 차량의 서명·권리·안전·직무 분리 규칙에 맞춰 적용한다. 비용 확장은 이 원장 및 Publish 트랙과 별도다.

## 공식 근거

- Unleash는 사용·배포 상태를 기반으로 Define/Develop/Production/Cleanup/Archived 수명주기와 stale 신호를 제공한다. 기간만 지났다는 이유로 안전 관련 Flag를 자동 삭제하는 근거는 아니다. [Feature flags](https://docs.getunleash.io/concepts/feature-flags)
- 같은 stickiness 키와 groupId를 통한 할당 일관성·상관 배포를 구분한다. [Stickiness](https://docs.getunleash.io/concepts/stickiness)
- 변경 요청은 프로젝트·환경별 검토와 예약 실행·실패/중단 상태를 관리한다. [Change requests](https://docs.getunleash.io/concepts/change-requests)
- LaunchDarkly guarded rollout은 단계 노출과 관측을 결합한다. 차량 기능의 별도 안전 판정·복원 승인은 유지한다. [Guarded rollouts](https://launchdarkly.com/docs/fed-docs/home/releases/guarded-rollouts)
- 코드 참조·extinction event·archive 점검을 연결해 코드 제거와 Flag 보관 상태를 구분한다. [Code references](https://launchdarkly.com/docs/home/flags/code-references)

## 원천·실행 비교

| 비교 관점 | 현재 Platform 원천·근거 | 남은 실행/보완 | 우선순위·담당 |
|---|---|---|---|
| 정의·책임·버전 | Feature DB 기준 등록, Feature/정책 승인 내용 해시, 소유자·범위 인계. `registry/lifecycle.service.ts`, `policy-store/policy.service.ts` | 최종 동일 SHA에서 신규/기준변경/반려/분리승인 여러 case. 원본 38 E2E를 최신 실행으로 복사하지 않음 | Publish 전·root |
| 타겟팅·안정적 할당 | `evaluateFlag`·`cohortBucket`·권리/차단 우선순위, TX 브랜드/지역/법규 조회 | context 누락·salt/범위 변경·VIN 대소문자·결정 재현성과 실제 Unleash/Edge 평가 대조. 결측을 임의 true로 만들지 않음 | Publish 전·root |
| 배포 검토·예외·예약 | P10 서명된 Gate/Sign-off 및 GX 2인 승인·만료·상한. 원본 Gate PASS로 덮지 않는 별도 예외 층 | GX native/정적 동등성·만료 직전/직후·원복·중단 0% 및 동시성. 임의의 환경 승격/예약 기능 완료로 간주하지 않음 | 진행 중·root |
| 관측과 확대·중단 | `staged-rollout/expansion.service.ts`, `canary.service.ts`, `judgeExpansion`; Shadow 결측/비교 표본 부족 ADOPT 차단 | 관측 지연·부분 실패·새 revision·사전 중단 기준 초과·재실행 검증. 검토자가 없는 자동 재활성화 금지 | Publish 전·root |
| 코드 참조·정리 | `flag-code.service.ts`, scanner/coverage, 승인된 retirement→제거 PR과 실제 코드 연결 게이트 | branch 생성 뒤 PR 실패·응답 유실 복구, FAILED/stalePLANNED UI 재개, 외부 branch/PR 인수 방지. GitHub agent의 HTTP 회귀 및 수동 재개 개선 진행 | 진행 중·GitHub agent |
| SDK·평가 설명 | OpenFeature/OFREP 서버·웹 적용 및 평가 trace. 원천 버전·관측 시각 표시 | 기존 차량 boolean/parameter 계약 밖의 임의 다변량 기능을 완료로 주장하지 않음. 지원 프로필·기본값·동일 Flag 결정에 대한 E2E와 영어 설명 검증 | Publish 전·root/English |
| 오프라인·신뢰 캐시 | P9 서명 payload 만료 정본, UNVERIFIED·직전 캐시 재검증·권리/차단 재평가. contracts33/native45 PASS | 최종 앱에서 손상·기한 초과·회수 키·이전 캐시 표시·다시 취득까지 관측. Lake 실제 소비·내구 cursor 별도 | 일부 검증·root |
| 권한·감사·다중 사용자 | 역할·소유자·비활성/이관, SoD·서명·Audit chain, IDB CAS·여러 탭 | 새 경로 IAM 실추출 및 직무표 재생성, 역할별 실패·외부 창·다중탭 최종 검증. 브라우저 내부 시연 권한을 서버 보안으로 설명하지 않음 | Publish 전·root |
| 실제 SW 전달 | 패키지 불변 byte/SHA·서명 manifest/CycloneDX·다른 담당자 승인·실제 Flag 허용 확인 후 다운로드. source2aa 브라우저394byte 해시/Node 실행 PASS | 최종 동일 SHA 및 공개 허용 합성1개만 캡처. 실제 ECU 설치/재부팅/원자적 교체/실차 인증과 구분. 누락 byte는 거부 | 일부 검증·root |
| 외부 도구·결측·재처리 | CB/Jira pagination·HTTP HTML 오류·RetryAfter·동일 요구 ID 충돌·GitHub 토큰 만료 보강 | 기존 demo 실제 여러 case와 popup 편집/읽기 경계. 회사 주소/토큰 새 요청 없음. 자동 백그라운드 재시도와 수동 재개를 구분 | 진행 중·root/GitHub agent |
| 운영 전달·확장성 | P9 FFV1-MSG auth·nonce·OTA 조회 대사, 정적 독립 관측 기반43회귀 PASS, 기존 사용자 서버9543 유지 | Lake 서버 영속/보존·분석 복사·consumer 및 MI durable SSE/leader 구현·통합. 메모리 참조와 단일 인스턴스 lease를 최종 확장성으로 표시하지 않음 | 미완료·root |
| 사용성·다국어·시각 설계 | 팀별 좌측 업무 분류·기본 Flow·등록 자동입력/가이드, 기존 UI/업무 상세 영어 완성 checkpoint | GX 신규 문구·활동 영어, 최신 원천 production 390/1366, Figma 일반11/104 외 상태·영어·최종 원천 정합과 전체 stakeholder 리뷰 | 진행 중·English/Figma/root |

원천 경로의 도메인 파일은 `FF/backend/src/domains/d01-policy/` 기준이며 도메인별 테스트·QA가 있다. 표의 존재/검증 상태는 최종 completion 비율이 아니다. GX 신규 native 시험은 기존 협력사 G6 선행조건이 없는 준비 단계 실패를 확인해 실제 합성 산출물·독립 검수 fixture로 보정 중이다. 계약 규칙13 PASS와 별개로 전체 native를 통과했다고 보고하지 않는다.

## 최종 수락 순서

1. 남은 도메인 원천과 WIP를 통합하고 native 의미와 정적 처리의 차이를 해소한다. 성공을 만드는 generic fallback 사용 여부를 경로별로 점검한다.
2. 각 팀은 절차별 입력→원천 활동→산출물 byte/내용→다른 담당자 검토→인계와 실패/재시도 case를 검토한다. generic case 완료는 native Gate 승인 효력과 구분한다.
3. 기획·개발·품질·안전·보안·운영·협력사·관리자 관점으로 전체 흐름·직무분리·결측·모바일/영어를 교차 검토한다. 비용 Needs 연구의 대상6명 제한은 Platform의 전체 역할 검증을 줄이는 뜻이 아니다.
4. 하나의 SHA에서 2배 데이터·ALM·정책/차단/복원·SW 다운로드와 전체 정적 패키지·297/40KiB·로그인/직접링크 게이트를 검사한다.
5. 최종 수동 Publish 후 원격 commit/release.json·ff/ff·외부 창·JS/로컬 요청·기능 결과를 실제 관찰한다. 기존 main 자동 배포로 구버전이 덮지 않는지도 확인한다.
