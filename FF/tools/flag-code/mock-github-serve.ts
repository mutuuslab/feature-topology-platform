// 모의 GitHub 단독 실행 — node tools/flag-code/mock-github-serve.ts --port <코디네이터가 배정한 포트> (8000 금지)
// 빈 모의 GitHub를 띄우고 주소를 알린다. FF는 FF_GITHUB_API_URL·FF_GITHUB_OIDC_JWKS_URL을 이 주소로 둔다.
import { startMockGithub } from './mock-github.ts';

const i = process.argv.indexOf('--port');
const port = i > 0 ? Number(process.argv[i + 1]) : 0;
if (port === 8000) throw new Error('포트 8000은 쓰지 않습니다.');
const gh = await startMockGithub({ port });
console.log(`모의 GitHub — ${gh.url} (FF_GITHUB_API_URL=${gh.url}, FF_GITHUB_OIDC_JWKS_URL=${gh.url}/.well-known/jwks)`);
