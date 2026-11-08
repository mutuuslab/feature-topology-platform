---
id: TC-WIRE-INTEGRATION-2026-11-09
type: reference
title: "차량 상태 보고 2.0·2.1 및 Feature epoch 통합"
status: in-review
version: 0.1.0
owner: verification-safety
cycle: 1
last_updated: 2026-11-09
---

# 차량 상태 보고 2.0·2.1 및 Feature epoch 통합

2026-11-09 / root. 원천 `gap/w@2166416c`와 원래 WT에 보존된 GLEO2.1 벡터·시험·snapshot-w 세 파일을 통합했다. 원래 작업 트리 파일은 수정하지 않았고 세 복사 파일의 SHA가 일치한다. 표준/감사 WIP 파일은 판정 근거로 자동 수용하지 않았다.

- 상태 보고2.0은 유지하고2.1을 같은 차량 입구에서 수락한다. 2.1의 decision_id/판정/유효기한·전달 단계·실제 실행 상태·제어 책임·MRC·보고 예산을 규칙에 맞춰 투영한다. 미확인 상태를 정상·적용 완료로 추정하지 않는다.
- 긴급 차단 시 Feature epoch를 올리고, 차량이 이미 본 epoch보다 오래된 정책 게시본을 거부한다. 서명 payload에는 현재 epoch와 P9의 서명된 캐시 만료시각을 함께 넣는다. P9 필드 검증·TTL 거부와 epoch 거부를 모두 순번 소비 전에 수행한다.
- 재연결 대사는 서버 의도·차량 보고·불일치/미확인 기간을 읽는 API다. 지연·불일치나 제어 책임 사건을 차량 SW 설치·정상 작동 증거로 만들지 않는다. 새 GET과 AC GET 캡처는 snapshot main에 연결했지만 최종 전체 snapshot 재생성/배포는 아직 전이다.
- 새 migration201만 추가하여 기존95개 SQL 해시를 보존하고 잠금96개다. 계약/API 생성은564경로다.

이번 실행: native 상태2.1·P9 캐시/trust3파일37 PASS(`out/wire-native-tests.log`), 계약 상태2.1·wire·캐시3파일33 PASS(`out/wire-contract-tests.log`), backend type PASS(`out/wire-backend-type.log`), 보존된 교차 언어용 벡터 시험2 PASS(`out/wire-vectors-tests.log`). kit out 기준 로그다. 벡터는 시험 전용 고정 키이며 실제 차량 비밀이 아니다.

후속: FF_IMP Python과의2.1 교차 언어 실실행, GLEO/실차 수신 인증과 Lake 소비 연결, 역할별 재연결 화면·정적 독립 시연의 동등성, 최종 여러 case 전체 E2E/Publish를 별도로 확인한다. 이번 native/vector PASS를 이러한 미실행 항목의 완료로 확대하지 않는다.
