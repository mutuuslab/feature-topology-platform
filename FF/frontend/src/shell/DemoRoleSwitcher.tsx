// 데모 역할 선택기 — 데모 빌드에서만 실린다(운영 빌드는 SsoRoleSwitcher: 부여받은 역할만). 데모 계정 9명 전부를 고를 수 있다.
import { ko } from '../copy/ko';
import { profileOf, roleLabel, roles } from '../data/refdata';

/** 번들 검사 표식 — 운영 빌드에 이 문자열이 있으면 데모 역할 선택기가 실린 것이다(tools/prod-bundle.test.ts) */
export const DEMO_ROLES_MARKER = 'ff-demo-roles-v1';

export function DemoRoleSwitcher({ role, onChange }: { role: string; onChange: (r: string) => void }) {
  const me = profileOf(role);
  return (
    <div className="sh-user" title={`${me.name} · ${me.empNo} · ${me.org}`} data-demo-roles={DEMO_ROLES_MARKER}>
      <span className="sh-user__avatar" aria-hidden>{me.name.slice(0, 1)}</span>
      <select aria-label={ko.shell.role} value={role} onChange={(e) => onChange(e.target.value)}>
        {roles.map((r) => (
          <option key={r} value={r}>{roleLabel(r)}</option>
        ))}
      </select>
    </div>
  );
}
