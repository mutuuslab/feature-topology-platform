// Feature 상세 머리의 '다음 차례' 카드(담당자 E2E P1-6) — 지금 내가 할 일, 다음 담당 부서·역할, 막힌 조건 전부(기준 행 연결 포함).
// 전이 미리 보기(transitions)는 서버가 묻는 사람의 역할로 판정한다(featureDetail 행위자 헤더, P2-4). 버튼은 Lifecycle 칸에 있다.
import { DEMO_PERSONAS, GATE_META, ROLE_LABEL, type GateId, type Role } from '@ff/contracts';
import { nextTurn as N } from '../../copy/inbox';
import { DEPARTMENTS, departmentLabel } from '../../data/departments';
import { permissionRoleLabel } from '../../data/refdata';
import { roleCaptionFromSourceLabel, transitionCaption } from '../../data/contractCaptions';
import { contractCaptions } from '../../copy/contract-captions';
import { TransitionBlocker } from '../../design/server-explanation';
import { localeSnapshot } from '../../locale/runtime';
import { useUiLocale } from '../../locale/react';
import { KeyValue, Panel } from '../../design';
import { GATE_DEPTS } from '../home/queues';
import type { TransitionOption } from '../types';

const BY_LABEL = new Map((Object.keys(ROLE_LABEL) as Role[]).map((r) => [ROLE_LABEL[r], r] as const));

/** 플랫폼 역할 → 그 역할을 맡는 부서 이름(데모 계정 기준) */
export function deptsOfRole(role: Role): string[] {
  const personas = Object.keys(DEMO_PERSONAS).filter((k) => DEMO_PERSONAS[k].includes(role));
  return [...new Set(DEPARTMENTS.departments.filter((d) => d.personas.some((p) => personas.includes(p))).map((d) => departmentLabel(d,localeSnapshot().language)))];
}

const deptNames = (ids: readonly string[]) => ids.map((id) => { const d=DEPARTMENTS.departments.find(d=>d.id===id); return d ? departmentLabel(d,localeSnapshot().language) : id; });

/** 권한 때문에 못 하는가 — 역할·직무 분리 막힘 */
export const roleBlocker = (t: TransitionOption) => t.blockers.find((b) => b.code === 'ROLE' || b.code === 'SEPARATION_OF_DUTY') ?? null;

/** 다음 담당 — 사람이 하는 전이는 그 역할의 부서, 자동 전이는 막힌 Gate의 판정 부서 */
export function nextOwners(t: TransitionOption): string[] {
  if (!t.auto) {
    return t.roles.flatMap((label) => {
      const r = BY_LABEL.get(label);
      const ds = r ? deptsOfRole(r) : [];
      return [`${ds.length ? `${ds.join('·')} · ` : ''}${r ? permissionRoleLabel(r) : label}`];
    });
  }
  const gates = [...new Set(t.blockers.map((b) => b.ref).filter((x): x is GateId => !!x && x in GATE_META))];
  const out = gates.map((g) => `${deptNames(GATE_DEPTS[g]).join('·')} · ${g} ${contractCaptions.gateJudge[g]}`);
  if (t.blockers.some((b) => b.code === 'INPUT_MISSING' || b.code === 'REFDB_LINK_BLOCKED')) out.push(`${deptsOfRole('FEATURE_AUTHOR').join('·')} · ${permissionRoleLabel('FEATURE_AUTHOR')}`);
  return out;
}

/** 앞으로 가는 전이 하나(되돌림·사용 중단은 다음 차례가 아니다) */
const FORWARD = ['APPROVED', 'DEVELOPING', 'VERIFIED', 'RELEASED'];
export const forwardOf = (ts: readonly TransitionOption[]) => ts.find((t) => FORWARD.includes(t.to)) ?? ts[0] ?? null;

export function NextTurn({ transitions }: { transitions: TransitionOption[] }) {
  useUiLocale();
  const t = forwardOf(transitions);
  if (!t) {
    return (
      <Panel title={N.title} id="next-turn">
        <p className="ds-field__hint">{N.done}</p>
      </Panel>
    );
  }
  const role = roleBlocker(t);
  // 막힌 조건 — 권한·사유 입력은 따로 말한다(사유는 전이할 때 쓴다)
  const blockers = t.blockers.filter((b) => b.code !== 'ROLE' && b.code !== 'SEPARATION_OF_DUTY' && b.code !== 'REASON_REQUIRED');
  const owners = nextOwners(t);
  const mine = t.auto ? N.waitAuto(transitionCaption(t)) : role ? N.notMine(owners.join(', ') || t.roles.map(roleCaptionFromSourceLabel).join('·')) : blockers.length ? N.notMine(nextOwners({ ...t, auto: true }).join(', ') || t.roles.map(roleCaptionFromSourceLabel).join('·')) : N.canDo(transitionCaption(t));
  return (
    <Panel title={N.title} id="next-turn">
      <div data-next-turn={t.to} data-next-mine={!t.auto && !role && !blockers.length ? 'ready' : 'wait'}>
        <KeyValue
          rows={[
            { k: N.mine, v: role && !t.auto ? <>{mine} — <TransitionBlocker blocker={role}/></> : mine },
            { k: N.nextWho, v: owners.length ? owners.join(' / ') : t.roles.map(roleCaptionFromSourceLabel).join('·') },
            {
              k: N.blockers,
              v: blockers.length ? (
                <ul className="ds-check" data-next-blockers>
                  {blockers.map((b, i) => (
                    <li key={`${b.code}-${b.ref ?? i}`} data-state="FAIL">
                      {<TransitionBlocker blocker={b}/>}
                    </li>
                  ))}
                </ul>
              ) : (
                N.noBlockers
              ),
            },
          ]}
        />
      </div>
    </Panel>
  );
}
