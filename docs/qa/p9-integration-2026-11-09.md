# P9 차량 메시지·서명 캐시·OTA 대사 통합 검토

2026-11-09, 담당 root. RC `release/web-20261108-p10`, base merge `b5c75895`, 신뢰 후속 `c799a0e9`. 아직 최종 게시 근거가 아니다.

## 구현과 신뢰 경계

- FFV1-MSG의 본문 해시·차량 가명→VIN·키 epoch·MAC·나이·미래 시각·nonce 충돌을 검증한다. nonce는 DB migration311에 기록한다. 모든 기존92개 마이그레이션 SQL 해시는 보존했고 잠금93개로 갱신했다.
- 정책 캐시는 서명 payload의 유효 기간을 정본으로 삼는다. wrapper의 기간 연장은 효력이 없다. 서명/본문/기한이 없으면 UNVERIFIED이며 안전 기본값 또는 다시 검증한 직전 캐시만 사용한다. 직전 캐시를 쓰더라도 실제 Feature/권리/차단 정보를 재평가한다.
- native OTA 대사는 실제 설정된 OTA client의 작업 조회만 반영한다. 대상 밖 차량·모르는 결과를 제외하고 DELIVERED를 늦은 중간 결과로 되돌리지 않는다. 차량 적용 결과와 OTA 전달 사실이 다르면 이상 신호를 남긴다. OTA 서버 응답을 차량의 적용·설치 증거로 만들지 않는다.
- 정적 핸들러는 기존의 모든 DELIVERING→DELIVERED 가정을 제거했다. 독립 예약 작업이 `LOCAL_SIMULATION` OTA 관측을 기록하고, 대사는 동일 jobId/attempt의 관측된 대상 결과만 소비한다. 원천 부재·잘못된 시도·시각·상태는 거부한다. 관측 결과를 audit/event에 명시하며 readback이나 적용 집계를 만들지 않는다. 실제 외부 OTA 연결과는 다른 브라우저 내부 시연이다.
- 생산·소비 모두 트랜잭션의 staged state를 사용한다. 엔진의 조회는 앞서 큐에 들어간 쓰기·예약 작업의 커밋을 기다린다. 추가 관측 작업 때문에 예약 회신의 커밋 전에 이전 결과를 읽는 회귀를 발견해 해결했다. 재시도·롤백의 기존 동작을 유지했다.
- 최적화된 한 VIN 조회, 전체 Fleet KPI/안전 우선60대 및 검색, 기존 P10/P13/TX/SW 게이트·서명·역할을 보존했다. 기존 requirements/ADS/Orca 감사 판정은 병합으로 일괄 변경하지 않았다.

## 이번 실행 검증

| 범위 | 결과 | 근거(kit out) |
|---|---|---|
| contracts 정책캐시·OTA·메시지 3파일 | 33 PASS | p9-contract-tests.log |
| native 캐시/trust·메시지 auth/vector·OTA·계약 결합6파일 | 45 PASS | p9-native-tests-r2.log |
| backend type | PASS | p9-backend-type-r2.log |
| frontend type(정적 관측 포함) | PASS | p9-frontend-type-r3.log |
| OTA 관측·OTA UI·캐시 UI·정책/롤백·엔진5파일 | 43 PASS | p9-static-tests-r3.log |
| TX·software 정적 2파일 | 38 PASS | p9-static-impact.log |

초기 native 실패6개는 trust 후속을 적용한 뒤 계약 dist를 재빌드하지 않은 실행이었다. 계약을 다시 빌드한 동일 원천에서45/45로 검증했다. 정적 초반 실패는 테스트 예약 경로와 생산 staged state/조회 큐의 결함을 구분해 보정했으며 거부 조건·기대 결과를 완화하지 않았다.

## 여전히 별도인 항목

참조 Lake 서버는 메모리 저장이고 인증서 주체 헤더를 받는 프록시 모형이다. 실제 mTLS나 Lake 영속·7일 보존·분석 사본·TL-M04 소비자·내구 cursor·다중 인스턴스 완료를 의미하지 않는다. 최종 동일 SHA production 브라우저·2배 데이터 전체 E2E·최종 영어/원천 문서 재생성과 팀별/이해관계자 리뷰·Publish는 후속이다. 일반 UI 문구 영어는 별도 English owner의 P9 checkpoint로 통합한다.
