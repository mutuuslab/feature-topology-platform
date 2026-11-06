// node tools/grafana/build-dashboards.ts [--check | --promtool <파일>] — dashboards.ts(원천)에서 deploy/grafana/dashboards/*.json·alerting/rules.json을 만든다.
// --check: 저장본이 원천과 다르면 종료 1(verify 단계 grafana:check). 파일은 Grafana 화면의 '가져오기'로도 쓸 수 있다(__inputs).
// --promtool: PromQL 문법 검사용 규칙 파일(CI가 promtool check rules로 확인).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF } from '../lib.ts';
import { alertRuleJson, alertRules, dashboards, publicVariant, RULE_GROUP_INTERVAL } from './dashboards.ts';

export const DASH_DIR = join(FF, 'deploy', 'grafana', 'dashboards');
export const ALERT_FILE = join(FF, 'deploy', 'grafana', 'alerting', 'rules.json');
const NL = '\n';

export function builtFiles(): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of dashboards()) out.set(join(DASH_DIR, `${d.uid}.json`), JSON.stringify(d, null, 2) + NL);
  const rules = { groups: Object.entries(RULE_GROUP_INTERVAL).map(([name, interval]) => ({ name, interval, rules: alertRules().filter((r) => r.group === name).map((r) => alertRuleJson(r)) })) };
  out.set(ALERT_FILE, JSON.stringify(rules, null, 2) + NL);
  return out;
}

/** Prometheus 쿼리 식 모두(공개본 — 변수 없음)와 경보 식 */
export function promExprs(): { name: string; expr: string }[] {
  const exprs: { name: string; expr: string }[] = [];
  for (const d of dashboards().map((x) => publicVariant(x))) {
    const walk = (v: unknown, path: string) => {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}_${i}`));
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        const ds = o.datasource as { type?: string } | undefined;
        if (typeof o.expr === 'string' && (!ds || ds.type === 'prometheus')) exprs.push({ name: path, expr: o.expr });
        for (const [k, x] of Object.entries(o)) if (k !== 'expr') walk(x, `${path}_${k}`);
      }
    };
    walk(d, d.uid);
  }
  for (const r of alertRules()) exprs.push({ name: r.uid, expr: r.expr });
  return exprs;
}

/** promtool 검사용 규칙 파일(YAML) — 쿼리마다 기록 규칙 하나 */
export function promtoolRules(): string {
  const rec = promExprs().map((e, i) => [`      - record: ff_check:${e.name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 80)}_${i}`, `        expr: ${JSON.stringify(e.expr)}`].join(NL));
  return ['# 생성 파일 — node tools/grafana/build-dashboards.ts --promtool <파일>', 'groups:', '  - name: ff-grafana-promql-check', '    rules:', ...rec, ''].join(NL);
}

if (import.meta.main) {
  const pi = process.argv.indexOf('--promtool');
  if (pi >= 0) {
    writeFileSync(process.argv[pi + 1], promtoolRules());
    console.log(`promtool 규칙 ${promExprs().length}개 → ${process.argv[pi + 1]}`);
  } else if (process.argv.includes('--check')) {
    const files = builtFiles();
    const bad: string[] = [];
    for (const [f, text] of files) {
      let cur = '';
      try {
        cur = readFileSync(f, 'utf8');
      } catch {
        // 없음
      }
      if (cur.split('\r\n').join(NL) !== text) bad.push(f.slice(FF.length));
    }
    const extra = readdirSync(DASH_DIR).filter((n) => n.endsWith('.json') && !files.has(join(DASH_DIR, n)));
    if (bad.length || extra.length) {
      console.error(`Grafana 대시보드·경보 저장본이 원천(tools/grafana/dashboards.ts)과 다르다: ${[...bad, ...extra.map((e) => `남는 파일 ${e}`)].join(', ')} — node tools/grafana/build-dashboards.ts`);
      process.exit(1);
    }
    console.log(`grafana: 대시보드 ${files.size - 1}개·경보 파일 최신`);
  } else {
    const files = builtFiles();
    mkdirSync(DASH_DIR, { recursive: true });
    mkdirSync(join(FF, 'deploy', 'grafana', 'alerting'), { recursive: true });
    for (const [f, text] of files) writeFileSync(f, text);
    console.log(`grafana: ${[...files.keys()].map((f) => f.slice(FF.length)).join(', ')}`);
  }
}
