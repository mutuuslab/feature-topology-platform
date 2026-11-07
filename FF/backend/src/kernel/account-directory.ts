// 계정 상태(F0, D-GAP-1) — 소유자 이관(B13)과 뒤 묶음의 소유자 인가가 읽는다. 판정은 @ff/contracts rules/owner-authz accountStateOf.
//  · 데모 인증: 데모 계정 표(DEMO_PERSONAS, usr-<계정>) 안이면 사용 중, 밖이면 없는 계정
//  · 회사 SSO: 로그인 기록(auth_session.sub)이 있으면 사용 중, 없으면 확인 불가(없는 계정으로 보지 않는다 — 이관하려면 먼저 비활성 기록)
//  · 비활성·재활성은 시스템 관리자가 사유와 함께 기록한다(account_status_change, 추가만·감사·이벤트). 로그인 차단은 전사 IAM이 맡는다
import { Inject, Injectable } from '@nestjs/common';
import { accountStateOf, demoAccountIds, DEMO_PERSONAS, type AccountState, type AccountStatusBody, type AccountView, type Role } from '@ff/contracts';
import type { Actor } from './actor';
import { AuditService } from './audit.service';
import { authModeOf } from './auth/auth-config';
import { Clock } from './clock';
import { DB, type Db } from './db';
import { DomainError } from './errors';
import { EventService } from './event.service';

const COMPONENT = 'D06-09';

interface ChangeRow {
  account_id: string;
  status: 'ACTIVE' | 'INACTIVE';
  by_actor: string;
  at: string;
  reason: string;
}

@Injectable()
export class AccountDirectory {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  private mode(): 'demo' | 'oidc' {
    return authModeOf() === 'oidc' ? 'oidc' : 'demo';
  }
  /** 계정마다 마지막 상태 기록 */
  private latest(): Map<string, ChangeRow> {
    const out = new Map<string, ChangeRow>();
    for (const r of this.db.all<ChangeRow>('SELECT account_id, status, by_actor, at, reason FROM account_status_change ORDER BY id')) out.set(r.account_id, r);
    return out;
  }
  private dir(ids: readonly string[]) {
    const inactiveIds = [...this.latest().values()].filter((r) => r.status === 'INACTIVE').map((r) => r.account_id);
    const seenIds = this.mode() === 'oidc' && ids.length ? this.db.all<{ sub: string }>(`SELECT DISTINCT sub FROM auth_session WHERE sub IN (${ids.map(() => '?').join(',')})`, ...ids).map((r) => r.sub) : [];
    return { personaIds: demoAccountIds(DEMO_PERSONAS), seenIds, inactiveIds };
  }

  state(id: string): AccountState {
    return accountStateOf(id, this.dir([id]), this.mode());
  }

  /** 그 계정이 맡는 플랫폼 역할 — 데모 인증은 데모 계정 표, 회사 SSO는 IdP가 정하므로 null */
  roles(id: string): Role[] | null {
    if (this.mode() === 'oidc') return null;
    const key = id.startsWith('usr-') ? id.slice(4) : '';
    return Object.prototype.hasOwnProperty.call(DEMO_PERSONAS, key) ? [...DEMO_PERSONAS[key]] : [];
  }

  /** 계정 목록 — 데모 계정 + 상태 기록이 있는 계정 */
  list(): AccountView[] {
    const latest = this.latest();
    const ids = [...new Set([...demoAccountIds(DEMO_PERSONAS), ...latest.keys()])];
    const dir = this.dir(ids);
    return ids.map((id) => {
      const r = latest.get(id);
      return { id, state: accountStateOf(id, dir, this.mode()), roles: this.roles(id), changedAt: r?.at ?? null, changedBy: r?.by_actor ?? null, reason: r?.reason ?? null };
    });
  }

  /** 비활성 기록(퇴사·전보) — 자기 계정은 안 된다, 이미 비활성이면 409 */
  deactivate(actor: Actor, id: string, body: AccountStatusBody): AccountView {
    return this.change(actor, id, 'INACTIVE', body.reason);
  }
  /** 재활성 — 비활성인 계정만 */
  reactivate(actor: Actor, id: string, body: AccountStatusBody): AccountView {
    return this.change(actor, id, 'ACTIVE', body.reason);
  }

  private change(actor: Actor, id: string, status: 'ACTIVE' | 'INACTIVE', reason: string): AccountView {
    const action = status === 'INACTIVE' ? 'ACCOUNT_DEACTIVATE' : 'ACCOUNT_REACTIVATE';
    const fail = (why: string, code: 'CONFLICT' | 'VALIDATION' = 'CONFLICT'): never => {
      this.audit.failed(actor, action, id, why, COMPONENT);
      throw new DomainError(code, why);
    };
    if (!/^[A-Za-z0-9._:@-]{1,120}$/.test(id)) fail('계정 ID 형식이 아닙니다', 'VALIDATION');
    if (id === actor.id) fail('자기 계정의 상태는 바꿀 수 없습니다 — 다른 시스템 관리자가 기록합니다');
    const before = this.state(id);
    if (status === 'INACTIVE' && before === 'INACTIVE') fail('이미 비활성인 계정입니다');
    if (status === 'ACTIVE' && before !== 'INACTIVE') fail('비활성인 계정만 다시 사용 중으로 바꿀 수 있습니다');
    const at = this.clock.iso();
    this.db.tx(() => {
      this.db.run('INSERT INTO account_status_change (account_id, status, by_actor, at, reason) VALUES (?, ?, ?, ?, ?)', id, status, actor.id, at, reason);
      this.audit.record(actor, action, id, { before: { state: before }, after: { state: status }, reason, componentId: COMPONENT });
      this.events.publish(status === 'INACTIVE' ? 'account.deactivated' : 'account.reactivated', id, { accountId: id, by: actor.id, reason }, { componentId: COMPONENT, correlationId: actor.correlationId });
    });
    return this.list().find((a) => a.id === id)!;
  }
}
