// /notifications 알림 센터 — 받은 알림(안 읽음·범주 거르기, 읽음 처리, 관련 화면 열기) + 메일 알림 설정 + 모의 메일 발송 기록.
// 받는 사람 판정·제외(요청자·직무 분리)·메일 잠금(승인 요청·긴급 차단)은 서버와 같은 contracts 규칙(D04-04).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_LABEL, type NotificationCategory } from '@ff/contracts';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { usePlatformEvents } from '../../api/stream';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, ErrorNote, PageHeader, Panel, Segmented, Select } from '../../design';
import { NOTIFY_EVENTS, SeverityBadge, t16, type Inbox, type InboxItem } from '../../shell/NotificationBell';

const N = ko.notify;

interface Prefs {
  userId: string;
  email: Record<NotificationCategory, boolean>;
  locked: NotificationCategory[];
  address: string | null;
}
interface Email {
  id: string;
  notificationId: string;
  userId: string;
  address: string;
  subject: string;
  status: string;
  at: string;
}

function Row({ n, onRead, busy }: { n: InboxItem; onRead: () => void; busy: boolean }) {
  return (
    <li className="ntf-row" data-unread={!n.readAt || undefined} data-testid="notification-row">
      <div className="ntf-row__meta">
        <SeverityBadge value={n.severity} />
        <span className="ds-tag">{NOTIFICATION_CATEGORY_LABEL[n.category]}</span>
        <span className="ds-mono">{t16(n.createdAt)}</span>
        <span className="ntf-row__state">{n.readAt ? N.readAt(t16(n.readAt)) : N.unread}</span>
      </div>
      <strong className="ntf-row__title">{n.title}</strong>
      {n.fields.length > 0 && (
        <dl className="ntf-row__fields">
          {n.fields.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="ntf-row__actions">
        <Link className="ds-btn" to={n.link} onClick={() => !n.readAt && onRead()}>
          {N.open}
        </Link>
        {!n.readAt && (
          <Button variant="ghost" icon="check" disabled={busy} onClick={onRead}>
            {N.markRead}
          </Button>
        )}
      </div>
    </li>
  );
}

function EmailPrefs() {
  const q = useApi<Prefs>('notificationPrefs', {}, { enabled: !STATIC_MODE });
  const save = useApiMutation<Prefs>('saveNotificationPrefs', ['notificationPrefs']);
  const p = q.data;
  const toggle = (c: NotificationCategory, on: boolean) => p && save.mutate({ body: { email: { ...p.email, [c]: on } } });
  return (
    <Panel title={N.prefs.title} id="ntf-prefs">
      <p className="ntf-lead">{N.prefs.lead}</p>
      <AsyncView state={STATIC_MODE ? 'empty' : asyncState(q)} empty={{ body: N.staticNote }} onRetry={() => q.refetch()} rows={3}>
        {p && (
          <>
            <p>
              {N.prefs.address} <span className="ds-mono">{p.address ?? '—'}</span>
            </p>
            <ul className="ntf-prefs">
              {NOTIFICATION_CATEGORIES.map((c) => {
                const locked = p.locked.includes(c);
                return (
                  <li key={c}>
                    <label>
                      <input type="checkbox" checked={p.email[c]} disabled={locked || save.isPending} onChange={(e) => toggle(c, e.target.checked)} />
                      {NOTIFICATION_CATEGORY_LABEL[c]}
                    </label>
                    {locked && <span className="ds-tag">{N.prefs.locked}</span>}
                  </li>
                );
              })}
            </ul>
            {save.isSuccess && <p role="status">{N.prefs.saved}</p>}
            <ErrorNote error={save.error} />
          </>
        )}
      </AsyncView>
    </Panel>
  );
}

function EmailLog() {
  const q = useApi<{ items: Email[] }>('notificationEmails', {}, { enabled: !STATIC_MODE });
  usePlatformEvents(NOTIFY_EVENTS, ['notificationEmails']);
  const rows = q.data?.items ?? [];
  return (
    <Panel title={N.emails.title} id="ntf-emails">
      <p className="ntf-lead">{N.emails.lead}</p>
      <AsyncView state={STATIC_MODE ? 'empty' : asyncState(q, rows.length === 0)} empty={{ body: STATIC_MODE ? N.staticNote : N.emails.empty }} onRetry={() => q.refetch()} rows={3}>
        <DataTable
          caption={N.emails.title}
          rows={rows}
          rowKey={(r) => r.id}
          maxHeight="320px"
          columns={[
            { key: 'at', header: N.emails.col.at, cell: (r) => <span className="ds-mono">{t16(r.at)}</span>, sort: (r) => r.at },
            { key: 'subject', header: N.emails.col.subject, cell: (r) => r.subject },
            { key: 'status', header: N.emails.col.status, cell: (r) => r.status },
          ]}
        />
      </AsyncView>
    </Panel>
  );
}

export function NotificationsScreen() {
  const [view, setView] = useState<'unread' | 'all'>('unread');
  const [category, setCategory] = useState<NotificationCategory | ''>('');
  const query = { unread: view === 'unread' || undefined, category: category || undefined, limit: 200 };
  const q = useApi<Inbox>('notifications', { query }, { enabled: !STATIC_MODE });
  // 범주별 안 읽음 수와 전체 수는 거르지 않은 목록에서
  const totals = useApi<Inbox>('notifications', { query: { limit: 500 } }, { enabled: !STATIC_MODE });
  usePlatformEvents(NOTIFY_EVENTS, ['notifications']);
  const read = useApiMutation('readNotification', ['notifications']);
  const readAll = useApiMutation('readAllNotifications', ['notifications']);
  const items = q.data?.items ?? [];
  const unread = totals.data?.unread ?? 0;
  const byCategory = totals.data?.byCategory ?? {};

  return (
    <>
      <PageHeader
        codes={N.eyebrow}
        title={N.title}
        lead={N.lead}
        message={STATIC_MODE ? { tone: 'neutral', text: N.key.static } : !totals.data ? { tone: 'neutral', value: '—', text: N.key.unread } : unread ? { tone: 'warn', value: unread, text: N.key.unread } : { tone: 'ok', text: N.key.clear }}
        actions={
          <Button icon="check" disabled={STATIC_MODE || unread === 0 || readAll.isPending} onClick={() => readAll.mutate({ body: category ? { category } : {} })}>
            {N.markAll}
          </Button>
        }
      />
      <div className="ds-split">
        <Panel id="ntf-list">
          <div className="ntf-filters">
            <Segmented
              label={N.filterLabel}
              value={view}
              onChange={(v) => setView(v as 'unread' | 'all')}
              options={[
                { value: 'unread', label: N.unreadOnly },
                { value: 'all', label: N.all, count: totals.data?.items.length },
              ]}
            />
            <Select label={N.categoryLabel} value={category} onChange={(e) => setCategory(e.target.value as NotificationCategory | '')}>
              <option value="">{N.allCategories}</option>
              {NOTIFICATION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {NOTIFICATION_CATEGORY_LABEL[c]}
                  {byCategory[c] ? ` (${byCategory[c]})` : ''}
                </option>
              ))}
            </Select>
          </div>
          <ErrorNote error={read.error ?? readAll.error} />
          <AsyncView
            state={STATIC_MODE ? 'empty' : asyncState(q, items.length === 0)}
            empty={{ body: STATIC_MODE ? N.staticNote : view === 'unread' ? N.emptyUnread : N.empty }}
            onRetry={() => q.refetch()}
          >
            <ul className="ntf-list" aria-label={N.title}>
              {items.map((n) => (
                <Row key={n.notificationId} n={n} busy={read.isPending} onRead={() => read.mutate({ params: { id: n.notificationId } })} />
              ))}
            </ul>
          </AsyncView>
        </Panel>
        <div className="ntf-side">
          <EmailPrefs />
          <EmailLog />
        </div>
      </div>
    </>
  );
}
