# Feature Platform 단독 설치 이미지 — 출시 준비 RD-OPS-05 (docs/20-architecture/20-91-install-guide.md).
# 한 설치 = 한 고객(D-RD-1). 백엔드(NestJS)가 운영 빌드 화면(VITE_AUTH=oidc)을 같은 출처로 함께 낸다(FF_WEB_DIR).
# TLS는 앞단 프록시가 끝낸다 — 이 컨테이너는 http 9101만 연다.
#
#   빌드(FF 폴더에서):  docker build -f docker/app/Dockerfile --build-arg FF_BUILD_SHA=$(git rev-parse --short HEAD) -t ff-platform:0.1.0 .
#   실행:               docker compose -f docker/app/docker-compose.yml --env-file docker/app/.env up -d
#
# 단계: deps(전체 의존성) → build(contracts·backend·운영 화면) → runtime(운영 의존성만, 비루트 사용자)

ARG NODE_IMAGE=node:24-bookworm-slim

# ── 1) 의존성 — lock 파일 그대로(npm ci). e2e 브라우저는 받지 않는다 ──
FROM ${NODE_IMAGE} AS deps
WORKDIR /app/FF
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    npm_config_fund=false \
    npm_config_audit=false
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY e2e/package.json e2e/
RUN npm ci

# ── 2) 빌드 — contracts(tsc) → backend(tsc) → 운영 화면(VITE_AUTH=oidc: 데모 로그인·역할 선택기가 빠진 번들) ──
FROM deps AS build
COPY contracts/ contracts/
COPY backend/ backend/
COPY frontend/ frontend/
RUN npm run build -w @ff/contracts \
 && npm run build -w feature-topology-backend \
 && cd frontend && VITE_AUTH=oidc npx vite build --outDir dist-prod --emptyOutDir --logLevel warn

# ── 3) 운영 의존성만 — devDependencies 없이 backend·contracts가 쓰는 것만 ──
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app/FF
ENV npm_config_fund=false \
    npm_config_audit=false
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY e2e/package.json e2e/
RUN npm ci --omit=dev -w feature-topology-backend -w @ff/contracts --include-workspace-root=false

# ── 4) 실행 이미지 ──
FROM ${NODE_IMAGE} AS runtime
ARG FF_BUILD_SHA=unknown
LABEL org.opencontainers.image.title="Feature Platform" \
      org.opencontainers.image.description="Feature Flag Platform — 고객사 단독 설치(한 설치 = 한 고객)" \
      org.opencontainers.image.revision="${FF_BUILD_SHA}"
WORKDIR /app/FF
ENV NODE_ENV=production \
    FF_ENV=production \
    FF_SEED=none \
    FF_AUTH=oidc \
    PORT=9101 \
    FF_DB=/var/lib/ff/ff.db \
    FF_AUDIT_ANCHOR_FILE=/var/lib/ff-anchor/audit-anchor.jsonl \
    FF_WEB_DIR=/app/FF/web \
    FF_BACKUP_DIR=/var/backups/ff \
    FF_EVIDENCE_DIR=/var/lib/ff/evidence \
    FF_BUILD_SHA=${FF_BUILD_SHA}
COPY --from=prod-deps /app/FF/node_modules ./node_modules
COPY --from=build /app/FF/package.json ./package.json
COPY --from=build /app/FF/contracts/package.json ./contracts/package.json
COPY --from=build /app/FF/contracts/dist ./contracts/dist
COPY --from=build /app/FF/backend/package.json ./backend/package.json
COPY --from=build /app/FF/backend/dist ./backend/dist
COPY --from=build /app/FF/frontend/dist-prod ./web
# 안전 프로필·명령 원장 기본표·외부 연계 식별 픽스처를 백엔드가 이 경로에서 읽는다(데모 시드는 FF_SEED=none이라 넣지 않는다)
COPY data/fixtures ./data/fixtures
# 데이터·고정점·백업 폴더는 비루트 사용자 node(uid 1000)가 쓴다
RUN mkdir -p /var/lib/ff /var/lib/ff-anchor /var/backups/ff \
 && chown -R node:node /var/lib/ff /var/lib/ff-anchor /var/backups/ff
USER node
EXPOSE 9101
VOLUME ["/var/lib/ff", "/var/lib/ff-anchor", "/var/backups/ff"]
# 준비 점검 — 마이그레이션 적용·DB 쓰기 가능(slim 이미지에 curl이 없어 node fetch로)
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||9101)+'/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "--disable-warning=ExperimentalWarning", "backend/dist/main.js"]
