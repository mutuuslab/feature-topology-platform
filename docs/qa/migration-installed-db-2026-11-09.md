---
id: TC-MIGRATION-INSTALLED-DB-2026-11-09
type: reference
title: "통합 마이그레이션 순서와 기존 설치 DB 보존 검증"
status: in-review
version: 0.1.0
owner: verification-safety
cycle: 1
last_updated: 2026-11-09
---

# 통합 마이그레이션 순서와 기존 설치 DB 보존 검증

2026-11-09 / root. 사용자 지정9543 서버와 원본 DB는 유지했다. 비용 작업에서 발견한 배열 순서 문제를 비개발비 원천에도 별도 수정했다. `MIGRATIONS`의 반환 배열만 이름순으로 정렬했으며 이미 실행기 `migrate()`도 같은 순서로 적용하고 있었다. 기존100개 SQL과 잠금 해시는 변경하지 않았다.

과거 판별 데이터 보존·스키마 동일·잠금 시험 및401/402/411이 먼저 설치된 상태에 낮은 번호를 통합하는 추가 회귀를 실행하여 **2파일13 PASS**(`out/migration-order-regression-r2.log`)를 확인했다. 새 회귀의 binary 항목은 실제 이름431_binary_objects를 사용한다.

추가로 실제 source767 검토 서버의 SQLite DB를 읽기 전용 온라인 백업으로 `out/upgrade-current-20261109/review-database-copy.db`에 복제했다. 복제본에만 새10개 migration(201,231~234,311,321,341,431,441)을 적용하여90→100으로 올렸다. 기존215개 업무 테이블110,999행의 **원래 모든 열 값의 해시 변화0**, FK 위반0→0, 새 DB와 스키마 동일 PASS다. 기존 schema_migrations의 기록은 보존하며 신규 적용 기록만 추가했다. private 업무 값은 출력하지 않고 테이블별 해시를 내부 비교했다.

검증 보고서는 kit `out/upgrade-current-20261109/results.json`, 원천 온라인 백업 경계는 `backup.json`에 있다. DB 사본·원천 행·로그를 공개 배포/커밋에 포함하지 않는다. 이 결과는 SQLite 설치판 업그레이드 증거이며 PostgreSQL 전체 호환성의 대체 근거는 아니다. 비용451 migration은 이 비개발비 검증/커밋에 포함하지 않았다.
