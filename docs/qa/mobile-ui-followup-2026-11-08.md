---
id: TC-MOBILE-UX-20261108
type: reference
title: 모바일 등록 선택·정책 상태·탭 이동 UX 근거
status: in-review
version: 0.2.0
owner: feature-architect
cycle: 1
last_updated: 2026-11-09
---

# 모바일 UI 후속 판단

## 2026-11-09 추가: 남은 390px 넘침 8경로

독립 원천 `e481e787` 기반에서 `/validations/virtual`, `/fleet/live`, `/biz/trials`, `/_design`, `/twin/impact`, `/twin/simulation`, `/twin/fleet`, `/twin/vehicle/VIN-DEMO-017`을 수정했다. 실행 도구의 줄바꿈, 가용 폭을 넘지 않는 격자, 레거시 key/value 열의 min-content 해제, 텔레메트리 이름의 별도 행, 모바일 단계 흐름의 수직 연결선을 적용했다. 화면 낭독용 절대 위치 텍스트는 `.table-wrap`을 기준으로 배치했다. 표의 원문·가로 스크롤·키보드 이동과 단계 순서는 유지한다.

체험 차트는 ResizeObserver로 실제 본문 폭을 사용하고 좁은 폭에서 제목과 막대 행을 분리했다. SVG max-width/잘림으로 통과시키지 않았다. 새 `trial-responsive.spec.ts`는 실제 데이터의 차트 3개, 모든 텍스트의 SVG 내부 좌표, 방향키 주 이동과 Escape 닫기를 390/1366px에서 검증한다.

실제 운영 UI 빌드와 기존 9784 데이터의 읽기 전용 중계에서 8경로×390/1366px **16뷰 모두 원래 `measureNarrow` 그대로 doc/main 0, culprits/clippedTools 빈 배열, JS·HTTP·실패요청 0**을 확인했다. 넓은 표의 실제 ArrowRight 스크롤도 보존됐다. 최종 PNG 16개를 직접 검토했다. 원래 `narrow-all.spec.ts`의 해당 8시험과 새 차트 2시험 PASS, 영향 단위 31시험 및 프런트 타입 PASS다. 측정 코드·임계값·skip은 바꾸지 않고, 실제 통과한 8경로만 KNOWN에서 제거했다. 별도 담당의 Flag 2경로는 이 변경에서 건드리지 않는다.

수락 근거는 시연 키트 `out/mobile-overflow-fix/r5/{results,acceptance}.json`과 PNG, `out/mobile-overflow-exact-narrow-tests.log`, `out/mobile-overflow-chart-tests-r1.log`다. 초기 중계의 압축 헤더 오류로 데이터가 빠진 r2/r3 및 갤러리 17px가 남았던 r4는 수락 근거에서 제외했다. 갤러리 통과 전 KNOWN 제거는 자동 승인 검토가 거부했으며 예외를 유지한 채 수정·실데이터 재검증 후 제거했다. 기존 9543·9481·9483·9783·9784 원천/서비스와 native 데이터는 변경하지 않았다. 이 독립 UI 근거를 최종 원격 게시 완료나 최종 원격 전체 회귀로 대신하지 않는다.

사용자가 Figma 가이드의 플랫폼 역방향 검토 결과 중 세 항목에 ‘수행’을 지시했다. 원천은 `harness/mobile-ux-20261108`, 기준은 `4fb5ee4cfcb10c38ceb6ab5e526a27fdbce5c4c4`다. 현재 공개 릴리스와 별도 후속이다.

공식 근거: [Figma 컴포넌트·스타일·라이브러리 가이드](https://www.figma.com/best-practices/components-styles-and-shared-libraries/). 기존 의미 토큰·공통 부품을 재사용하고 가용 폭에 맞는 구성과 상태·행동의 일관성을 적용했다. 가이드를 적용했다는 이유만으로 기존 화면을 결함으로 판정하지 않았다.

| 판단 | 직접 확인한 근거 | 구현 |
|---|---|---|
| 등록 핵심 선택 발견성 | 기존 9477의 390px 검색표456/266px, 첫 선택x451.7px. 가로 스크롤은 가능하지만 두 선택·설명이 초기 가로뷰 밖에 있다. | RefPicker가 실제 가용 폭700px 미만이면 이름·ID·ASIL·규모·상태·두 선택과 기존 결과 설명을 단일 결과행에 그린다. 같은 선택 함수·폐기 규칙·초점 이동을 사용하고 넓은 화면의 표는 유지한다. |
| 정책 주요 상태 파악 | 기존 390px 정책표854/300px, 상태 열x634.5px. | 좁은 화면의 ID셀에 원문 상태와 기존 의미 배지를 요약한다. 전체8열·값·정렬은 유지한다. |
| 숨은 탭 발견·이동 | 기존 390px 차량탭479/302px, 마지막 항목x462.8px. 절차도358/302px로 끝이 가려진다. | 공통Tabs의 실제 넘침에만 이전·다음 이동을 제공한다. 경계에서 비활성화하고 기존 native 스크롤·tab/tablist/tabpanel·URL·방향키를 보존한다. |

표가 가로로 움직인다는 사실 자체를 사용 불가로 판정하지 않았다. 원래 데이터와 동작을 보존하면서 주요 행동과 상태의 초기 발견성을 높였다. 기존 SUIT/JetBrains, 따뜻한 종이·코발트·의미 상태색, Button/RefStatusBadge/VerdictBadge를 재사용한다.

Figma 연결은 파일 `CFFGwN4rHvDCq5IYa7sVCt`의 등록 모바일 `23:230`, 데스크톱 `23:7`, 표 행 `7:48`, 버튼 `7:32`, 정책 `30:350`, 상태 `7:44`, 차량 `33:31`, 절차 `13:70`이다. 실제 Figma 변경은 별도 담당자가 관리한다.

검증: 독립6개와 기존 등록·정책 영향군37개, 총43개가 통과했다. 추가 도구의 첫 빌드는297.3/297KiB로 실패했다. 넘침 측정·이동만 작은 지연 모듈로 분리하고 같은43개를 다시 통과했다. 최신 프런트 타입·문구·시험 위생, 실제 production build,297.0/297KiB·화면묶음32.7/40KiB·로컬 흔적0 검사도 통과했다. 한도·기준·건너뛰기를 변경하지 않았다.

실제 배포 CSP를 사용하는 별도 정적 미리보기에서390/768/1366px의 등록·정책·차량·절차12뷰를 검증했다. 두 선택과 인접 설명의 가로 경계, 정책ID 근처 상태, 끝 탭 드러내기·선택·방향키 초점·기존URL을 통과했고 JS오류/실패요청/외부요청/HTTP오류는 각각0건이다. 결과는 시연 키트의 `out/mobile-ux-20261108/production-browser/results.json`과12캡처에 보존했다. 초기 계측기의 즉시속성단언과 `tab`파라미터 가정은 상태대기·실제 `view`파라미터 확인으로 교정했고 제품결함으로 집계하지 않았다.

새 산출물은30348→17869파일로 무손실 패킹했다.12960개 GET본문·HEAD, 나머지17388파일의 byte동일성, 논리coverage틈0,2만파일 한도와 기존 용량 한도를 통과했다. 개발 Vite의 첫 로드 대기는 화면 검증 통과로 세지 않았다. 로컬 디스크 ASSETS 미리보기와 실제 Cloudflare edge·원격 CI·공개 게시는 구분한다. C가 별도 구현한 다섯 번째 절차 탭은 후속 통합 시 같은 이동 검증에 포함한다.

사용자의 추가 Jira PRD 스타일 지시는 이 체크포인트 뒤 별도 구현한다. 기존 description2000자·실제 metadata·PRIMARY/INCLUDED 계약을 유지하며 저장하지 않는 필드를 추가하지 않는다. 현재 문서는 그 추가 구현을 완료로 판정하지 않는다.
