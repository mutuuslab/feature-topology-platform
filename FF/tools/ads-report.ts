// ADS·UNECE 보고서 v3.0 반영 보고서 생성 — harness/ads/{catalog,review,design}.json → docs/10-requirements/ads-unece-v3/report.html(단일 파일) + BACKLOG.md ADS 절
//   node tools/ads-report.ts          생성
//   node tools/ads-report.ts --check  설계 무결성(계획 ID·요구 ID 실재) + 생성물이 최신인지 검사 (verify 'ads' 단계)
// 원본 영문 발췌는 싣지 않는다. 판정 근거는 review.json(코드 경로·줄)이다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FF, readJson } from './lib.ts';
import { CATALOG, REVIEW, OUT, type AdsCatalog, type AdsReview } from './ads-sync.ts';

export const DESIGN = join(OUT, 'design.json');
export const HTML = join(FF, '..', 'docs', '10-requirements', 'ads-unece-v3', 'report.html');
export const BACKLOG = join(FF, 'BACKLOG.md');
const BEGIN = '<!-- ads:begin (tools/ads-report.ts가 harness/ads/design.json에서 생성 — 직접 고치지 말 것) -->';
const END = '<!-- ads:end -->';

interface Item {
  id: string;
  priority: string;
  layer: string;
  title: string;
  defect?: boolean;
  req: string[];
  ui: string[];
  fe: string[];
  be: string[];
  db: string[];
  api: string[];
  tests: string[];
  deps: string[];
  coord: string;
}
export interface Design {
  title: string;
  date: string;
  principles: { id: string; text: string; apply: string }[];
  stateModel: { layers: { name: string; values: string[]; source: string }[]; example: string };
  integration: { session: string; overlap: string; action: string }[];
  items: Item[];
  decisions: { id: string; question: string; why: string; proposal: string }[];
  phases: { phase: string; items: string[]; exit: string }[];
  dbTables: { name: string; items: string[]; columns: string; note: string }[];
}

/** 설계가 판정·카탈로그와 맞물리는지 — 계획 ID 실재, 요구 ID 실재, 미구현·부분 요건은 모두 어떤 항목이 맡는다 */
export function designProblems(c: AdsCatalog, r: AdsReview, d: Design): string[] {
  const p: string[] = [];
  const ids = new Set(d.items.map((i) => i.id));
  const reqs = new Set(c.requirements.map((x) => x.id));
  if (ids.size !== d.items.length) p.push('설계 항목 ID 중복');
  const plans = [...Object.entries(r.requirements), ...Object.entries(r.tests), ...Object.entries(r.scenarios)];
  for (const [k, v] of plans) for (const id of v.plan) if (!ids.has(id)) p.push(`${k}의 계획 ${id}가 설계에 없음`);
  for (const i of d.items) {
    for (const q of i.req) if (!reqs.has(q)) p.push(`${i.id}가 없는 요건 ${q}를 가리킴`);
    for (const dep of i.deps) if (!ids.has(dep)) p.push(`${i.id}의 선행 ${dep}가 없음`);
  }
  const phased = new Set(d.phases.flatMap((x) => x.items));
  for (const i of d.items) if (!phased.has(i.id)) p.push(`${i.id}가 어느 단계에도 없음`);
  return p;
}

// ── HTML ──
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const VERDICT = {
  구현: { cls: 'v-ok', icon: '✓' },
  부분: { cls: 'v-part', icon: '◐' },
  미구현: { cls: 'v-miss', icon: '✗' },
  '범위 밖': { cls: 'v-out', icon: '—' },
} as const;
type V = keyof typeof VERDICT;
const ORDER: V[] = ['구현', '부분', '미구현', '범위 밖'];
const badge = (v: V) => `<span class="badge ${VERDICT[v].cls}"><span aria-hidden="true">${VERDICT[v].icon}</span> ${v}</span>`;
const TSTAT: Record<string, string> = { '자동 시험 있음': 'v-ok', 일부: 'v-part', 없음: 'v-miss' };
const link = (id: string) => `<a href="#${esc(id)}">${esc(id)}</a>`;
const list = (xs: string[]) => (xs.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');

/** 한 줄 누적 막대 — 숫자 라벨, 2px 간격, 색 + 글자(범례)로 판정을 구분 */
function stack(label: string, counts: Record<V, number>, total: number): string {
  const segs = ORDER.filter((v) => counts[v])
    .map((v) => {
      const w = (counts[v] / total) * 100;
      return `<span class="seg ${VERDICT[v].cls}" style="width:${w.toFixed(3)}%" title="${v} ${counts[v]}">${w >= 7 ? counts[v] : ''}</span>`;
    })
    .join('');
  const text = ORDER.filter((v) => counts[v]).map((v) => `${v} ${counts[v]}`).join(' · ');
  // 좁은 칸은 숫자를 막대 안에 넣지 못하므로 오른쪽에 모든 칸의 수를 기호와 함께 적는다(색만으로 구분하지 않음)
  const tail = ORDER.filter((v) => counts[v]).map((v) => `${VERDICT[v].icon}${counts[v]}`).join(' ');
  return `<div class="bar-row"><div class="bar-label">${esc(label)} <span class="sub">${total}</span></div><div class="bar" role="img" aria-label="${esc(`${label}: ${text}`)}">${segs}</div><div class="bar-total">${tail}</div></div>`;
}
function tally(ids: string[], r: AdsReview): Record<V, number> {
  const t = { 구현: 0, 부분: 0, 미구현: 0, '범위 밖': 0 } as Record<V, number>;
  for (const id of ids) t[r.requirements[id].verdict as V]++;
  return t;
}

export function renderHtml(c: AdsCatalog, r: AdsReview, d: Design): string {
  const reqIds = c.requirements.map((x) => x.id);
  const all = tally(reqIds, r);
  const cats = [...new Set(c.requirements.map((x) => x.category))];
  const byCat = cats.map((k) => stack(k, tally(c.requirements.filter((x) => x.category === k).map((x) => x.id), r), c.requirements.filter((x) => x.category === k).length)).join('');
  const byPri = ['P0', 'P1'].map((k) => stack(k, tally(c.requirements.filter((x) => x.priority === k).map((x) => x.id), r), c.requirements.filter((x) => x.priority === k).length)).join('');
  const owners = [...new Set(c.requirements.map((x) => x.owner))];
  const byOwner = owners.map((k) => stack(`담당 ${k}`, tally(c.requirements.filter((x) => x.owner === k).map((x) => x.id), r), c.requirements.filter((x) => x.owner === k).length)).join('');
  const tcount = (s: string) => Object.values(r.tests).filter((t) => t.status === s).length;
  const defects = c.requirements.filter((x) => (r.requirements[x.id] as { defect?: boolean }).defect);
  const missing = c.requirements.filter((x) => r.requirements[x.id].verdict === '미구현');
  const itemsById = new Map(d.items.map((i) => [i.id, i]));

  const reqRows = c.requirements
    .map((q) => {
      const v = r.requirements[q.id];
      return `<tr data-cat="${esc(q.category)}" data-pri="${q.priority}" data-owner="${esc(q.owner)}" data-verdict="${esc(v.verdict)}" id="${q.id}">
<td class="mono nw">${q.id}</td><td><b>${esc(q.title)}</b><div class="sub">${esc(q.content)}</div><div class="sub"><b>합격 조건</b> ${esc(q.acceptance)}</div><div class="sub">근거 ${esc(q.basis)} · 시험 ${q.tests.map(link).join(', ')}</div></td>
<td class="cat">${esc(q.category)}</td><td class="nw">${q.priority}</td><td class="nw">${esc(q.owner)}</td><td class="nw">${badge(v.verdict as V)}${(v as { defect?: boolean }).defect ? '<div class="defect">결함</div>' : ''}</td>
<td>${esc(v.gap)}${v.evidence.length ? `<details><summary>근거 ${v.evidence.length}</summary>${v.evidence.map((e) => `<code>${esc(e)}</code>`).join('<br>')}${v.rules?.length ? `<div class="sub">관련 규칙 ${esc(v.rules.join(', '))}</div>` : ''}</details>` : ''}</td>
<td class="nw mono">${v.plan.map(link).join('<br>') || '—'}</td></tr>`;
    })
    .join('\n');

  const testRows = c.tests
    .map((t) => {
      const x = r.tests[t.id];
      return `<tr id="${t.id}"><td class="mono">${t.id}</td><td><b>${esc(t.name)}</b><div class="sub">입력: ${esc(t.input)}</div><div class="sub">기대: ${esc(t.expected)}</div></td><td>${t.requirements.map(link).join(', ')}</td>
<td><span class="badge ${TSTAT[x.status]}">${esc(x.status)}</span></td><td>${x.evidence.map((e) => `<code>${esc(e)}</code>`).join('<br>') || '—'}</td><td>${x.plan.map(link).join('<br>') || '—'}</td></tr>`;
    })
    .join('\n');

  const scenarioCards = c.scenarios
    .map((s) => {
      const x = r.scenarios[s.id];
      return `<article class="card" id="${s.id}"><h3>${s.id.slice(1)} · ${esc(s.title)}</h3>
<p><b>상황</b> ${esc(s.situation)}</p><p><b>보고서의 처리</b> ${esc(s.handling)}</p>${s.show ? `<p><b>보여 줄 결과</b> ${esc(s.show)}</p>` : ''}
<p class="now"><b>지금 플랫폼</b> ${esc(x.current)}</p><p class="gap"><b>차이</b> ${esc(x.gap)}</p><p><b>반영</b> ${x.plan.map(link).join(' · ')}</p></article>`;
    })
    .join('\n');

  const itemCard = (i: Item) => `<article class="card item" id="${i.id}"><h3><span class="mono">${i.id}</span> ${esc(i.title)} <span class="pill">${esc(i.priority)} · ${esc(i.layer)}</span>${i.defect ? ' <span class="defect">결함</span>' : ''}</h3>
${i.req.length ? `<p class="sub">요구 ${i.req.map(link).join(', ')}</p>` : ''}
<div class="layers">${[
    ['UI/UX', i.ui],
    ['프론트', i.fe],
    ['백엔드·계약', i.be],
    ['DB', i.db],
    ['API', i.api],
    ['시험', i.tests],
  ]
    .filter(([, xs]) => (xs as string[]).length)
    .map(([k, xs]) => `<div><h4>${k}</h4>${list(xs as string[])}</div>`)
    .join('')}</div>
${i.deps.length ? `<p class="sub">선행 ${i.deps.map(link).join(', ')}</p>` : ''}${i.coord ? `<p class="coord"><b>조정</b> ${esc(i.coord)}</p>` : ''}</article>`;

  const phaseBlocks = d.phases
    .map((ph) => `<section class="phase"><h3>${esc(ph.phase)}</h3><p class="exit"><b>완료 기준</b> ${esc(ph.exit)}</p>${ph.items.map((id) => itemCard(itemsById.get(id)!)).join('\n')}</section>`)
    .join('\n');

  const apis = [...new Set(d.items.flatMap((i) => i.api))];
  const css = `
:root{--paper:#f5f4ef;--surface:#fdfcf9;--ink:#15171b;--ink2:#3a3d44;--muted:#5f5b50;--line:#dfdcd2;--accent:#2747d4;--ok:#1a7045;--part:#8f5500;--miss:#c3311c;--out:#6b675c;font-family:'SUIT Variable','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);line-height:1.55;font-size:15px}
header{background:var(--surface);border-bottom:1px solid var(--line);padding:28px 40px}header h1{margin:0 0 6px;font-size:24px}
.thesis{font-size:20px;font-weight:700;margin:14px 0 4px}.meta{color:var(--muted);font-size:13px}
nav{position:sticky;top:0;height:38px;background:var(--surface);border-bottom:1px solid var(--line);padding:0 40px;display:flex;align-items:center;gap:14px;font-size:13px;z-index:2;overflow-x:auto;white-space:nowrap}
section,[id]{scroll-margin-top:56px}.nw{white-space:nowrap}td.cat{min-width:8.5em;word-break:keep-all}
nav a{color:var(--accent);text-decoration:none}main{padding:24px 40px;max-width:1500px}
section{margin:0 0 40px}h2{font-size:20px;border-bottom:2px solid var(--ink);padding-bottom:6px}h3{font-size:16px;margin:0 0 8px}h4{margin:0 0 4px;font-size:13px;color:var(--ink2)}
.key{background:var(--surface);border:1px solid var(--line);border-left:6px solid var(--accent);padding:14px 18px;font-size:17px;font-weight:700;margin-bottom:16px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}.key small{display:block;font-size:13px;font-weight:500;color:var(--ink2);margin-top:4px}.panel{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:16px}
.bar-row{display:grid;grid-template-columns:150px 1fr 120px;align-items:center;gap:8px;margin:4px 0;font-size:13px}.bar-label{color:var(--ink2)}.bar-total{text-align:right;color:var(--muted)}
.bar{display:flex;gap:2px;height:20px}.seg{display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;border-radius:2px}.seg:last-child{border-radius:2px 4px 4px 2px}
.seg.v-ok,.badge.v-ok{background:var(--ok)}.seg.v-part,.badge.v-part{background:var(--part)}.seg.v-miss,.badge.v-miss{background:var(--miss)}.seg.v-out,.badge.v-out{background:var(--out)}
.badge{display:inline-block;color:#fff;border-radius:3px;padding:1px 7px;font-size:12px;font-weight:700;white-space:nowrap}
.legend{display:flex;gap:14px;font-size:12px;margin:6px 0 10px}.legend .badge{margin-right:4px}
table{border-collapse:collapse;width:100%;background:var(--surface);font-size:13px}th,td{border:1px solid var(--line);padding:6px 8px;vertical-align:top;text-align:left}th{background:#ecebe4;position:sticky;top:38px;white-space:nowrap}td.note{min-width:14em}
.mono,code{font-family:'JetBrains Mono',Consolas,monospace;font-size:12px}code{background:#efede6;padding:0 3px;border-radius:2px;word-break:break-all}
.sub{color:var(--muted);font-size:12px;margin-top:2px}.defect{display:inline-block;margin-top:3px;font-size:11px;font-weight:700;color:var(--miss);border:1px solid var(--miss);border-radius:3px;padding:0 4px}
.filters{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:8px 0;font-size:13px}.filters select,.filters input{font:inherit;padding:3px 6px}.filters input{width:16em}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:14px}.card{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:14px}
.card p{margin:4px 0;font-size:13px}.card .now{border-left:3px solid var(--out);padding-left:8px}.card .gap{border-left:3px solid var(--miss);padding-left:8px}
.item .layers{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:10px;margin-top:6px}.item ul{margin:0;padding-left:18px;font-size:13px}
.pill{font-size:11px;font-weight:600;color:var(--ink2);border:1px solid var(--line);border-radius:10px;padding:1px 8px;margin-left:6px}
.phase{margin-bottom:28px}.phase .item{margin-bottom:12px}.exit{background:#e7ebfb;padding:6px 10px;border-radius:4px;font-size:13px}.coord{font-size:12px;color:var(--ink2)}
.caveat{font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding-top:10px}
@media print{nav{display:none}th{position:static}}`;

  const filterJs = `
const f={cat:'',pri:'',owner:'',verdict:'',q:''};
function apply(){let n=0;document.querySelectorAll('#req tbody tr').forEach(tr=>{const ok=(!f.cat||tr.dataset.cat===f.cat)&&(!f.pri||tr.dataset.pri===f.pri)&&(!f.owner||tr.dataset.owner===f.owner)&&(!f.verdict||tr.dataset.verdict===f.verdict)&&(!f.q||tr.textContent.toLowerCase().includes(f.q));tr.hidden=!ok;if(ok)n++});document.getElementById('req-n').textContent=n+' / 64';}
document.querySelectorAll('[data-f]').forEach(el=>el.addEventListener('input',e=>{f[el.dataset.f]=el.dataset.f==='q'?el.value.toLowerCase():el.value;apply()}));`;
  const opt = (xs: string[]) => `<option value="">전체</option>${xs.map((x) => `<option>${esc(x)}</option>`).join('')}`;

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.title)}</title><style>${css}</style></head><body>
<header><h1>${esc(d.title)}</h1>
<p class="thesis">“${esc(c.vision.thesis)}”</p>
<p class="meta">원본 ${esc(c.source.file)} · Revision ${c.source.revision} (${c.source.date}) · sha256 ${c.source.sha256.slice(0, 12)}… · 판정 ${esc(r.source.reviewedAt)} @ ${esc(r.source.reviewedCommit)} · 설계 ${esc(d.date)}</p></header>
<nav><a href="#summary">요약</a><a href="#principles">원칙</a><a href="#state">상태 모델</a><a href="#integration">다른 세션과 통합</a><a href="#req">기능요건 64</a><a href="#tests">인수시험 24</a><a href="#scenarios">시나리오 10</a><a href="#design">수정 설계</a><a href="#db">DB·API</a><a href="#decisions">결정 필요</a><a href="#appendix">부록</a></nav>
<main>
<section id="summary"><h2>요약</h2>
<div class="key">기능요건 64개 중 플랫폼이 합격 조건을 다 채운 것은 ${all.구현}개 — ${all.부분}개는 부분, ${all.미구현}개는 미구현, 결함 ${defects.length}건.<small>반영은 UI/UX부터 — 설계 항목 ${d.items.length}개를 ${d.phases.length}단계로(9장).</small></div>
<div class="legend">${ORDER.map((v) => `<span>${badge(v)}</span>`).join('')}</div>
<div class="grid2"><div class="panel"><h3>전체 · 우선순위 · 담당</h3>${stack('전체', all, 64)}${byPri}${byOwner}
<p class="sub">인수시험 24: 자동 시험 있음 ${tcount('자동 시험 있음')} · 일부 ${tcount('일부')} · 없음 ${tcount('없음')}</p></div>
<div class="panel"><h3>영역별</h3>${byCat}</div></div>
<div class="grid2" style="margin-top:16px"><div class="panel"><h3>결함 (판정 중 발견 — 회귀 시험과 함께 수정)</h3><ul>${defects.map((q) => `<li>${link(q.id)} ${esc(q.title)} — ${esc(r.requirements[q.id].gap)} → ${r.requirements[q.id].plan.map(link).join(', ')}</li>`).join('')}</ul></div>
<div class="panel"><h3>미구현 ${missing.length}</h3><ul>${missing.map((q) => `<li>${link(q.id)} ${esc(q.title)} → ${r.requirements[q.id].plan.map(link).join(', ')}</li>`).join('')}</ul></div></div>
<p class="caveat">${esc(r.source.method ?? '')} 문서 하네스가 통과해도 차량 안전성·규정 적합성 증거를 대신하지 않는다(원본 보고서의 경계 문구). FFP 요구는 보고서가 도출한 프로젝트 요구 제안이다.</p></section>

<section id="principles"><h2>원칙 — 보고서 비전을 플랫폼 원칙으로</h2><table><thead><tr><th>ID</th><th>원칙</th><th>플랫폼에 적용</th></tr></thead><tbody>${d.principles.map((p) => `<tr><td class="mono">${p.id}</td><td><b>${esc(p.text)}</b></td><td>${esc(p.apply)}</td></tr>`).join('')}</tbody></table></section>

<section id="state"><h2>상태 모델 — 하나의 ON/OFF로 합치지 않는다</h2><table><thead><tr><th>층</th><th>값</th><th>출처</th></tr></thead><tbody>${d.stateModel.layers.map((l) => `<tr><td><b>${esc(l.name)}</b></td><td>${esc(l.values.join(' · '))}</td><td>${esc(l.source)}</td></tr>`).join('')}</tbody></table><p class="key" style="margin-top:12px">${esc(d.stateModel.example)}</p></section>

<section id="integration"><h2>다른 세션 작업과 통합</h2><table><thead><tr><th>세션</th><th>겹치는 부분</th><th>통합 방법</th></tr></thead><tbody>${d.integration.map((x) => `<tr><td><b>${esc(x.session)}</b></td><td>${esc(x.overlap)}</td><td>${esc(x.action)}</td></tr>`).join('')}</tbody></table></section>

<section id="req"><h2>기능요건 64 — 판정·근거·반영</h2>
<div class="filters"><label>영역 <select data-f="cat">${opt(cats)}</select></label><label>우선 <select data-f="pri">${opt(['P0', 'P1'])}</select></label><label>담당 <select data-f="owner">${opt(owners)}</select></label><label>판정 <select data-f="verdict">${opt(ORDER)}</select></label><label>검색 <input data-f="q" type="search" placeholder="ODD, 종료, FFP-F033…"></label><b id="req-n">64 / 64</b></div>
<table><thead><tr><th>ID</th><th>요건</th><th>영역</th><th>우선</th><th>담당</th><th>판정</th><th>차이·근거</th><th>반영</th></tr></thead><tbody>${reqRows}</tbody></table></section>

<section id="tests"><h2>인수시험 24 — 자동 시험 대응</h2><table><thead><tr><th>ID</th><th>시험</th><th>요구</th><th>상태</th><th>지금 있는 시험</th><th>반영</th></tr></thead><tbody>${testRows}</tbody></table></section>

<section id="scenarios"><h2>상세 시나리오 10 — 지금 → 목표</h2><div class="cards">${scenarioCards}</div></section>

<section id="design"><h2>수정 설계 — 단계별 (UI/UX · 프론트 · 백엔드 · DB · API · 시험)</h2>${phaseBlocks}</section>

<section id="db"><h2>DB·API 변경</h2><h3>DB (새 migration 044부터)</h3><table><thead><tr><th>표</th><th>열</th><th>항목</th><th>비고</th></tr></thead><tbody>${d.dbTables.map((t) => `<tr><td class="mono">${esc(t.name)}</td><td>${esc(t.columns)}</td><td>${t.items.map(link).join(', ')}</td><td class="note">${esc(t.note)}</td></tr>`).join('')}</tbody></table>
<h3 style="margin-top:18px">API</h3><ul>${apis.map((a) => `<li><code>${esc(a)}</code></li>`).join('')}</ul></section>

<section id="decisions"><h2>결정 필요</h2><table><thead><tr><th>ID</th><th>질문</th><th>이유</th><th>제안</th></tr></thead><tbody>${d.decisions.map((x) => `<tr><td class="mono">${x.id}</td><td><b>${esc(x.question)}</b></td><td>${esc(x.why)}</td><td>${esc(x.proposal)}</td></tr>`).join('')}</tbody></table></section>

<section id="appendix"><h2>부록 — 보고서 원문 구조(추출본)</h2>
<h3>위험 H01~H08 · 주장 C01~C06</h3><table><tbody>${c.hazards.map((h) => `<tr><td class="mono">${esc(h.id)}</td><td>${esc(h.condition)}</td><td>${esc(h.outcome)}</td></tr>`).join('')}${c.claims.map((h) => `<tr><td class="mono">${esc(h.id)}</td><td>${esc(h.claim)}</td><td>${esc(h.platform)}</td></tr>`).join('')}</tbody></table>
<h3 style="margin-top:14px">계약 4종 (보고서 제안 필드)</h3><table><thead><tr><th>계약</th><th>필드</th><th>불변 조건</th></tr></thead><tbody>${c.contracts.map((x) => `<tr><td><b>${esc(x.contract)}</b></td><td class="mono">${esc(x.fields)}</td><td>${esc(x.invariant)}</td></tr>`).join('')}</tbody></table>
<h3 style="margin-top:14px">API 5 (보고서 제안)</h3><table><tbody>${c.apis.map((x) => `<tr><td class="mono">${esc(x.api)}</td><td>${esc(x.role)}</td><td>${esc(x.boundary)}</td></tr>`).join('')}</tbody></table>
<h3 style="margin-top:14px">행위별 판정 모델 — 행위 ${c.verdictModel.actions.length} · 입력 ${c.verdictModel.inputs.length} · 사유 코드 ${c.verdictModel.reasonCodes.length}</h3><p class="mono">${esc(c.verdictModel.reasonCodes.join(' · '))}</p>
<h3 style="margin-top:14px">차량 팀과 확정할 결정</h3><table><tbody>${c.vehicleDecisions.map((x) => `<tr><td><b>${esc(x.decision)}</b></td><td>${esc(x.owner)}</td></tr>`).join('')}</tbody></table>
<h3 style="margin-top:14px">타사 공개 사례</h3><table><tbody>${c.peers.map((x) => `<tr><td><b>${esc(x.who)}</b></td><td>${esc(x.proposal)}</td></tr>`).join('')}</tbody></table>
<p class="caveat">운영 화면 필수 정보(보고서): ${esc(c.screenMustShow)}</p></section>
</main><script>${filterJs}</script></body></html>
`;
}

// ── BACKLOG.md ADS 절 ──
export function renderBacklog(c: AdsCatalog, r: AdsReview, d: Design): string {
  const row = (i: Item) => `| ${i.id} | 대기 | ${i.priority} | ${i.layer} | ${i.defect ? '**[결함]** ' : ''}${i.title.replace(/^\[결함\]\s*/, '')} | ${i.req.map((q) => q.replace('FFP-', '')).join('·') || '—'} | ${i.deps.join('·') || '—'} |`;
  const v = Object.values(r.requirements);
  const n = (x: string) => v.filter((y) => y.verdict === x).length;
  return [
    BEGIN,
    '## ADS·UNECE 보고서 v3.0 반영 (2026-10-18)',
    '',
    '### 배경',
    '- 사용자 요청: "FF Platform의 목적·vision과 시나리오·Case가 들어 있으니 모두 반영. 분석·저장·HTML 보고"',
    '- 이어서: "다른 세션 내용과 통합해 UI/UX·프론트·백엔드·DB 수정 설계"',
    `- 원본: 저장소 밖(\`C:/project/2026-06-04_Feature_Platform_sources/ads-unece-v3.0/\`, sha256 \`${c.source.sha256.slice(0, 12)}…\`)`,
    '- 추출본: `harness/ads/catalog.json`',
    `- 판정: \`harness/ads/review.json\` — 요건 64 중 구현 ${n('구현')} · 부분 ${n('부분')} · 미구현 ${n('미구현')} · 범위 밖 ${n('범위 밖')}`,
    '- 설계: `harness/ads/design.json`',
    '- 보고서: `docs/10-requirements/ads-unece-v3/report.html`',
    '- 반영 순서: 설계 단계 0 → 5. UI/UX가 먼저이고 결함 4건은 1단계에서 회귀 시험과 함께 고친다.',
    '- 이 절은 `npm run ads:report`로 생성한다. 상태를 바꿀 때는 design.json을 고친다.',
    '',
    ...d.phases.flatMap((ph) => [
      `### ${ph.phase}`,
      `- 완료 기준: ${ph.exit}`,
      '',
      '| ID | 상태 | 우선 | 층 | 내용 | 요구(FFP-) | 선행 |',
      '|---|---|---|---|---|---|---|',
      ...ph.items.map((id) => row(d.items.find((i) => i.id === id)!)),
      '',
    ]),
    '### 결정 필요',
    ...d.decisions.map((x) => `- **${x.id}** ${x.question} — 제안: ${x.proposal}`),
    END,
  ].join('\n');
}

export function mergeBacklog(current: string, section: string): string {
  const i = current.indexOf('<!-- ads:begin');
  const j = current.indexOf(END);
  if (i >= 0 && j > i) return `${current.slice(0, i)}${section}${current.slice(j + END.length)}`;
  return `${current.replace(/\s*$/, '')}\n\n${section}\n`;
}

function main() {
  const c = readJson<AdsCatalog>(CATALOG);
  const r = readJson<AdsReview>(REVIEW);
  const d = readJson<Design>(DESIGN);
  const problems = designProblems(c, r, d);
  const html = renderHtml(c, r, d);
  const backlog = mergeBacklog(readFileSync(BACKLOG, 'utf8').replace(/\r\n/g, '\n'), renderBacklog(c, r, d));
  if (process.argv.includes('--check')) {
    if (!existsSync(HTML) || readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n') !== html) problems.push('report.html이 최신이 아님 — npm run ads:report');
    if (readFileSync(BACKLOG, 'utf8').replace(/\r\n/g, '\n') !== backlog) problems.push('BACKLOG.md ADS 절이 최신이 아님 — npm run ads:report');
    if (problems.length) {
      console.error(problems.map((x) => `✗ ${x}`).join('\n'));
      process.exit(1);
    }
    console.log(`✓ ADS 설계 ${d.items.length}항목·단계 ${d.phases.length} · 보고서·Backlog 최신`);
    return;
  }
  if (problems.length) throw new Error(problems.join('\n'));
  mkdirSync(dirname(HTML), { recursive: true });
  writeFileSync(HTML, html);
  writeFileSync(BACKLOG, backlog);
  console.log(`✓ ${HTML}\n✓ BACKLOG.md ADS 절 — 항목 ${d.items.length}`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/ads-report.ts')) main();
