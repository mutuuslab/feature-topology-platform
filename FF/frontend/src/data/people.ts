// 사람·시각 표시(담당자 E2E P1-5·P2-10) — 화면에 계정 ID(usr-*)를 그대로 보이지 않는다. 요청자·검토자·결정자·서명자·감사 행위자는
// 이름(부서·역할)으로, 시각은 모든 화면에서 같은 한국 시각(KST, YYYY-MM-DD HH:mm)으로 쓴다(서명 UTC ↔ 감사 KST가 어긋나던 결함).
// 데모 계정은 SPEC_ROLES(이름)·DEMO_PERSONAS(역할)·부서 모델(소속)에서 읽는다. 운영(SSO) 계정 ID는 그대로 둔다(usr-가 아니다).
import { DEMO_PERSONAS, ROLE_LABEL } from '@ff/contracts';
import { DEPARTMENTS } from './departments';
import { SPEC_ROLES } from './specNav';

export interface Person {
  id: string;
  /** 화면 이름 — 데모 계정은 사람 이름, 모르는 usr- 계정은 맡은 역할 이름 */
  name: string;
  /** 소속·역할 — 툴팁 */
  org: string;
  known: boolean;
}

const DEMO = 'usr-';

/** 계정 키(usr-author → author)의 부서 — 그 계정이 기본인 부서가 먼저 */
const deptOf = (key: string) => (DEPARTMENTS.departments.find((d) => d.personas[0] === key) ?? DEPARTMENTS.departments.find((d) => d.personas.includes(key)))?.name ?? null;

export function personOf(id: string | null | undefined): Person {
  const raw = (id ?? '').trim();
  if (!raw) return { id: '', name: '—', org: '', known: false };
  if (raw === 'system' || raw.startsWith('system:') || raw === 'SYSTEM') return { id: raw, name: '시스템(자동)', org: '', known: true };
  if (!raw.startsWith(DEMO)) return { id: raw, name: raw, org: '', known: false };
  const key = raw.slice(DEMO.length);
  const spec = SPEC_ROLES.find((r) => r.id === raw || r.key === key);
  const roles = DEMO_PERSONAS[key] ?? [];
  const roleText = spec?.label ?? (roles.length ? roles.map((r) => ROLE_LABEL[r]).join('·') : null);
  const dept = deptOf(key);
  const org = [dept, roleText].filter(Boolean).join(' · ');
  if (spec) return { id: raw, name: spec.name, org, known: true };
  // 데모 계정 표에 이름이 없는 usr- 계정 — 맡은 역할 이름으로(내부 ID를 보이지 않는다)
  return { id: raw, name: roleText ? `${roleText} 담당` : '담당자', org, known: false };
}

/** 표 칸·문장에 넣는 이름 — '김민영' */
export const personName = (id: string | null | undefined) => personOf(id).name;

/** 이름 + 소속 — '김민영 (상품기획팀 · Feature 설계)' */
export const personLabel = (id: string | null | undefined) => {
  const p = personOf(id);
  return p.org ? `${p.name} (${p.org})` : p.name;
};

/** 한국 시각 — 'YYYY-MM-DD HH:mm'. 서명·요청·감사 모두 이것으로(screens/shared when과 같은 규칙) */
export function localTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const k = new Date(d.getTime() + 9 * 3600_000).toISOString();
  return `${k.slice(0, 10)} ${k.slice(11, 16)}`;
}

const ISO = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})\b/g;
const USR = /\busr-[a-z0-9][a-z0-9._-]*/g;

/** 서버가 만든 문장(알림 내용 등) 속 계정 ID·ISO 시각을 사람 이름·한국 시각으로 */
export const humanText = (text: string) => text.replace(ISO, (m) => localTime(m)).replace(USR, (m) => personName(m));

/** 남은 시간 — 기한까지(음수면 지남). 분 단위로 짧게: '1시간 20분'·'35분' */
export function remaining(dueIso: string | null | undefined, now = Date.now()): { overdue: boolean; text: string; ms: number } | null {
  if (!dueIso) return null;
  const t = Date.parse(dueIso);
  if (Number.isNaN(t)) return null;
  const ms = t - now;
  const m = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  const text = d >= 2 ? `${d}일` : h ? `${h}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`;
  return { overdue: ms < 0, text, ms };
}
