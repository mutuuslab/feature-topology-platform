// 시연 흐름 — 알림 읽음(D04-04). 계정별 읽음은 이 브라우저에만 남는다(서버 notification_read와 같은 뜻)
import { accountOf, NotificationReadAllBody } from '@ff/contracts';
import { z } from 'zod';
import { pendingNotificationId, registerSimHandler, registerSimReader } from '../engine';

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


// Editable additions preserve mandatory native recipients and exclusions.
import { NOTIFICATION_ACCOUNTS, receives, recipientKey, type Recipient } from '@ff/contracts';
import { NOTIFICATION_RULE_SPECS, NOTIFICATION_SEND_LIMIT_PER_HOUR, NotificationRuleBody, NotificationSendBody } from '../../../../../contracts/src/rules/notification-rules';
import { NOTIFICATION_SENT_EVENT } from '../../../../../contracts/src/rules/notification-keys';
import type { SimReadContext, SimWriteContext } from '../types';
type RuleConfig={added:Recipient[];updatedBy:string|null;updatedAt:string|null};
const config=(ctx:SimReadContext)=>ctx.overlay.data.ntfRules as Record<string,RuleConfig>|undefined;
async function ruleView(ctx:SimReadContext){
 const original=await ctx.snapshot<any>('notificationRules'),native=new Map((original?.items??[]).map((r:any)=>[r.event,r]));
 const teams=new Set<string>(original?.teams??[]);
 const features=await ctx.read<any>('listFeatures',{}, {latestOnly:false});for(const f of features?.items??[])if(f.ownerId)teams.add(f.ownerId);
 const items=NOTIFICATION_RULE_SPECS.map(spec=>({...spec,...(native.get(spec.event) as any??{}),added:[],updatedBy:null,updatedAt:null,...config(ctx)?.[spec.event]}));
 return {items,teams:[...teams].sort()};
}
registerSimReader('notificationRules',ruleView);
async function validateTeams(ctx:SimWriteContext,recipients:Recipient[]){
 const teams=new Set((await ruleView(ctx)).teams);
 const unknown=recipients.filter((r):r is Extract<Recipient,{kind:'team'}>=>r.kind==='team').filter(r=>!teams.has(r.team));
 if(unknown.length)ctx.fail('VALIDATION','등록된 Feature Owner 팀이 아닙니다: '+unknown.map(r=>r.team).join(', '),{field:'recipients'});
}
registerSimHandler('setNotificationRule',async ctx=>{
 const event=ctx.req.params.eventType,body=ctx.req.body as NotificationRuleBody,spec=NOTIFICATION_RULE_SPECS.find(r=>r.event===event);
 if(!spec)ctx.fail('NOT_FOUND',event+' 알림 규칙을 찾을 수 없습니다.');
 if(spec!.fixed)ctx.fail('VALIDATION','직접 보낸 알림에는 추가 수신자를 둘 수 없습니다.',{field:'eventType'});
 await validateTeams(ctx,body.recipients);
 const all=ctx.state<Record<string,RuleConfig>>('ntfRules',()=>({})),before=all[event]?.added??[];
 const added=[...new Map(body.recipients.map(r=>[recipientKey(r),r])).values()].sort((a,b)=>recipientKey(a).localeCompare(recipientKey(b)));
 all[event]={added,updatedBy:ctx.actor.id,updatedAt:ctx.iso()};
 ctx.audit({action:'NOTIFICATION_RULE_UPDATE',target:event,before:{recipients:before.map(recipientKey)},after:{recipients:added.map(recipientKey)},reason:body.reason,componentId:'D04-04'});
 ctx.emit('notification.rule.updated',event,{eventType:event,recipients:added.map(recipientKey),by:ctx.actor.id,reason:body.reason});
 return {...spec,...all[event]};
},{body:NotificationRuleBody});
registerSimHandler('sendNotification',async ctx=>{
 const b=ctx.req.body as NotificationSendBody;await validateTeams(ctx,b.recipients);
 const recipients=[...new Map(b.recipients.map(r=>[recipientKey(r),r])).values()];
 if(!NOTIFICATION_ACCOUNTS.some(a=>receives({recipients,exclude:[ctx.actor.id]},a)))ctx.fail('VALIDATION','받을 사람이 없습니다. 다른 사람·역할·팀을 고르세요.',{field:'recipients'});
 const log=ctx.state<Record<string,string[]>>('ntfSendLog',()=>({})),since=ctx.now().getTime()-3600000;
 const old=(log[ctx.actor.id]??[]).filter(at=>Date.parse(at)>=since);
 if(old.length>=NOTIFICATION_SEND_LIMIT_PER_HOUR)ctx.fail('RATE_LIMITED','직접 보내기는 1시간에 '+NOTIFICATION_SEND_LIMIT_PER_HOUR+'건까지입니다.',{limit:NOTIFICATION_SEND_LIMIT_PER_HOUR,retryAfterSec:Math.max(1,Math.ceil((Date.parse(old[0])+3600000-ctx.now().getTime())/1000))});
 const ev=ctx.emit(NOTIFICATION_SENT_EVENT,'direct:'+ctx.actor.id,{...b,recipients,sentBy:ctx.actor.id},{componentId:'D04-04'});
 const notificationId=pendingNotificationId(ctx,ev.seq);
 if(!notificationId)ctx.fail('INTERNAL','알림 발송 기록을 만들지 못했습니다.');
 log[ctx.actor.id]=[...old,ctx.iso()];ctx.audit({action:'NOTIFICATION_SEND',target:notificationId,after:{title:b.title,recipients:recipients.map(recipientKey),eventSeq:ev.seq},componentId:'D04-04'});
 return {notificationId,recipients};
},{body:NotificationSendBody});
