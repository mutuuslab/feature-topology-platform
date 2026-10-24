// SSO e2e용 시험 IdP — 백엔드 시험과 같은 코드(backend/test/fixtures/fake-oidc.ts)를 고정 포트로 띄운다(기본 9613, 8000 금지).
// Node가 TS 타입 표기를 지우고 바로 실행한다. 사용자 고르기 화면 → 인가 코드 → 토큰. /test/token은 API 준비용(e2e 전용).
import { startFakeOidc } from '../../backend/test/fixtures/fake-oidc.ts';
import { CLIENT_ID, CLIENT_SECRET, USERS } from './users.mjs';

const port = Number(process.env.E2E_OIDC_IDP_PORT ?? 9613);
// 로그아웃 뒤 돌아갈 주소 — 실제 IdP처럼 등록한 주소만(설정이 E2E_OIDC_PUBLIC으로 준다)
const postLogoutRedirectUris = process.env.E2E_OIDC_PUBLIC ? [`${process.env.E2E_OIDC_PUBLIC}/login`] : [];
const idp = await startFakeOidc({ port, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, users: USERS, exposeTestTokens: true, postLogoutRedirectUris });
console.log(`fake IdP → ${idp.issuer}`);
const stop = () => idp.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
