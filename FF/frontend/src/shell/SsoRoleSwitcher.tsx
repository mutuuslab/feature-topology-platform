// 운영 빌드(SSO) 역할 선택기 — 로그인한 사용자의 이름을 보이고, IdP가 부여한 플랫폼 역할과 겹치는 화면 역할만 고를 수 있다.
// 지금 화면 역할이 부여 범위 밖이면(이전 데모 설정 등) 첫 허용 역할로 바꾼다. 서버도 부여 밖 역할 요청은 403·감사로 거부한다.
import { useEffect } from 'react';
import { personasFor } from '../api/actor';
import { useSso } from '../auth-oidc';
import { ko } from '../copy/ko';
import { roleLabel } from '../data/refdata';

export function SsoRoleSwitcher({ role, onChange }: { role: string; onChange: (r: string, quiet?: boolean) => void }) {
  const { user } = useSso();
  const options = personasFor(user?.roles ?? []);
  const name = user?.name ?? user?.email ?? user?.id ?? '';
  const off = options.length > 0 && !options.includes(role);
  useEffect(() => {
    if (off) onChange(options[0], true);
  }, [off, options, onChange]);
  return (
    <div className="sh-user" title={user?.email ? `${name} · ${user.email}` : name} data-sso-user>
      <span className="sh-user__avatar" aria-hidden>{name.slice(0, 1)}</span>
      <span className="sh-user__name" data-sso-name>{name}</span>
      <select aria-label={ko.shell.role} value={off ? options[0] : role} onChange={(e) => onChange(e.target.value)}>
        {options.map((r) => (
          <option key={r} value={r}>{roleLabel(r)}</option>
        ))}
      </select>
    </div>
  );
}
