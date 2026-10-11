# FF — 작업 규칙

- 시작 전에 `PROGRESS.md`의 "다음 세션 시작점"을 읽는다. 단계를 마치면 PROGRESS.md를 갱신하고 `npm run progress`.
- 완료 기준은 `npm run verify` 통과(UI 변경은 `npm run verify:full`까지). 실패한 채로 커밋하지 않는다.
- 래칫(`harness/baselines.json`)은 좋아지는 방향으로만 `npm run ratchet -- --update`. 손으로 기준을 올리지 않는다.
- 42 컴포넌트를 구현하면 `contracts/src/components.manifest.ts`의 `IMPLEMENTED`에 endpoints·screens·tests를 채운다 — conformance가 실재를 검사한다.
- 도메인 규칙은 `contracts/src/rules/*`에 데이터 표로 둔다(프론트·백엔드 공용). 백엔드에 규칙을 복제하지 않는다.
- 신규 UI(`frontend/src/{design,screens,shell}`)는 원시 색상 금지(`design/tokens.css`의 토큰만), 문구는 `src/copy/ko.ts`에서만.
- 버그 수정은 재현 테스트를 함께 쓴다.
- 포트: 프론트 9012 · 백엔드 9101 · GLEO 8765 · Unleash 4242. 8000 금지.
