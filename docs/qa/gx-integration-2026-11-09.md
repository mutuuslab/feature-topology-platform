# GX 예외 정책 통합과 남은 정적 동등성

2026-11-09 / root / base `1ffa52b7`, 신뢰 후속 `6c4ecde1`. 최종 Publish 전 통합 원천이다.

예외는 원래 Gate 판정과 별도 층이며 요청자·다른 두 승인자·명시 만료·범위 상한·만료/회수 원복·감사를 요구한다. 서명/무결성·긴급 차단의 두 사람 승인·직무분리·0% 중단은 예외로 덮을 수 없다. 신뢰 후속은 raw PASS 문자열 대신 서명된 Gate 근거를 검증하고, 만료된 예외의 예약 원복 전에도 범위를 넓히지 못하게 한다. 기존 P10·P13 검수·SW와 합쳤으며 migration321 하나만 추가하여 잠금94개다.

이번 계약 규칙13 PASS, native 예외·신뢰·정책·ADS4파일61 PASS, backend type/build PASS. 최초25실패는 두 신규 양성 fixture가 기존 P13의 실제 산출물10개·독립검수 없이 G6를 요청한 준비 실패였다. `completeTestSupplierEvidence`를 호출해 선행조건을 갖춘 뒤61/61이며 제품 Gate나 거부 기대값을 완화하지 않았다. 로그는 kit `out/gx-contract-tests.log`, `gx-native-tests-r2.log`, `gx-backend-type.log`, `gx-backend-build.log`.

실API9590(source6c4·별도메모리·PID59092)에서 IAM을 추출했다. 24역할·221권한·16SoD·110화면·13계정·계약 차이0. 새 활동 FPW.7-A14/A15와 WP-EXCEPTION-RECORD를 기존 BP에 연결하지 않은 누락4개를 발견해 BP14·O6 추적을 추가했다. `docs/65-workflows/scripts/check.py`는 모델 오류0·경고0/59문서/pytest7 모두 PASS(`out/gx-workflow-check-r2.log`). 생성 모델은18절차·127활동·14부서·125산출물이며 기존 업무 ID는 보존했다.

Frontend 예외 UI·업무/계약 영어4파일 중20 PASS/신규 `/verify/exceptions` 제목 번역 누락1건은 English owner가 보완 중이다. 신규 예외 copy·계약/API 표시·workflow metadata의 영어는 이전1802분모의 완료 결과와 구분한다.

**정적 공개 전 미완료:** `api/sim/gx.ts`는 기존 branch 원천에서 HANDLERS 미연결이며 요청/승인 외 native 적용·제한 배포·만료 원복 동등성이 없다. snapshot-gx도 main에 연결해야 한다. 원천 부재를 빈 목록 성공으로 받지 않도록 보완하고 실제 정책 게이트·서명/권한·제한 범위·시간·재실행과 브라우저를 검증한 뒤 수락한다. GitHub recovery owner가 현재 수동 재개 마감 후 별도 WT로 이 영역을 맡는다. root는 해당 static policy-ops hunks를 동시에 수정하지 않는다. 본 native 통합만으로 전체 예외 기능·최종 Publish 완료로 표시하지 않는다.
