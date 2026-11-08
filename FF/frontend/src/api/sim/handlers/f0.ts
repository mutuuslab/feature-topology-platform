// 시연 흐름 — 계정 상태 기록·컴플라이언스 룰 소유자 이관(F0, D-GAP-1·B13). 판정은 서버와 같은 contracts 규칙(ownerTransferBlocker)으로 한다.
// 병합 때 sim/index.ts HANDLERS 끝에 `() => import('./handlers/f0'),` 한 줄로 연결한다.
import { AccountStatusBody, COMPLIANCE_RULE_ROLES, DEMO_PERSONAS, ownerTransferBlocker, TransferOwnerBody, type AccountState, type AccountView, type ComplianceRuleDetail, type OwnerTransfer } from '@ff/contracts';
import { registerSimHandler, registerSimReader, registerSimView } from '../engine';
import type { SimReadContext, SimWriteContext } from '../types';

const ACC = 'f0Account';
const RULE = 'f0ComplianceRule';

async function accountsOf(ctx: SimReadContext): Promise<AccountView[]> {
  return (await ctx.read<{ items: AccountView[] }>('accounts').catch(() => ({ items: [] as AccountView[] }))).items;
}
async function stateOf(ctx: SimReadContext, id: string): Promise<AccountState> {
  const a = (await accountsOf(ctx)).find((x) => x.id === id);
  return a ? a.state : 'ABSENT';
}

async function changeAccount(ctx: SimWriteContext, status: 'ACTIVE' | 'INACTIVE') {
  const id = ctx.req.params.id;
  const action = status === 'INACTIVE' ? 'ACCOUNT_DEACTIVATE' : 'ACCOUNT_REACTIVATE';
  const reason = String(ctx.req.body.reason).trim();
  const fail = (why: string): never => ctx.fail('CONFLICT', why, undefined, { action, target: id, reason: why, componentId: 'D06-09' });
  if (id === ctx.actor.id) fail('자기 계정의 상태는 바꿀 수 없습니다 — 다른 시스템 관리자가 기록합니다');
  const before = await stateOf(ctx, id);
  if (status === 'INACTIVE' && before === 'INACTIVE') fail('이미 비활성인 계정입니다');
  if (status === 'ACTIVE' && before !== 'INACTIVE') fail('비활성인 계정만 다시 사용 중으로 바꿀 수 있습니다');
  const prev = (await accountsOf(ctx)).find((x) => x.id === id);
  const view: AccountView = { id, state: status, roles: prev?.roles ?? null, changedAt: ctx.iso(), changedBy: ctx.actor.id, reason };
  ctx.put(ACC, id, view);
  ctx.audit({ action, target: id, before: { state: before }, after: { state: status }, reason, componentId: 'D06-09' });
  ctx.emit(status === 'INACTIVE' ? 'account.deactivated' : 'account.reactivated', id, { accountId: id, by: ctx.actor.id, reason }, { componentId: 'D06-09' });
  return view;
}

registerSimHandler('deactivateAccount', (ctx) => changeAccount(ctx, 'INACTIVE'), { body: AccountStatusBody });
registerSimHandler('reactivateAccount', (ctx) => changeAccount(ctx, 'ACTIVE'), { body: AccountStatusBody });
registerSimView('accounts', { collection: ACC, idKey: 'id' });

registerSimHandler(
  'transferComplianceRuleOwner',
  async (ctx) => {
    const ruleId = ctx.req.params.id;
    const body = TransferOwnerBody.parse(ctx.req.body);
    const d = await ctx.read<ComplianceRuleDetail>('complianceRule', { id: ruleId });
    const ownerState = await stateOf(ctx, d.rule.ownerId);
    const toState = await stateOf(ctx, body.toOwnerId);
    const toRoles = DEMO_PERSONAS[body.toOwnerId.replace(/^usr-/, '')] ?? [];
    const why = ownerTransferBlocker({ ownerId: d.rule.ownerId, ownerState, toId: body.toOwnerId, toState, toRoles, allowedRoles: COMPLIANCE_RULE_ROLES, actorId: ctx.actor.id, actorRole: ctx.actor.role });
    if (why) ctx.fail('CONFLICT', why, undefined, { action: 'COMPLIANCE_RULE_OWNER_TRANSFER', target: ruleId, reason: why, componentId: 'D03-01' });
    const t: OwnerTransfer = { entity: 'compliance-rule', recordId: ruleId, fromOwnerId: d.rule.ownerId, fromState: ownerState, toOwnerId: body.toOwnerId, by: ctx.actor.id, at: ctx.iso(), reason: body.reason };
    const rule = { ...d.rule, ownerId: body.toOwnerId };
    ctx.put(RULE, ruleId, { ruleId, rule, ownerState: 'ACTIVE', ownerTransfers: [...(d.ownerTransfers ?? []), t] });
    ctx.audit({ action: 'COMPLIANCE_RULE_OWNER_TRANSFER', target: ruleId, before: { ownerId: d.rule.ownerId, ownerState }, after: { ownerId: body.toOwnerId }, reason: body.reason, componentId: 'D03-01' });
    ctx.emit('compliance.rule.owner-transferred', ruleId, { ruleId, from: d.rule.ownerId, to: body.toOwnerId, by: ctx.actor.id }, { componentId: 'D03-01' });
    return rule;
  },
  { body: TransferOwnerBody },
);
registerSimView('complianceRule', { collection: RULE, idKey: 'ruleId', detailParam: 'id' });

// Account records can change after the immutable rule snapshot was captured.
// Derive the displayed state for the current owner, retaining the full rule and transfer history.
registerSimReader('complianceRule', async (ctx) => {
  if (!ctx.list(ACC).length) return undefined;
  const base = await ctx.snapshot<ComplianceRuleDetail>();
  const local = ctx.get<ComplianceRuleDetail>(RULE, ctx.req.params.id);
  const detail = base ? { ...base, ...local } : local;
  const ownerId = detail?.rule?.ownerId;
  const account = ownerId ? ctx.get<AccountView>(ACC, ownerId) : undefined;
  return account ? { ...detail, ownerState: account.state } : undefined;
});
