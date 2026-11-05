// 부서 전환(데모) — 상단 바. 전체 보기 + 14개 부서(화면 유형별로 묶음). 부서를 고르면 그 부서의 데모 계정으로 바뀌고,
// 데모 계정이 여럿인 부서(상품기획: Feature Owner·상품 기획·상품 Owner 등)는 부서 안 역할을 고른다.
// 전체 보기에서는 지금까지처럼 12개 데모 계정을 모두 고를 수 있다(DemoRoleSwitcher). 운영 빌드(OIDC)는 이 선택기를 싣지 않는다.
import { WORKSPACES, type DepartmentSummary, type WorkflowDoc } from '@ff/contracts';
import { departments as D } from '../copy/departments';
import { ALL_DEPARTMENTS, DEPARTMENTS, departmentById } from '../data/departments';
import { profileOf, roleLabel } from '../data/refdata';
import { useWorkflows } from '../data/workflows';
import { DEMO_ROLES_MARKER, DemoRoleSwitcher } from './DemoRoleSwitcher';

export function DepartmentSelect({ value, onChange, id, label = D.switcher }: { value: string; onChange: (dept: string) => void; id?: string; label?: string }) {
  return (
    <select id={id} aria-label={label} className="sh-dept__select" value={value} onChange={(e) => onChange(e.target.value)} data-dept-select>
      <option value={ALL_DEPARTMENTS}>{D.all}</option>
      {WORKSPACES.map((w) => (
        <optgroup key={w} label={D.workspace[w]}>
          {DEPARTMENTS.departments
            .filter((d) => d.workspace === w)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

/**
 * 부서 안 역할 이름 — 부서 R&R(조직 역할) 이름으로(예: 상품기획팀의 approver는 '상품 Owner', 시스템엔지니어링팀의 approver는 '요구 Owner·도메인 검토자').
 * 업무 절차 모델을 아직 못 읽었으면 데모 계정 이름(P2-10·P1-11)
 */
export function personaRnR(doc: WorkflowDoc | null | 'fail', d: DepartmentSummary, persona: string): string {
  if (!doc || doc === 'fail') return roleLabel(persona);
  const org = (doc.personas?.[persona] ?? []).filter((r) => d.roles.includes(r));
  const names = org.map((r) => doc.roles.find((x) => x.id === r)?.name).filter(Boolean);
  return names.length ? names.join('·') : roleLabel(persona);
}

function PersonaSelect({ d, role, onRole }: { d: DepartmentSummary; role: string; onRole: (role: string) => void }) {
  const doc = useWorkflows();
  return (
    <select aria-label={D.persona} value={role} onChange={(e) => onRole(e.target.value)}>
      {d.personas.map((p) => (
        <option key={p} value={p}>
          {`${personaRnR(doc, d, p)} · ${profileOf(p).name}`}
        </option>
      ))}
    </select>
  );
}

function PersonaName({ d, role }: { d: DepartmentSummary; role: string }) {
  const doc = useWorkflows();
  return <span className="sh-user__role">{personaRnR(doc, d, role)}</span>;
}

export function DepartmentSwitcher({
  department,
  role,
  onDepartment,
  onRole,
}: {
  department: string;
  role: string;
  onDepartment: (dept: string) => void;
  onRole: (role: string) => void;
}) {
  const d = departmentById(department);
  const me = profileOf(role);
  return (
    <div className="sh-dept" data-department={d?.id ?? ALL_DEPARTMENTS}>
      <DepartmentSelect value={d?.id ?? ALL_DEPARTMENTS} onChange={onDepartment} />
      {!d && <DemoRoleSwitcher role={role} onChange={onRole} />}
      {d && (
        <div className="sh-user" title={`${me.name} · ${me.empNo} · ${me.org}`} data-demo-roles={DEMO_ROLES_MARKER}>
          <span className="sh-user__avatar" aria-hidden>
            {me.name.slice(0, 1)}
          </span>
          {d.personas.length > 1 ? <PersonaSelect d={d} role={role} onRole={onRole} /> : <PersonaName d={d} role={role} />}
        </div>
      )}
    </div>
  );
}
