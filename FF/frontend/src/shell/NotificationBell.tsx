// 상단바 알림 — 안 읽음 수 배지 + 최근 알림 펼침(최근 6건, 모두 읽음, 전체 보기). 플랫폼 이벤트가 오면 다시 읽는다.
// 받는 사람 판정은 서버(D04-04) — 이 계정(역할 전환기의 사람)이 개인·역할·Owner 팀으로 받는 알림만 온다.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isAppPath, NOTIFICATION_CATEGORY_LABEL, NOTIFICATION_EVENT_TYPES, type Notification } from '@ff/contracts';
import { STATIC_MODE } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import { usePlatformLiveEvents } from '../api/stream';
import { ko } from '../copy/ko';
import { Button, Icon } from '../design';
import { humanText, localTime } from '../data/people';

const N = ko.notify;
// 알림을 만드는 이벤트 목록 — 규칙표(NOTIFICATION_RULES)는 첫 화면에 싣지 않는다(contracts 시험이 두 목록을 맞춘다)
export const NOTIFY_EVENTS = [...NOTIFICATION_EVENT_TYPES];
export interface InboxItem extends Notification {
  readAt: string | null;
}
export interface Inbox {
  items: InboxItem[];
  unread: number;
  byCategory: Record<string, number>;
}
export const SEVERITY_VAR: Record<string, string> = { INFO: 'var(--info)', WARNING: 'var(--warn)', CRITICAL: 'var(--danger)' };
/** 알림 시각 — 한국 시각(다른 화면과 같은 표기, UTC로 보이던 결함 P1-5) */
export const t16 = (iso: string) => localTime(iso);

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
  const q = useApi<Inbox>('notifications', { query: { limit: 6 } });
  // 배지 색: 평소에는 중립(모든 화면에서 가장 진한 요소였다), 긴급 차단이 걸려 있을 때만 위험색(3초 테스트 UX3-10).
  // 상업 비활성화(체험 만료 등)는 긴급 차단이 아니다 — 내 대시보드 핵심 메시지와 같은 기준
  const kills = useApi<{ items: { reasonCategory?: string }[] }>('killRequests', { query: { status: 'ACTIVE' } });
  const alarm = (kills.data?.items ?? []).some((k) => k.reasonCategory !== 'COMMERCIAL');
  // 이력(이벤트 500건)은 쓰지 않는다 — 새 이벤트가 오면 다시 읽기만(모든 화면에 떠 있는 종이 이력을 받던 것)
  usePlatformLiveEvents(NOTIFY_EVENTS, ['notifications', 'killRequests']);
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
    // 정적 공개 사이트도 읽음은 이 브라우저의 시연 데이터에 남는다(20-60)
    if (!n.readAt) read.mutate({ params: { id: n.notificationId } });
    setOpen(false);
    // 앱 밖 주소로 저장된 링크는 알림함으로(열린 리다이렉트 차단)
    nav(isAppPath(n.link) ? n.link : '/notifications');
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
            <Button variant="ghost" disabled={unread === 0 || readAll.isPending} onClick={() => readAll.mutate({ body: {} })}>
              {N.markAll}
            </Button>
          </div>
          {!q.data ? null : q.data.items.length === 0 ? (
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
                    <span className="sh-ntf__title">{humanText(n.title)}</span>
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
