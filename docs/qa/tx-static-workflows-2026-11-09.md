---
id: TC-TX-STATIC-WORKFLOWS-2026-11-09
type: reference
title: "분류·적용 조건 정적 업무 실행 검증"
status: in-review
version: 0.1.0
owner: verification-safety
cycle: 1
last_updated: 2026-11-09
---

# 분류·적용 조건 정적 업무 실행 검증

구현 체크포인트 `f59b3709`는 native TX 기능을 브라우저 시연에도 연결한다. 정적 모드에서 숨기던 노드 관리·Feature 배치·브랜드 조건 편집을 표시하고, 실제 원천 스냅샷 위에 브라우저 변경을 저장한다. 정책 본문·승인·배포·활성화는 이 메타데이터 수정으로 바뀌지 않는다.

- 노드 CRUD는 native와 같은 `checkNewNode/checkDeleteNode/checkPlacement`를 쓴다. Feature DB 발행 분류 직접 수정, ID 재사용, 잘못된 상위 수준, 폐기 상위, 하위·Feature 참조가 있는 노드 삭제를 거부한다. 삭제 묘비·등록/수정/삭제/배치 감사·이벤트를 보존한다.
- 트리·수준별 분류·직접 배치 수·경로·후보·지역/브랜드 집계를 변경 원천으로 다시 계산한다. 수준별 분류에는 조상과 자손이 함께 있으므로 직접 배치를 추정하지 않는다. 캡처된 각 Feature의 native `featureTaxonomy.placement`를 사용한다. Feature 수준이 바뀌어도 실제 배치 노드를 임의로 옮기지 않는다.
- 브랜드 조건 등록은 작성 역할, 수정은 실제 Feature Owner 또는 시스템 관리자이며 사람 역할 경계를 유지한다. UI에서도 관리자가 기존 조건을 수정할 수 있도록 native 순수 권한 규칙과 일치시켰다. 수정 revision과 감사가 남는다.
- 지역 후보는 실제 Feature 상세의 UPG-VC와 Baseline의 Feature 구성을 사용한다. 필요한 원천이 누락되면 빈 목록이나 성공을 만들지 않고 source 오류로 실패한다.
- 정적 Registry의 새 행 요약에 분류 수준을 보존하고 분류 수준 필터를 적용한다. `snapshotTx`를 main 캡처에 연결하고 각 정책의 조건 조회도 포함했다.

## 실행한 검증

- 새 `taxonomyStatic.test.ts` **22 PASS**: CRUD/삭제 묘비 재수화, 조상·배치 참조 거부, 잘못된 수준·폐기·중복·본문·권한 거부, 배치 이동/경로·분류 갱신, 실제 Owner·관리자·기계 경계, 정책 불변, 지역 후보의 실제 참조, 원천 누락 실패, 분류 필터 및 직접 배치 정합.
- 새 시험과 기존 분류 화면·업무 인계·등록 추적을 합쳐 **4파일 35 PASS**, frontend 타입 검사 PASS. contracts dist는 병합된 소스로 다시 빌드했다.
- 확정 소스 `f59b3709`의 production static artifact `FF/frontend/dist-tx-static-20261109-r2`, **첫 화면 290.0/297 KiB · 화면 최대 32.7/40 KiB PASS**.
- 실제 Chromium: 노드 등록 → 명칭 수정 → reload 보존 → Feature 다른 노드 배치 → reload 경로 확인 → 작성자의 조건 등록 → 시스템 관리자의 실제 조건 수정. IndexedDB 변경을 실제 화면에서 다시 읽었다. **JS 오류 0 · 외부 business 쓰기 요청 0 · 390/1366px 가로 넘침 0**. 최종 PNG를 직접 검토했다.

키트 근거: `out/tx-static-20261109/browser_tx.py`, `browser.json`, `build-r2.log`, `placement-{390,1366}.png`, `global-scope-{390,1366}.png`. 초기 브라우저 선택자 실패는 실제 Panel의 aria-labelledby와 hint/option이 포함된 label 이름을 읽어 보정한 시험 구성 이력이다. 첫 WIP artifact의 결과와 최종 확정 커밋 r2 결과를 구분한다.

## 범위

브라우저 검증은 명시적인 합성 원천 fixture를 사용한 정적 업무 수락이다. 회사 원본·실차/안전 인증 또는 전체 2배 corpus의 최신 게시 검증이 아니다. main 캡처 경로는 연결했지만 최신 RC의 full corpus 재생성·패키지 전체 파일 예산·통합 E2E·영어 최종 화면 정합은 root의 후속이다. 최종 Publish는 수행하지 않았다. 요구 판정 원장과 기존 297 KiB 예산은 변경하지 않았다.
