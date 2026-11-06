// 회사 계정(SSO) 로그인 — 운영 빌드(VITE_AUTH=oidc). 버튼 하나로 IdP 로그인(BFF /api/auth/login)을 시작하고,
// 로그인 뒤 돌아올 곳(from)을 넘긴다. 서버가 같은 출처의 상대 경로만 받는다.
import { startSsoLogin } from '../../auth-oidc';
import { login as L } from '../../copy/login';
import { Button } from '../../design';

export function SsoLoginForm({ from }: { from?: string }) {
  return (
    <div className="lg__card" data-sso-login>
      <h2>{L.sso.title}</h2>
      <p className="lg__lead">{L.sso.hint}</p>
      <Button type="button" variant="primary" className="lg__submit" onClick={() => startSsoLogin(from && from !== '/login' ? from : '/')}>
        {L.sso.button}
      </Button>
    </div>
  );
}
