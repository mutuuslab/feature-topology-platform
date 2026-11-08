# AC 승인 조합·보안 최소 버전·권한 범위 통합

2026-11-09 / root. 기존 P10/P13/TX/SW/P9/GX와 F0 계정 관리 위에 `gap/ac@74e2f006`을 통합했다. 기존 감사 결론·상태 문구는 원천 병합으로 일괄 완료 처리하지 않고 보존했다.

- 조합은 제안 뒤 별도 기능안전 담당자가 승인한다. 제안자 본인 승인 거부, 승인 전 조합 발행·차량 대조 근거 사용 거부, 승인의 append-only 기록을 유지한다.
- SW 최소 버전은 사이버보안 담당자가 승인한 표를 정본으로 읽으며 요청 본문이 이를 낮추거나 생략할 수 없다. 알려지지 않은 SW·하한 미달·같거나 낮은 새 제안·본인 승인을 거부한다.
- 시장·Feature·환경별 계정 범위를 역할 위에 적용하여 차단·복원·정책 발행의 범위 밖 명령을 거부하고 감사한다. null 전체/빈 배열 모두 거부의 의미를 보존한다. 현재 지정 API 권한은 SECURITY_OFFICER이며, UI 범위 패널은 아직 조회 중심이다.
- D06 보안 모듈의 기존 AccountController와 새 RoleScopeController를 함께 유지했다. migration341만 추가해 잠금95개다. 계약/API 라우트563개를 현재 원천에서 생성했다. 초기 계약 import 중복은 새 세 승인 스키마를 정확히 import하도록 수정했다.

이번 실행: native4파일36 PASS(`out/ac-native-tests.log`), 계약2파일9 PASS(`out/ac-contract-tests.log`), 화면5 PASS(`out/ac-frontend-tests.log`), backend type PASS(`out/ac-backend-type.log`). 로그 경로는 kit 기준이다.

최종 수락 전: 현재 API의 IAM 재추출·절차 action binding 확인, 계정 범위 지정 UI·입력 자동선택/가이드, snapshot-ac main 연결·AC 정적 mutation 동등성, 신규 문구/계약 표시 영어, 실제 production 브라우저와 역할별 여러 case 검증이 남는다. 이 기록은 전체 AC 완료·최종 Publish 완료의 근거가 아니다. 원래 AC WT의 WIP4개는 generated/표준 상태 파일이며 별도 기능 원천으로 합치지 않았다.
