// /notifications 알림 센터 — 받은 알림(안 읽음·범주 거르기, 읽음 처리, 관련 화면 열기)과 받는 방법 안내.
// 채널은 화면 알림만(사용자 결정 D-RD-7) — 끄는 설정이 없다. 받는 사람 판정·제외(요청자·직무 분리)는 서버와 같은 contracts 규칙(D04-04).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_LABEL, type NotificationCategory } from '@ff/contracts';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { usePlatformEvents } from '../../api/stream';
import { ko } from '../../copy/ko';
import { AsyncView, Button, ErrorNote, PageHeader, Panel, Segmented, Select } from '../../design';
import { NOTIFY_EVENTS, SeverityBadge, t16, type Inbox, type InboxItem } from '../../shell/NotificationBell';

const N = ko.notify;

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

/** 받는 방법 — 화면 알림만, 끄는 설정 없음(승인 요청·긴급 차단도 항상 남는다) */
function ChannelNote() {
  return (
    <Panel title={N.channel.title} id="ntf-channel">
      <p className="ntf-lead">{N.channel.lead}</p>
      <p className="ds-field__hint">{N.channel.note}</p>
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
          <ChannelNote />
        </div>
      </div>
    </>
  );
}
