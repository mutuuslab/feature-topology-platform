import { permissionRoleLabels as ROLE_LABEL } from '../../data/refdata';
// /notifications/rules 알림 수신자 규칙(D04-04, 기능명세서 B1) — 이벤트별 기본 수신자(규칙, 끌 수 없음)와 추가 수신자(사람·역할·팀),
// 알림 직접 보내기. 기본 수신자·제외 규칙은 contracts NOTIFICATION_RULE_SPECS, 추가 수신자는 운영 리더·출시 담당이 사유와 함께 바꾼다(감사).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HUMAN_ROLES, NOTIFICATION_ACCOUNTS, NOTIFICATION_CATEGORY_LABEL, NOTIFICATION_RULE_EDITORS, NOTIFICATION_SENDERS, recipientTokenLabel, type NotificationRuleView, type Recipient, type Role } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { notifyRules as R } from '../../copy/records';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, PageHeader, Panel, Segmented, Select } from '../../design';
import { personName } from '../../data/people';
import { usePermission, when } from '../shared';

interface RulesResponse {
  items: NotificationRuleView[];
  teams: string[];
}

const keyOf = (r: Recipient) => (r.kind === 'user' ? `user:${r.id}` : r.kind === 'role' ? `role:${r.role}` : `team:${r.team}`);
/** 수신자 표시 — 사람은 이름(계정은 툴팁), 역할은 한글 이름, 팀은 팀 이름 */
export const recipientText = (r: Recipient) => (r.kind === 'user' ? personName(r.id) : r.kind === 'role' ? (ROLE_LABEL[r.role] ?? r.role) : r.team);

function RecipientChips({ items, onRemove }: { items: Recipient[]; onRemove?: (r: Recipient) => void }) {
  if (!items.length) return <span className="ds-field__hint">{onRemove ? R.picker.empty : R.addedNone}</span>;
  return (
    <span className="ds-chips">
      {items.map((r) => (
        <span key={keyOf(r)} className="ds-tag" title={keyOf(r)} data-recipient={keyOf(r)}>
          {R.picker.kinds[r.kind]} · {recipientText(r)}
          {onRemove && (
            <button type="button" className="ds-btn ds-btn--ghost" aria-label={R.picker.remove(recipientText(r))} onClick={() => onRemove(r)}>
              ×
            </button>
          )}
        </span>
      ))}
    </span>
  );
}

/** 받는 대상 고르기 — 사람(데모 계정)·역할(사람 역할)·팀(Feature Owner 팀) */
export function RecipientPicker({ value, onChange, teams }: { value: Recipient[]; onChange: (v: Recipient[]) => void; teams: string[] }) {
  const [kind, setKind] = useState<Recipient['kind']>('role');
  const [who, setWho] = useState('');
  const options: { value: string; label: string }[] =
    kind === 'user'
      ? NOTIFICATION_ACCOUNTS.map((a) => ({ value: a.id, label: personName(a.id) }))
      : kind === 'role'
        ? HUMAN_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))
        : teams.map((t) => ({ value: t, label: t }));
  const add = () => {
    if (!who) return;
    const r: Recipient = kind === 'user' ? { kind, id: who } : kind === 'role' ? { kind, role: who as Role } : { kind, team: who };
    if (!value.some((x) => keyOf(x) === keyOf(r))) onChange([...value, r]);
    setWho('');
  };
  return (
    <div className="ds-stack" data-testid="recipient-picker">
      <div className="ds-toolbar">
        <Segmented label={R.picker.kind} value={kind} onChange={(v) => (setKind(v as Recipient['kind']), setWho(''))} options={(['user', 'role', 'team'] as const).map((k) => ({ value: k, label: R.picker.kinds[k] }))} />
        <Select label={R.picker.who} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Button disabled={!who} onClick={add}>
          {R.picker.add}
        </Button>
      </div>
      <RecipientChips items={value} onRemove={(r) => onChange(value.filter((x) => keyOf(x) !== keyOf(r)))} />
    </div>
  );
}

function EditDrawer({ rule, teams, onClose }: { rule: NotificationRuleView | null; teams: string[]; onClose: () => void }) {
  const [list, setList] = useState<Recipient[]>([]);
  const [reason, setReason] = useState('');
  const [openFor, setOpenFor] = useState<string | null>(null);
  const save = useApiMutation<NotificationRuleView>('setNotificationRule', ['notificationRules', 'audit']);
  // 다른 규칙을 열면 그 규칙의 지금 추가 수신자로 시작한다
  if (rule && openFor !== rule.event) {
    setOpenFor(rule.event);
    setList(rule.added);
    setReason('');
  }
  const why = reason.trim().length < 2 ? ko.why.reason : undefined;
  return (
    <Drawer open={!!rule} title={rule ? R.editTitle(rule.name) : ''} onClose={onClose} dirty={!!rule && (reason.trim().length > 0 || list.length !== rule.added.length)}>
      {rule && (
        <div className="ds-stack">
          <p className="ds-field__hint">{R.editLead}</p>
          <RecipientPicker value={list} onChange={setList} teams={teams} />
          <Field label={R.reason}>
            <input className="ds-input" value={reason} placeholder={R.reasonPlaceholder} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorNote error={save.error} />
          <div>
            <Button variant="primary" disabled={!!why || save.isPending} reason={why} onClick={() => save.mutate({ params: { eventType: rule.event }, body: { recipients: list, reason: reason.trim() } }, { onSuccess: onClose })}>
              {R.save}
            </Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

/** 알림 직접 보내기 — 제목·내용·심각도·열 화면, 받는 대상 1곳 이상 */
function SendPanel({ teams }: { teams: string[] }) {
  const S = R.send;
  const perm = usePermission(NOTIFICATION_SENDERS);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<'INFO' | 'WARNING' | 'CRITICAL'>('INFO');
  const [link, setLink] = useState('');
  const [to, setTo] = useState<Recipient[]>([]);
  const send = useApiMutation<{ notificationId: string; recipients: Recipient[] }>('sendNotification', ['notifications', 'audit']);
  const why = !perm.ok ? perm.hint : title.trim().length < 2 || message.trim().length < 2 ? S.needText : !to.length ? S.needRecipient : undefined;
  return (
    <Panel title={S.title} id="ntf-send">
      <div className="ds-stack">
        <p className="ds-field__hint">{S.lead}</p>
        <Field label={S.subject}>
          <input className="ds-input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={S.message}>
          <textarea className="ds-input" rows={3} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <Segmented label={S.severity} value={severity} onChange={(v) => setSeverity(v as typeof severity)} options={(['INFO', 'WARNING', 'CRITICAL'] as const).map((s) => ({ value: s, label: ko.notify.severity[s] }))} />
        <Field label={S.link}>
          <input className="ds-input ds-input--mono" value={link} placeholder={S.linkPlaceholder} onChange={(e) => setLink(e.target.value)} />
        </Field>
        <RecipientPicker value={to} onChange={setTo} teams={teams} />
        <ErrorNote error={send.error} />
        {send.data && <p className="ds-field__hint" role="status">{S.sent(send.data.notificationId, send.data.recipients.length)}</p>}
        <div>
          <Button
            variant="primary"
            icon="bell"
            disabled={!!why || send.isPending}
            reason={why}
            onClick={() =>
              send.mutate(
                { body: { title: title.trim(), message: message.trim(), severity, recipients: to, ...(link.trim() ? { link: link.trim() } : {}) } },
                { onSuccess: () => (setTitle(''), setMessage(''), setLink(''), setTo([])) },
              )
            }
          >
            {S.submit}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

export function NotificationRulesScreen() {
  const q = useApi<RulesResponse>('notificationRules');
  const perm = usePermission(NOTIFICATION_RULE_EDITORS);
  const [edit, setEdit] = useState<NotificationRuleView | null>(null);
  const rows = q.data?.items ?? [];
  const teams = q.data?.teams ?? [];
  const added = rows.filter((r) => r.added.length).length;
  const C = R.col;
  return (
    <div className="ds-screen">
      <PageHeader
        codes={R.eyebrow}
        title={R.title}
        lead={R.lead}
        message={!q.data ? { tone: 'neutral', value: '—', text: R.keyNone } : added ? { tone: 'neutral', value: added, text: R.key(added) } : { tone: 'ok', text: R.keyNone }}
        actions={
          <Link className="ds-btn" to="/notifications">
            {R.toInbox}
          </Link>
        }
      />
      <div className="ds-split">
        <Panel title={R.table} id="ntf-rules">
          <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()}>
            <DataTable
              caption={R.table}
              rows={rows}
              rowKey={(r) => r.event}
              columns={[
                {
                  key: 'event',
                  header: C.event,
                  cell: (r) => (
                    <span className="ds-stack" data-event={r.event}>
                      <strong>{r.name}</strong>
                      {r.excludes && <span className="ds-field__hint">{R.excludes(r.excludes)}</span>}
                    </span>
                  ),
                  sort: (r) => r.name,
                },
                { key: 'cat', header: C.category, cell: (r) => <span className="ds-tag">{NOTIFICATION_CATEGORY_LABEL[r.category]}</span>, sort: (r) => r.category },
                { key: 'base', header: C.base, cell: (r) => <span className="ds-chips">{r.recipients.map((t) => <span key={t} className="ds-tag">{recipientTokenLabel(t)}</span>)}</span> },
                { key: 'added', header: C.added, cell: (r) => <RecipientChips items={r.added} /> },
                { key: 'upd', header: C.updated, cell: (r) => (r.updatedBy ? <span className="ds-nowrap" title={r.updatedBy}>{personName(r.updatedBy)} · {when(r.updatedAt)}</span> : R.addedNone) },
                {
                  key: 'act',
                  header: C.action,
                  srHeader: R.edit,
                  cell: (r) => (
                    <Button variant="ghost" icon="pen" disabled={!perm.ok || !!r.fixed} reason={r.fixed ? R.fixed : perm.hint} onClick={() => setEdit(r)}>
                      {R.edit}
                    </Button>
                  ),
                },
              ]}
            />
          </AsyncView>
        </Panel>
        <SendPanel teams={teams} />
      </div>
      <EditDrawer rule={edit} teams={teams} onClose={() => setEdit(null)} />
    </div>
  );
}
