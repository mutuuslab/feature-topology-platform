# Feature Topology Platform — 현대자동차 SDV Feature Lifecycle & 통제 관리

SDV Feature 기준정보·관계 모델·운영 의사결정 체계. **비공개(내부) 저장소** — 현대자동차/Mutuus Lab 내부 설계·기능명세 포함.

## 구성
- **`docs/`** — 요구사항 정의 + 상세 설계 문서 리포지토리 (MD/YAML/Mermaid, FR-1~30·18 Entity·12 Rule·4 Engine·9 Gate·60 화면 IA). 진입: [docs/README.md](docs/README.md)
- **`FF/frontend/`** — 동작 UI/UX 프로토타입 (Vite + React + TS + Cytoscape, 자체 완결형·실시간 시뮬레이션·Fleet/VIN). 진입: [FF/README.md](FF/README.md)
- **`FF/backend/`** — NestJS 인메모리 GraphPort + 4 Decision Engine·12 Rule·9 Gate·REST (보류/연동 대기)
- **`*.pptx` / 기능명세 분석 산출물** — 원천 분석 입력

## 실행 (프론트)
```bash
cd FF/frontend
npm install
npm run dev      # http://localhost:9001   (포트 8000 금지)
```

## 라이브 배포 (선택)
`.github/workflows/pages.yml` 포함. 저장소를 공개(또는 GitHub Pro)로 전환하고 **Settings ▸ Pages ▸ Source = GitHub Actions** 설정 시 자동 배포 → `https://mutuuslab.github.io/feature-topology-platform/`.
> ⚠️ 공개 시 내부 기능명세·설계가 전면 노출되므로 주의.

---
Mutuus Lab · 2026-06
