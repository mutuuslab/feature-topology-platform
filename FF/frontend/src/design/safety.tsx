// 기능안전 부품 — 국제표준 대응방안 보고서 v1.1의 분류(5장)·비활성화(7장)·승인·원장(8장)·결과 코드(9장)를 화면마다 같은 모양으로 보여 준다.
// 색만으로 구분하지 않는다: 등급은 모양 글리프 + 텍스트, 판정은 StatusGlyph. 빨강은 위반(FAIL)에만 쓰고 막힘·대기는 warn.
import type { CSSProperties, ReactNode } from 'react';
import { reasonAction, reportRule, ROLE_LABEL, ROLES, type DeactClass, type DeactStage, type FClass, type FlagType, type RegClass, type RejectCode, type RequestResult } from '@ff/contracts';
import { ko } from '../copy/ko';
import { Icon, StatusGlyph } from './icons';

/** 역할 enum → 한글 라벨(원문은 툴팁) — 화면에 OPS_LEAD 같은 코드를 보이지 않는다(UX3-02) */
const roleLabel = (role: string) => ((ROLES as readonly string[]).includes(role) ? ROLE_LABEL[role as keyof typeof ROLE_LABEL] : role);

const S = ko.safety;

const ID_TOKEN = /(FFG-[A-Z]{3,4}-\d{3}|TC-FF-\d{2})/;
/** 괄호 안이 규칙·시험 ID뿐인 묶음 '(FFG-PLT-009·FFG-DEAC-010)', 또는 보고서 절·인터페이스·컴포넌트 번호뿐인 묶음 '(보고서 6.3.1)'·'(IF-11)' */
const ID_GROUP = /\s*\(((?:FFG-[A-Z]{3,4}-\d{3}|TC-FF-\d{2})(?:\s*[·,]\s*(?:FFG-[A-Z]{3,4}-\d{3}|TC-FF-\d{2}))*)\)|\s*\(((?:보고서 [A-Z0-9][\w.-]*|§[\d.]+|IF-\d{2}|D0\d-\d{2})(?:\s*[·,]\s*(?:[\d.]+|IF-\d{2}|D0\d-\d{2}))*)\)/;
/** 문장 앞에 붙은 규칙 ID 'FFG-CLS-006: …'(서버 거부 사유 형식) */
const ID_PREFIX = /^(FFG-[A-Z]{3,4}-\d{3}):\s*/;

/**
 * 문장 속 규칙·시험 ID를 고정폭·줄바꿈 금지로 — SUIT에서 0과 O가 비슷해 안전 ID를 잘못 읽지 않게.
 * explain: 괄호로 덧붙인 ID·절 번호 묶음은 본문에서 빼고 설명 모드 칩으로 — 3초 테스트 UX3-01(본문에 규칙 코드 없음)
 */
export function RuleText({ text, explain = false }: { text: string; explain?: boolean }) {
  if (explain) {
    const lead = text.match(ID_PREFIX);
    if (lead)
      return (
        <>
          <RuleText text={text.slice(lead[0].length)} explain />
          <Explain rules={[lead[1]]} />
        </>
      );
    const parts = text.split(ID_GROUP);
    const out: ReactNode[] = [];
    for (let i = 0; i < parts.length; i += 3) {
      if (parts[i]) out.push(<RuleText key={i} text={parts[i]} />);
      if (parts[i + 1]) out.push(<Explain key={`r${i}`} rules={parts[i + 1].split(/\s*[·,]\s*/)} />);
      if (parts[i + 2]) out.push(<ExplainCodes key={`c${i}`} codes={[parts[i + 2]]} />);
    }
    return <>{out}</>;
  }
  return (
    <>
      {text.split(ID_TOKEN).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="ds-rule-id">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

// ── 문장 속 추적 코드 분리(UX3-01 잔여, 2026-10-24) ─────────────
// 계약(contracts routes summary·SoD 규칙)의 문장은 OpenAPI·감사 문구라 그대로 둔다 — 화면에 그릴 때만 코드를 떼어 설명 모드로(screens/shared CodeFreeText).
// RuleText explain은 괄호 안이 ID뿐인 묶음만 뗀다. 여기서는 '(확정 후 불가, 규칙 ID)'·'IF-06 차량 …'·'… — 규칙 ID'·
// '규칙 ID·003·TEL-004'(같은 접두 줄임)처럼 문장에 섞인 코드까지 뗀다.
const C_RULE = String.raw`FFG-[A-Z]{3,4}-\d{3}`;
const C_HEAD = String.raw`${C_RULE}|IF-\d{2}(?:~\d{2})?|D0\d-\d{2}|보고서 \d[\d.]*(?:\s+[A-Z]\d+)?|§\d[\d.]*`;
const C_LIST = String.raw`(?:${C_HEAD})(?:\s*[·,]\s*(?:${C_HEAD}|(?:[A-Z]{3,4}-)?\d{3}))*`;
const C_START = new RegExp(String.raw`^(${C_LIST})(?:\s*[,—]\s*|\s+|$)`);
const C_END = new RegExp(String.raw`\s*[,—]\s*(${C_LIST})$`);

/** 문장 → 코드를 뗀 문장 + 규칙 ID(줄임은 앞 규칙의 접두로 펼친다) + 그 밖의 코드(IF·컴포넌트·보고서 절) */
export function splitCodes(text: string): { text: string; rules: string[]; codes: string[] } {
  const lists: string[] = [];
  const peel = (s: string) => {
    let t = s.trim();
    for (let m = t.match(C_START) ?? t.match(C_END); m; m = t.match(C_START) ?? t.match(C_END)) {
      lists.push(m[1]);
      t = (t.slice(0, m.index) + t.slice(m.index! + m[0].length)).trim();
    }
    return t;
  };
  const inParens = text.replace(/(\s*)\(([^()]*)\)/g, (all, ws: string, inner: string) => {
    const before = lists.length;
    const rest = peel(inner);
    if (lists.length === before) return all;
    return rest ? `${ws}(${rest})` : '';
  });
  const out = peel(inParens).replace(/\s{2,}/g, ' ');
  const rules: string[] = [];
  const codes: string[] = [];
  for (const list of lists) {
    let prefix = '';
    for (const atom of list.split(/\s*[·,]\s*/)) {
      const full = new RegExp(`^${C_RULE}$`).test(atom) ? atom : /^[A-Z]{3,4}-\d{3}$/.test(atom) ? `FFG-${atom}` : /^\d{3}$/.test(atom) && prefix ? `${prefix}-${atom}` : null;
      if (full) {
        prefix = full.slice(0, full.lastIndexOf('-'));
        if (!rules.includes(full)) rules.push(full);
      } else if (!codes.includes(atom)) codes.push(atom);
    }
  }
  return { text: out, rules, codes };
}

// ── 등급 배지 ─────────────────────────────────────────
/** 처리강도 F0~F4 — 다섯 칸 중 채운 칸 수로 강도를 보인다 */
function FGlyph({ f }: { f: FClass }) {
  const n = Number(f.slice(1));
  return (
    <svg className="ds-cls__glyph ds-cls__svg" width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={i * 4.4 + 0.3} y={6 - i * 1.4} width="3.4" height={4 + i * 1.4 - 0.3} rx="0.6" fill={i < n ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="0.9" />
      ))}
    </svg>
  );
}

/** 비활성화 등급 DC0~DC4 — 효력이 생기는 모양(즉시 낙하·대기 후 낙하·경사·전원 주기·잠금)을 작은 시간축으로 그린다 */
function DcGlyph({ dc }: { dc: DeactClass }) {
  if (dc === 'DC4') return <Icon name="lock" size={12} className="ds-cls__glyph" aria-hidden="true" />;
  const d = {
    DC0: 'M1 2H4V8H17',
    DC1: 'M1 2H10V8H17',
    DC2: 'M1 2H5L12 8H17',
    DC3: 'M1 2H7M11 8H17',
  }[dc];
  return (
    <svg className="ds-cls__glyph ds-cls__svg" width="18" height="10" viewBox="0 0 18 10" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {dc === 'DC3' && <circle cx="9" cy="5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.2" />}
    </svg>
  );
}

type ClassProps = { axis: 'F'; value: FClass } | { axis: 'DC'; value: DeactClass } | { axis: 'R'; value: RegClass } | { axis: 'TYPE'; value: FlagType };

/** 분류 한 축의 배지 — 읽기 전용 값(Registry가 원천). title·aria-label에 등급 의미를 붙인다 */
export function ClassBadge(p: ClassProps & { short?: boolean }) {
  const meaning = p.axis === 'F' ? S.f[p.value] : p.axis === 'DC' ? S.dc[p.value] : p.axis === 'R' ? S.r[p.value] : S.type[p.value];
  const axisName = p.axis === 'F' ? S.axis.f : p.axis === 'DC' ? S.axis.dc : p.axis === 'R' ? S.axis.r : S.axis.type;
  const locked = (p.axis === 'DC' && p.value === 'DC4') || (p.axis === 'R' && p.value === 'R2');
  const label = p.axis === 'TYPE' ? S.typeShort[p.value] : p.value;
  return (
    <span className="ds-cls" data-axis={p.axis} data-value={p.value} data-locked={locked || undefined} title={`${axisName} ${label} — ${meaning}`} aria-label={`${axisName} ${label}: ${meaning}`}>
      {p.axis === 'F' && <FGlyph f={p.value} />}
      {p.axis === 'DC' && <DcGlyph dc={p.value} />}
      {p.axis === 'R' && p.value === 'R2' && <Icon name="lock" size={12} className="ds-cls__glyph" aria-hidden="true" />}
      <span className="ds-cls__v">{label}</span>
      {!p.short && p.axis === 'DC' && <span className="ds-cls__ko">{S.dcShort[p.value]}</span>}
    </span>
  );
}

/** 네 축(F·DC·R·유형)을 한 줄로 — Feature 머리말·Kill 작성기·승인 Drawer에서 같은 순서 */
export function ClassBadges({ f, dc, r, type, short }: { f?: FClass | null; dc?: DeactClass | null; r?: RegClass | null; type?: FlagType | null; short?: boolean }) {
  return (
    <span className="ds-cls-row">
      {f && <ClassBadge axis="F" value={f} short={short} />}
      {dc && <ClassBadge axis="DC" value={dc} short={short} />}
      {r && <ClassBadge axis="R" value={r} short={short} />}
      {type && <ClassBadge axis="TYPE" value={type} short={short} />}
    </span>
  );
}

// ── 규칙 판정 목록 ─────────────────────────────────────
export type RuleStatus = 'pass' | 'fail' | 'pending' | 'na';
export interface RuleItem {
  id: string;
  title?: string;
  status: RuleStatus;
  reason?: ReactNode;
}
const RULE_GLYPH = {
  pass: 'PASS',
  fail: 'FAIL',
  pending: 'UNJUDGED',
  na: 'NA',
} as const;

/** FFG 규칙 판정 목록 — 게이트 미리보기·컴플라이언스·승인 Drawer 공용. live면 판정이 바뀔 때 읽어 준다 */
export function RuleChecklist({ items, caption = S.ruleList, live, onRule }: { items: RuleItem[]; caption?: ReactNode; live?: boolean; onRule?: (id: string) => void }) {
  const fail = items.filter((i) => i.status === 'fail').length;
  const pending = items.filter((i) => i.status === 'pending').length;
  return (
    <div className="ds-rules" data-fail={fail > 0 || undefined}>
      <div className="ds-rules__head">
        <span className="ds-eyebrow ds-eyebrow--ko">{caption}</span>
        <span className="ds-rules__sum" aria-live={live ? 'polite' : undefined}>
          {/* 빨강은 위반 건수에만 — 대기는 warn */}
          {fail > 0 && <span>{S.ruleFail(fail)}</span>}
          {fail > 0 && pending > 0 && ' · '}
          {pending > 0 && <span className="ds-rules__sum-pending">{S.rulePending(pending)}</span>}
          {!fail && !pending && S.ruleAllPass}
        </span>
      </div>
      <ul className="ds-rules__list">
        {items.map((it) => {
          const title = it.title ?? reportRule(it.id)?.title;
          return (
          <li key={it.id} className="ds-rules__item" data-status={it.status} data-titled={title ? '' : undefined}>
            <span
              className="ds-rules__mark"
              style={
                {
                  '--c': `var(--gate-${RULE_GLYPH[it.status] === 'NA' ? 'UNJUDGED' : RULE_GLYPH[it.status]})`,
                } as CSSProperties
              }
            >
              <StatusGlyph kind={RULE_GLYPH[it.status]} />
              <span className="ds-sr">{S.rule[it.status]}</span>
            </span>
            {/* 규칙 제목을 알면 ID는 설명 모드에서만(UX3-01) — 제목의 툴팁·설명 모드 칩으로 추적성은 남긴다 */}
            <span className={title ? 'ds-explain ds-rules__code' : 'ds-rules__code'}>
              {onRule ? (
                <button type="button" className="ds-rules__id" onClick={() => onRule(it.id)}>
                  {it.id}
                </button>
              ) : (
                <span className="ds-rules__id">{it.id}</span>
              )}
            </span>
            <span className="ds-rules__text">
              {title && (
                <span className="ds-rules__title" title={it.id}>
                  {title}
                </span>
              )}
              {it.reason && <span className="ds-rules__reason">{typeof it.reason === 'string' ? <RuleText text={it.reason} explain /> : it.reason}</span>}
            </span>
          </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── 비활성화 단계 줄 ─────────────────────────────────────
/** 구간 길이 표기 — 1분 이상은 분·시간으로 */
export function fmtDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${+(s / 3600).toFixed(1)} h`;
}

const STAGE_GLYPH = {
  done: 'PASS',
  current: 'REVIEW',
  todo: 'UNJUDGED',
} as const;

/**
 * DC별 단계(rules/deactivation) 진행 — current는 stageIndexOf 결과. -1이면 UNKNOWN 안내(확인 전에는 비활성으로 보지 않는다).
 * 진행은 위 테두리 색 + 글리프 + 번호로 함께 보인다(색만으로 구분하지 않음). 열은 최대 단계 수에 맞춰 줄마다 정렬된다.
 */
export function StageStrip({
  stages,
  current,
  params,
  caption,
}: {
  stages: DeactStage[];
  current: number;
  params?: Partial<Record<NonNullable<DeactStage['durationKey']>, number>>;
  caption?: string;
}) {
  return (
    <div className="ds-stages">
      <ol className="ds-stages__list" aria-label={caption}>
        {stages.map((s, i) => {
          const status = current < 0 ? 'todo' : i < current ? 'done' : i === current ? 'current' : 'todo';
          const ms = s.durationKey ? params?.[s.durationKey] : undefined;
          return (
            <li key={s.id} className="ds-stages__step" data-status={status} data-stage={s.id} aria-current={status === 'current' ? 'step' : undefined}>
              <span className="ds-stages__label">
                {s.id === 'REJECTED' ? <Icon name="lock" size={12} aria-hidden="true" /> : <StatusGlyph kind={STAGE_GLYPH[status]} />}
                <span className="ds-stages__no">
                  {i + 1}/{stages.length}
                </span>
                {S.stage[s.id]}
              </span>
              <span className="ds-stages__meta">
                <span className="ds-stages__tok">{s.state ?? '—'}</span>
                {ms !== undefined && <span className="ds-stages__tok">{` · ${fmtDuration(ms)}`}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {current < 0 ? (
        <p className="ds-stages__unknown" role="status">
          <StatusGlyph kind="UNJUDGED" /> {S.stageUnknown}
        </p>
      ) : (
        <span className="ds-sr">{S.stageOf(current + 1, stages.length)}</span>
      )}
    </div>
  );
}

// ── 승인 칸 ─────────────────────────────────────────────
export interface ApprovalSlot {
  role: string;
  approver?: { id: string; name?: string; signedAt: string } | null;
  /** 서명 대기 시작 시각 — 대기 타이머 */
  waitingSince?: string | null;
  /** 이 칸을 채울 수 없는 이유(직무 분리 등) */
  blocked?: ReactNode;
}

function elapsed(from: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(from)) / 1000));
  // 1시간 이상은 시·분으로(승인 대기가 길어지면 mm:ss는 읽기 어렵다)
  if (s >= 3600) return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분`;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 요청자 1 + 승인 칸(보통 2) — 요청자는 승인할 수 없음(FFG-PLT-016), 승인마다 개인 서명(FFG-PLT-005) */
export function ApprovalSlots({ requester, slots, now = Date.now() }: { requester: { id: string; name?: string }; slots: ApprovalSlot[]; now?: number }) {
  return (
    <div className="ds-approvals-wrap">
      <div className="ds-approvals">
        <div className="ds-approvals__req">
          <span className="ds-eyebrow ds-eyebrow--ko">{S.requester}</span>
          <span className={requester.name ? 'ds-approvals__who' : 'ds-approvals__who ds-rule-id'}>{requester.name ?? requester.id}</span>
          <span className="ds-field__hint">
            <RuleText text={S.requesterNote} explain />
          </span>
        </div>
        <ol className="ds-approvals__slots" aria-label={S.approvals}>
          {slots.map((s, i) => {
            const done = !!s.approver;
            return (
              <li key={i} className="ds-approvals__slot" data-done={done || undefined} data-blocked={(!done && !!s.blocked) || undefined}>
                <span className="ds-eyebrow ds-eyebrow--ko">
                  {S.approver(i + 1)} · <span className="ds-approvals__role" title={s.role}>{roleLabel(s.role)}</span>
                </span>
                {done ? (
                  <>
                    <span className="ds-approvals__who">
                      <Icon name="pen" size={14} aria-hidden="true" /> {s.approver!.name ?? s.approver!.id}
                    </span>
                    <span className="ds-field__hint">
                      {S.signed} · <span className="ds-mono">{s.approver!.signedAt.slice(11, 19)}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="ds-approvals__who ds-approvals__who--empty">
                      <StatusGlyph kind={s.blocked ? 'REVIEW' : 'UNJUDGED'} /> {S.needRole(roleLabel(s.role))}
                    </span>
                    <span className="ds-field__hint">
                      {typeof s.blocked === 'string' ? (
                        <RuleText text={s.blocked} explain />
                      ) : (
                        (s.blocked ?? (s.waitingSince ? <span className="ds-rule-id">{S.waitFor(elapsed(s.waitingSince, now))}</span> : S.waiting))
                      )}
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

// ── 누적 상한 게이지 ───────────────────────────────────
/** 24시간 이동 창 누적 대상 차량 대비 상한(FFG-SEC-003) — 이미 쓴 몫 + 이번 요청 몫 */
export function WindowGauge({ used, adding, cap }: { used: number; adding: number; cap: number }) {
  const total = used + adding;
  const over = total > cap;
  const pct = (n: number) => `${Math.min(100, cap > 0 ? (n / cap) * 100 : 100)}%`;
  return (
    <div className="ds-window" data-over={over || undefined}>
      <div className="ds-window__head">
        <span className="ds-eyebrow ds-eyebrow--ko">{S.window}</span>
        <span className="ds-mono">{S.windowValue(used, adding, cap)}</span>
      </div>
      <div className="ds-window__track" role="meter" aria-label={S.window} aria-valuemin={0} aria-valuemax={cap} aria-valuenow={Math.min(total, cap)} aria-valuetext={S.windowValue(used, adding, cap)}>
        <span className="ds-window__used" style={{ width: pct(used) }} />
        <span
          className="ds-window__add"
          data-some={adding > 0 || undefined}
          style={{
            left: pct(used),
            width: `calc(${pct(total)} - ${pct(used)})`,
          }}
        />
      </div>
      {over && (
        <p className="ds-window__over" role="status">
          <StatusGlyph kind="REVIEW" />
          <span>
            <RuleText text={S.windowOver} explain />
          </span>
        </p>
      )}
    </div>
  );
}

// ── 감사 해시 체인 ─────────────────────────────────────
/** 추가 전용·해시 연결 감사 이력의 무결성(FFG-PLT-015) */
export function ChainStatus({ ok, verified, head }: { ok: boolean; verified: number; head?: string }) {
  return (
    <span className="ds-badge ds-chain-status" data-ok={ok} style={{ '--c': ok ? 'var(--ok)' : 'var(--danger)' } as CSSProperties}>
      <StatusGlyph kind={ok ? 'PASS' : 'FAIL'} />
      <span className="ds-badge__ko">{ok ? S.chain.ok : S.chain.broken}</span>
      <span className="ds-badge__ko">{S.chain.verified(verified)}</span>
      {head && (
        <span className="ds-mono" title={`${S.chain.head} ${head}`}>
          {head.slice(0, 10)}…
        </span>
      )}
    </span>
  );
}

// ── 결과 코드 → 조치 ───────────────────────────────────
/** 차량 회신(요청 결과·거부 코드)을 운영자가 할 일로 바꿔 보여 준다(보고서 9.3) */
export function ReasonActionNote({ result, code }: { result: RequestResult; code?: RejectCode | null }) {
  const a = reasonAction(result, code ?? 'NONE');
  const refused = a.kind === 'REPORT_ONLY';
  const tone = a.kind === 'APPLIED' ? 'ok' : a.security || refused ? 'warn' : a.kind === 'DISCARD_UNKNOWN' ? 'faint' : 'info';
  return (
    <span className="ds-raction" data-kind={a.kind} style={{ '--c': `var(--${tone})` } as CSSProperties}>
      <span className="ds-raction__mark">
        {a.security ? (
          <Icon name="shield" size={13} aria-hidden="true" />
        ) : (
          <StatusGlyph kind={a.kind === 'APPLIED' ? 'PASS' : refused ? 'REVIEW' : a.kind === 'DISCARD_UNKNOWN' ? 'NA' : 'UNJUDGED'} />
        )}
      </span>
      <span className="ds-rule-id ds-raction__code">{code && code !== 'NONE' ? code : result}</span>
      <span className="ds-raction__text">{S.action[a.kind]}</span>
    </span>
  );
}

// ── 근거 조항 칩 ───────────────────────────────────────
/** 표준 조항·FFG 규칙 ID 칩 — 누르면 원문 요약(따라하기 가이드 패널·표준 설명 모드) */
export function ClauseChip({ id, title, onOpen }: { id: string; title?: string; onOpen?: (id: string) => void }) {
  const body = (
    <>
      <Icon name="book" size={12} aria-hidden="true" />
      <span className="ds-mono">{id}</span>
    </>
  );
  return onOpen ? (
    <button type="button" className="ds-clause" title={title} aria-label={S.clauseOpen(id)} onClick={() => onOpen(id)}>
      {body}
    </button>
  ) : (
    <span className="ds-clause" title={title}>
      {body}
    </span>
  );
}

// ── 표준 설명 모드 ─────────────────────────────────────
/** 규칙 상세 열기 — 표준 설명 칩·따라하기 가이드 어디서든 셸의 같은 규칙 Drawer가 받는다 */
export const RULE_EVENT = 'ff:rule-open';
export const openRule = (id: string) => window.dispatchEvent(new CustomEvent(RULE_EVENT, { detail: id }));

/** 화면 요소 옆의 근거 규칙 칩 — 표준 설명 모드(html[data-explain='on'])에서만 보인다. 꺼져 있으면 접근성 트리에서도 빠진다 */
export function Explain({ rules }: { rules: readonly string[] }) {
  return (
    <span className="ds-explain" data-explain-rules={rules.join(' ')}>
      {rules.map((id) => (
        <ClauseChip key={id} id={id} title={reportRule(id)?.title} onOpen={openRule} />
      ))}
    </span>
  );
}

/** 규칙이 아닌 추적 코드(컴포넌트 D0x-xx·인터페이스 IF-xx·시나리오 ID) — 설명 모드에서만 보인다(UX3-01) */
export function ExplainCodes({ codes }: { codes: readonly string[] }) {
  return (
    <span className="ds-explain" data-explain-codes={codes.join(' ')}>
      {codes.map((c) => (
        <span key={c} className="ds-explain__code">
          {c}
        </span>
      ))}
    </span>
  );
}
