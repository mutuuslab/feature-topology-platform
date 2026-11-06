// 시연 흐름 — 알림 읽음(D04-04). 계정별 읽음은 이 브라우저에만 남는다(서버 notification_read와 같은 뜻)
import { accountOf, NotificationReadAllBody } from '@ff/contracts';
import { z } from 'zod';
import { registerSimHandler } from '../engine';

registerSimHandler('readNotification', async (ctx) => {
  const id = ctx.req.params.id;
  // 스냅샷은 화면이 쓰는 몇 가지 쪽 크기로만 있다 — 큰 쪽부터 찾는다
  let n: { notificationId: string; readAt: string | null; category: string } | undefined;
  for (const limit of [500, 200, 100, 6]) {
    const inbox = await ctx.read<{ items: { notificationId: string; readAt: string | null; category: string }[] }>('notifications', {}, { limit }).catch(() => ({ items: [] }));
    n = inbox.items.find((x) => x.notificationId === id);
    if (n) break;
  }
  if (!n) ctx.fail('NOT_FOUND', `${id} 알림을 찾을 수 없습니다(받는 사람이 아닙니다).`);
  if (!n!.readAt) {
    ctx.markRead([id]);
    ctx.state<Record<string, string>>('ntfCategory', () => ({}))[id] = n!.category;
  }
  return { notificationId: id, readAt: n!.readAt ?? ctx.iso() };
}, { body: z.object({}).strict() });

registerSimHandler('readAllNotifications', async (ctx) => {
  const category = ctx.req.body?.category as string | undefined;
  const ids = new Set<string>();
  const cats = ctx.state<Record<string, string>>('ntfCategory', () => ({}));
  for (const q of [{ unread: 'true', limit: 200, ...(category ? { category } : {}) }, { limit: 500 }, { limit: 200 }]) {
    const inbox = await ctx.read<{ items: { notificationId: string; readAt: string | null; category: string }[] }>('notifications', {}, q).catch(() => ({ items: [] }));
    for (const n of inbox.items) if (!n.readAt && (!category || n.category === category)) ids.add(n.notificationId);
    for (const n of inbox.items) cats[n.notificationId] = n.category;
  }
  ctx.markRead([...ids]);
  const scope = (ctx.state<Record<string, { all?: boolean; categories?: string[] }>>('ntfReadAll', () => ({}))[accountOf(ctx.actor.id, ctx.actor.role).id] ??= {});
  if (category) scope.categories = [...new Set([...(scope.categories ?? []), category])];
  else scope.all = true;
  return { read: ids.size };
}, { body: NotificationReadAllBody });
