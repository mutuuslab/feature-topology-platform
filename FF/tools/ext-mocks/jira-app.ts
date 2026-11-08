// JIRA 안의 FF 앱 흉내(80-50 §4.7·A6, D-ALM-8) — 실서버 형태(Forge·Connect)가 정해지기 전까지 모의 JIRA가 같은 FF 앱 API를 부르는 HTML 패널.
//   /_mock/app/epic-form?as=사용자[&key=FFE-1]  Epic 생성·편집 패널 "FF Feature": Feature DB 검색 → 대표·포함, 국가·차종·트림, ASIL, 담당 조직
//   /_mock/app/epic-view?as=사용자&key=FFE-1     Epic 보기 패널 "FF 현황"(작업 중·출시 버전·수명주기·게이트·산출물 작성률)
//   /_mock/app/api/*  → FF /api/alm/app/*(앱 자격 client credentials → Bearer, 요청마다 X-FF-Jira-User)
//   /_mock/app/save   → Epic 사용자 필드를 그 사람으로 쓴다(webhook으로 FF가 받아 같은 가드를 탄다 — 앱은 FF에 직접 쓰지 않는다)
// 환경: FF_APP_URL(기본 http://127.0.0.1:9101), FF_ALM_APP_CLIENT_ID·FF_ALM_APP_CLIENT_SECRET(FF와 같은 값, 기본 모의 값).
import type { Req, Res, Route } from './http.ts';

type Env = Record<string, string | undefined>;
export type FfFetch = (path: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; body: unknown }>;

export interface AppContext {
  env: Env;
  route: (method: string, path: string, handler: (r: Req) => Res | Promise<Res>) => Route;
  json: (status: number, body?: unknown, headers?: Record<string, string>) => Res;
  /** 이슈 만들기·고치기(모의 JIRA 안 — 같은 webhook) */
  createEpic: (fields: Record<string, unknown>, user: string) => { key: string };
  updateEpic: (key: string, fields: Record<string, unknown>, user: string) => void;
  fieldId: (name: string) => string;
  /** FF 호출 — 시험이 가로챈다 */
  ffFetch?: FfFetch;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const page = (title: string, body: string, script: string) =>
  `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:14px system-ui,sans-serif;margin:16px;max-width:720px}label{display:block;margin:8px 0}input,select{min-width:240px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}.err{color:#b00}</style></head><body>${body}<script>${script}</script></body></html>`;

export function appRoutes(ctx: AppContext): Route[] {
  const base = () => (ctx.env.FF_APP_URL ?? 'http://127.0.0.1:9101').replace(/\/$/, '');
  const ff: FfFetch =
    ctx.ffFetch ??
    (async (path, init) => {
      const r = await fetch(`${base()}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
      const text = await r.text();
      return { status: r.status, body: text ? JSON.parse(text) : null };
    });
  let token: { value: string; until: number } | null = null;
  const bearer = async () => {
    if (token && token.until > Date.now()) return token.value;
    const r = await ff('/api/alm/app/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', client_id: ctx.env.FF_ALM_APP_CLIENT_ID || 'ff-jira-app', client_secret: ctx.env.FF_ALM_APP_CLIENT_SECRET || 'ff-mock-app-secret' }) });
    const b = r.body as { access_token?: string; expires_in?: number } | null;
    if (r.status !== 200 || !b?.access_token) throw Object.assign(new Error('Feature Platform 앱 자격이 거부되었습니다'), { status: 502 });
    token = { value: b.access_token, until: Date.now() + ((b.expires_in ?? 3600) - 60) * 1000 };
    return token.value;
  };
  const proxy = (target: (r: Req) => string) => async (r: Req): Promise<Res> => {
    const as = r.query.get('as') ?? '';
    try {
      const out = await ff(target(r), { method: 'GET', headers: { authorization: `Bearer ${await bearer()}`, 'x-ff-jira-user': as } });
      return ctx.json(out.status, out.body);
    } catch (e) {
      return ctx.json((e as { status?: number }).status ?? 502, { message: e instanceof Error ? e.message : String(e) });
    }
  };
  const query = (r: Req, keep: string[]) => {
    const q = new URLSearchParams();
    for (const k of keep) if (r.query.get(k)) q.set(k, r.query.get(k)!);
    return q.size ? `?${q}` : '';
  };

  const formScript = `
const P=new URLSearchParams(location.search),as=P.get('as')||'',key=P.get('key')||'';
const $=(id)=>document.getElementById(id);const api=(p)=>fetch('/_mock/app/api/'+p+(p.includes('?')?'&':'?')+'as='+encodeURIComponent(as)).then(r=>r.json());
const picked=[];
function draw(){$('picked').textContent=picked.map((r,i)=>(i?'포함 ':'대표 ')+r).join(', ')||'—';}
$('q').addEventListener('input',async e=>{const r=await api('refs?limit=10&q='+encodeURIComponent(e.target.value));$('hits').innerHTML='';for(const x of r.items||[]){const b=document.createElement('button');b.type='button';b.textContent=x.refId+' '+(x.nameKo||x.name||'');b.onclick=()=>{if(!picked.includes(x.refId))picked.push(x.refId);draw();};$('hits').append(b);}});
api('reference-values').then(v=>{for(const [k,id] of [['country','country'],['vehicleModel','vehicleModel'],['trim','trim']])for(const x of v[k]||[]){const o=document.createElement('option');o.value=x.code;o.textContent=x.label+(x.parent?' ('+x.parent+')':'');$(id).append(o);}});
$('save').addEventListener('click',async()=>{const body={as,key:key||undefined,summary:$('summary').value,description:$('description').value,country:$('country').value,vehicleModel:$('vehicleModel').value,trim:$('trim').value,asil:$('asil').value,ownerId:$('ownerId').value,refIds:picked};const r=await fetch('/_mock/app/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();$('result').textContent=r.ok?'저장 — '+j.key:(j.message||'저장 실패');$('result').className=r.ok?'':'err';});
draw();`;
  const viewScript = `
const P=new URLSearchParams(location.search),as=P.get('as')||'',id=P.get('feature')||'';
fetch('/_mock/app/api/features/'+encodeURIComponent(id)+'/summary?as='+encodeURIComponent(as)).then(r=>r.json()).then(s=>{
const rows=[['Feature',s.featureId+' '+(s.name||'')],['적용 범위',s.scope],['작업 중 버전',s.workingVersion||'—'],['출시 버전',s.releaseVersion||'—'],['수명주기',s.lifecycle],['게이트',s.gates||'—'],['산출물',s.workProducts?s.workProducts.text+(s.workProducts.missing.length?' — 미완결 '+s.workProducts.missing.join(', '):''):'—']];
document.getElementById('summary').innerHTML=rows.map(r=>'<tr><th>'+r[0]+'</th><td>'+String(r[1]).replace(/</g,'&lt;')+'</td></tr>').join('');
if(s.link){const a=document.getElementById('open');a.href=s.link;a.hidden=false;}});`;

  return [
    ctx.route('GET', '/_mock/app/epic-form', () =>
      ctx.json(
        200,
        page(
          'FF Feature',
          `<h1>Feature Platform — FF Feature</h1>
<label>Epic 제목(= Feature 이름) <input id="summary"></label>
<label>설명 <input id="description"></label>
<fieldset><legend>Feature DB 기준 기능 (첫 번째가 대표)</legend><label>검색 <input id="q" placeholder="한·영 이름·별칭·ID"></label><div id="hits"></div><p>고른 기준 행: <span id="picked"></span></p></fieldset>
<label>국가 <select id="country"></select></label><label>차종 <select id="vehicleModel"></select></label><label>트림 <select id="trim"></select></label>
<label>ASIL <select id="asil"><option>QM</option><option>A</option><option>B</option><option>C</option><option>D</option></select></label>
<label>담당 조직 <input id="ownerId"></label>
<button id="save" type="button">저장</button> <span id="result" role="status"></span>`,
          formScript,
        ),
        { 'content-type': 'text/html;charset=UTF-8' },
      ),
    ),
    ctx.route('GET', '/_mock/app/epic-view', () => ctx.json(200, page('FF 현황', `<h1>Feature Platform — FF 현황</h1><table id="summary"></table><p><a id="open" hidden target="_blank">Feature Platform에서 열기</a></p>`, viewScript), { 'content-type': 'text/html;charset=UTF-8' })),
    ctx.route('GET', '/_mock/app/api/refs', proxy((r) => `/api/alm/app/refdb/refs${query(r, ['q', 'domain', 'component', 'status', 'offset', 'limit'])}`)),
    ctx.route('GET', '/_mock/app/api/reference-values', proxy(() => '/api/alm/app/reference-values')),
    ctx.route('GET', '/_mock/app/api/features/:id/summary', proxy((r) => `/api/alm/app/features/${encodeURIComponent(r.params.id)}/summary`)),
    // 저장 — 앱이 Epic 사용자 필드를 쓴다(그 사람으로). 필수 칸이 비면 JIRA 앱 화면 안에서 막는다
    ctx.route('POST', '/_mock/app/save', (r) => {
      const b = (r.body ?? {}) as Record<string, unknown>;
      const as = String(b.as ?? '').trim();
      const refIds = Array.isArray(b.refIds) ? b.refIds.map(String).filter(Boolean) : [];
      const need = (['country', 'vehicleModel', 'trim', 'asil', 'ownerId'] as const).filter((k) => !String(b[k] ?? '').trim());
      if (!as) return ctx.json(400, { message: 'JIRA 사용자가 없습니다' });
      if (!b.key && !String(b.summary ?? '').trim()) return ctx.json(400, { message: 'Epic 제목을 입력하세요' });
      if (!refIds.length) return ctx.json(400, { message: 'Feature DB 기준 기능을 하나 이상 고르세요(첫 번째가 대표)' });
      if (need.length) return ctx.json(400, { message: `빈 칸: ${need.join(', ')}` });
      const custom: Record<string, unknown> = {
        [ctx.fieldId('FF Country')]: String(b.country),
        [ctx.fieldId('FF Vehicle Model')]: String(b.vehicleModel),
        [ctx.fieldId('FF Trim')]: String(b.trim),
        [ctx.fieldId('ASIL')]: { value: String(b.asil) },
        [ctx.fieldId('FF Owner Team')]: String(b.ownerId),
        [ctx.fieldId('FF Feature DB')]: refIds,
      };
      try {
        if (b.key) {
          ctx.updateEpic(String(b.key), custom, as);
          return ctx.json(200, { key: String(b.key) });
        }
        const made = ctx.createEpic({ project: { key: ctx.env.JIRA_EPIC_PROJECT || 'FFE' }, issuetype: { name: 'Epic' }, summary: String(b.summary), description: String(b.description ?? ''), ...custom }, as);
        return ctx.json(201, made);
      } catch (e) {
        return ctx.json((e as { status?: number }).status ?? 500, { message: e instanceof Error ? e.message : String(e) });
      }
    }),
  ];
}
