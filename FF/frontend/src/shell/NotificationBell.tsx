// 상단바 알림 — 안 읽음 수 배지 + 최근 알림 펼침(최근 6건, 모두 읽음, 전체 보기). 플랫폼 이벤트가 오면 다시 읽는다.
// 받는 사람 판정은 서버(D04-04) — 이 계정(역할 전환기의 사람)이 개인·역할·Owner 팀으로 받는 알림만 온다.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { NOTIFICATION_CATEGORY_LABEL, NOTIFICATION_RULES, type Notification } from '@ff/contracts';
import { STATIC_MODE } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import { usePlatformEvents } from '../api/stream';
import { ko } from '../copy/ko';
import { Button, Icon } from '../design';

const N = ko.notify;
export const NOTIFY_EVENTS = Object.keys(NOTIFICATION_RULES);
export interface InboxItem extends Notification {
  readAt: string | null;
}
export interface Inbox {
  items: InboxItem[];
  unread: number;
  byCategory: Record<string, number>;
}
export const SEVERITY_VAR: Record<string, string> = { INFO: 'var(--info)', WARNING: 'var(--warn)', CRITICAL: 'var(--danger)' };
export const t16 = (iso: string) => iso.slice(0, 16).replace('T', ' ');

export function SeverityBadge({ value }: { value: string }) {
  return (
    <span className="ds-badge" data-severity={value} style={{ '--c': SEVERITY_VAR[value] ?? 'var(--faint)' } as React.CSSProperties}>
      <Icon name={value === 'INFO' ? 'bell' : 'alert'} size={12} />
      <span className="ds-badge__ko">{N.severity[value] ?? value}</span>
    </span>
  );
}

export function NotificationBell() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const q = useApi<Inbox>('notifications', { query: { limit: 6 } }, { enabled: !STATIC_MODE });
  // 배지 색: 평소에는 중립(모든 화면에서 가장 진한 요소였다), 긴급 차단이 걸려 있을 때만 위험색(3초 테스트 UX3-10).
  // 상업 비활성화(체험 만료 등)는 긴급 차단이 아니다 — 내 대시보드 핵심 메시지와 같은 기준
  const kills = useApi<{ items: { reasonCategory?: string }[] }>('killRequests', { query: { status: 'ACTIVE' } }, { enabled: !STATIC_MODE });
  const alarm = (kills.data?.items ?? []).some((k) => k.reasonCategory !== 'COMMERCIAL');
  usePlatformEvents(NOTIFY_EVENTS, ['notifications', 'killRequests']);
  const read = useApiMutation('readNotification', ['notifications']);
  const readAll = useApiMutation('readAllNotifications', ['notifications']);
  const unread = q.data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const go = (n: InboxItem) => {
    if (!n.readAt) read.mutate({ params: { id: n.notificationId } });
    setOpen(false);
    nav(n.link);
  };

  return (
    <div className="sh-ntf" ref={root}>
      <Button variant="ghost" icon="bell" aria-label={ko.shell.notificationsUnread(unread)} title={ko.shell.notificationsUnread(unread)} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)} />
      {unread > 0 && (
        <span className="sh-ntf__badge" aria-hidden data-testid="notify-badge" data-alarm={alarm ? '' : undefined}>
          {unread > 99 ? '99+' : unread}
        </span>
      )}
      {open && (
        <div className="sh-ntf__pop" role="dialog" aria-label={N.popoverTitle}>
          <div className="sh-ntf__head">
            <strong>{N.popoverTitle}</strong>
            <Button variant="ghost" disabled={STATIC_MODE || unread === 0 || readAll.isPending} onClick={() => readAll.mutate({ body: {} })}>
              {N.markAll}
            </Button>
          </div>
          {STATIC_MODE ? (
            <p className="sh-ntf__empty">{N.staticNote}</p>
          ) : (q.data?.items ?? []).length === 0 ? (
            <p className="sh-ntf__empty">{N.empty}</p>
          ) : (
            <ul className="sh-ntf__list">
              {q.data!.items.map((n) => (
                <li key={n.notificationId} data-unread={!n.readAt || undefined}>
                  <button type="button" onClick={() => go(n)}>
                    <span className="sh-ntf__meta">
                      <SeverityBadge value={n.severity} />
                      <span className="ds-tag">{NOTIFICATION_CATEGORY_LABEL[n.category]}</span>
                      <span className="ds-mono">{t16(n.createdAt)}</span>
                    </span>
                    <span className="sh-ntf__title">{n.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link className="sh-ntf__all" to="/notifications" onClick={() => setOpen(false)}>
            {N.viewAll}
          </Link>
        </div>
      )}
    </div>
  );
}
