# EA 원본 — FF 플랫폼 아키텍처 v0.0

| 항목 | 값 |
|---|---|
| 원본 | `FF_플랫폼_아키텍처_v0.0.qea` (Enterprise Architect, SQLite 형식) |
| sha256 | `f63e314aaace116d7f27651fede697aceb440f00264589e44469b5287dcef8c0` (1,675,264 B) |
| 다이어그램 | Layered Architecture — 6 도메인(«domain») · 12 레이어(«layer») · 49 컴포넌트, 포함 관계(Nesting) 12 |
| 화면 | `/arch/components` 아래 "EA 원본" 패널 |

- 원본은 고치지 않고 그대로 둔다(이름의 오탈자 포함 — 예: "로컈 정책 캐시", "콘플라이언스 룰 체커").
- 화면 그림은 `FF/tools/ea-diagram.ts`가 이 파일의 저장된 위치·색(t_diagramobjects·t_object)으로 그린 SVG다.
  EA가 내보낸 그림 파일이 아니므로 글꼴·선 모양은 EA 화면과 조금 다를 수 있다. 포함 관계 선은 상자 겹침으로 대신한다.
- 원본을 바꾸면: 이 폴더의 `.qea`를 교체 → `npm run ea:render`(FF) → 생성된 `frontend/public/arch/ea-layered-architecture.svg`·
  `frontend/src/screens/home/ea-diagram.meta.json`을 함께 커밋. verify `ea:check`가 어긋나면 실패한다.
- 플랫폼 구현은 이 49개를 42개 구현 단위(D01~D06, `contracts/src/components.manifest.ts`)로 묶어 추적한다.
