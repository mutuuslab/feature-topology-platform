// 차량 기능 앱 저장소 쓰기 — 계획된 이벤트를 git fast-import로 결정적 커밋 이력으로 만들고, 기본 브랜치 커밋·PR 머리를 v2로 스캔한다.
// 커밋 내용은 Feature 상태(브랜치마다)로 저장소 전체를 다시 그려 만든다. 작성자·시각은 계획이 정하므로 같은 입력이면 같은 해시다.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FLAG_SCANNER_VERSION, FLAG_SOURCE_FILE, scanFlagFiles } from '../../backend/src/domains/d01-policy/flag-code/scanner.ts';
import { C, GITHUB, planUpTo, type Action, type CP, type Event, type FeatureP, type Person, type PrP, type RepoDef } from './plan.ts';
import { experimentFiles, featureSource, featureTest, packageJson, packageReadme, repoRootFiles, type FeatureRender, type PlanFlag } from './templates.ts';

type Tree = Map<string, string>;
interface FState {
  featureId: string;
  pkg: string;
  /** flags.ts·flag-guards.ts가 반영한 Version과 키 */
  scaffold: { version: string; keys: string[] };
  /** 기능 분기(feature.ts)가 반영한 Version과 키 — 뼈대만 있으면 null */
  impl: { version: string; keys: string[] } | null;
  omit: string[];
  removed: string[];
  dynamic: boolean;
  experiment: string | null;
}
type States = Map<string, FState>;
const clone = (s: States): States => new Map([...s].map(([k, v]) => [k, structuredClone(v)]));

export interface WrittenCommit { sha: string; at: number; subject: string }
export interface WrittenPr { pr: PrP; number: number; baseSha: string; headSha: string; mergeSha: string | null; createdAt: number; files: { path: string; change: 'ADD' | 'MODIFY' | 'DELETE' }[] }
export interface WrittenRepo { dir: string; main: WrittenCommit[]; prs: WrittenPr[]; packages: string[] }

export function git(dir: string, args: string[], input?: string | Buffer): string {
  return execFileSync('git', ['-c', `safe.directory=${dir.replace(/\\/g, '/')}`, '-c', 'core.autocrlf=false', '-C', dir, ...args], { encoding: 'utf8', input, maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
}

/** 생성기가 만든 저장소인지(지워도 되는지) — 설정 파일의 generatedBy로 확인한다 */
export function isGeneratedRepo(dir: string): boolean {
  const cfg = join(dir, 'ff-flags.config.json');
  if (!existsSync(join(dir, '.git')) || !existsSync(cfg)) return false;
  try {
    return String(JSON.parse(readFileSync(cfg, 'utf8')).generatedBy ?? '').includes('generate-vehicle-apps');
  } catch {
    return false;
  }
}

// ── 상태 → 저장소 파일 ───────────────────────────────────
class Renderer {
  private memo = new Map<string, Record<string, string>>();
  private root: Record<string, string>;
  private byId: Map<string, FeatureP>;
  constructor(repo: RepoDef, features: FeatureP[]) {
    this.root = repoRootFiles(repo);
    this.byId = new Map(features.map((f) => [f.featureId, f]));
  }
  /** 정책 키 맞춤부터는 현재 계획(키·제어점·이름)으로 그린다 — 고정 이력 커밋은 그대로 둔다 */
  useFeatures(features: FeatureP[]) {
    this.byId = new Map(features.map((f) => [f.featureId, f]));
    this.memo.clear();
  }
  private version(featureId: string, version: string) {
    const f = this.byId.get(featureId)!;
    return f.versions.find((p) => p.v.version === version)!.v;
  }
  private entries(featureId: string, keys: string[]) {
    const f = this.byId.get(featureId)!;
    return keys.map((k) => {
      const e = f.plan.find((x) => x.flagKey === k)!;
      return { flagKey: e.flagKey, featureId: e.featureId, version: e.version, controlPoint: e.controlPoint, ordinal: e.ordinal, package: e.package, source: e.source };
    });
  }
  feature(s: FState): Record<string, string> {
    const key = JSON.stringify(s);
    const hit = this.memo.get(key);
    if (hit) return hit;
    const dir = C.flagFeatureDir(s.pkg as never, s.featureId);
    const out: Record<string, string> = {};
    const sv = this.version(s.featureId, s.scaffold.version);
    const info = { featureId: s.featureId, version: s.scaffold.version, name: sv.name };
    const declared = s.scaffold.keys.filter((k) => !s.omit.includes(k));
    const called = declared.filter((k) => !s.removed.includes(k));
    if (declared.length) out[`${dir}/flags.ts`] = C.flagScaffoldFiles(info, this.entries(s.featureId, declared))[0].content;
    if (called.length) out[`${dir}/flag-guards.ts`] = C.flagScaffoldFiles(info, this.entries(s.featureId, called))[1].content;
    if (s.impl) {
      const iv = this.version(s.featureId, s.impl.version);
      const flags: PlanFlag[] = this.entries(s.featureId, s.impl.keys.filter((k) => !s.omit.includes(k))).map((e) => ({ flagKey: e.flagKey, controlPoint: e.controlPoint as CP, ordinal: e.ordinal }));
      const r: FeatureRender = {
        info: { featureId: s.featureId, version: s.impl.version, name: iv.name, description: iv.description, pkg: s.pkg, safetyRelated: !!iv.asil && iv.asil !== 'QM' },
        flags, removed: new Set(s.removed), dynamic: s.dynamic,
      };
      out[`${dir}/feature.ts`] = featureSource(r);
      out[`${dir}/feature.test.ts`] = featureTest(r);
      if (s.experiment) for (const [name, content] of Object.entries(experimentFiles(r.info, s.experiment))) out[`${dir}/${name}`] = content;
    }
    this.memo.set(key, out);
    return out;
  }
  tree(states: States): Tree {
    const t: Tree = new Map(Object.entries(this.root));
    const pkgs = new Map<string, { featureId: string; version: string; name: string; flags: string[] }[]>();
    for (const s of [...states.values()].sort((a, b) => a.featureId.localeCompare(b.featureId))) {
      for (const [p, c] of Object.entries(this.feature(s))) t.set(p, c);
      if (s.impl) {
        const v = this.version(s.featureId, s.impl.version);
        pkgs.set(s.pkg, [...(pkgs.get(s.pkg) ?? []), { featureId: s.featureId, version: s.impl.version, name: v.name, flags: s.impl.keys.filter((k) => !s.omit.includes(k)) }]);
      }
    }
    for (const [pkg, list] of pkgs) {
      t.set(`packages/${pkg}/package.json`, packageJson(pkg));
      t.set(`packages/${pkg}/README.md`, packageReadme(pkg, list));
    }
    return new Map([...t].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }
  apply(states: States, a: Action) {
    const f = this.byId.get(a.featureId)!;
    if (a.type === 'retire') {
      states.delete(a.featureId);
      return;
    }
    const cur = states.get(a.featureId);
    if (a.type === 'align') {
      if (!cur?.impl) throw new Error(`${a.featureId}: 기본 브랜치에 구현이 없는 Feature는 키를 맞출 수 없습니다.`);
      const to = new Map(a.rename);
      const r = (k: string) => to.get(k) ?? k;
      cur.scaffold = { version: cur.scaffold.version, keys: [...cur.scaffold.keys.map(r), ...a.added] };
      cur.impl = { version: cur.impl.version, keys: [...cur.impl.keys.map(r), ...a.added] };
      cur.omit = cur.omit.map(r);
      cur.removed = cur.removed.map(r);
      return;
    }
    if (a.type === 'scaffold' || a.type === 'implement') {
      const keys = planUpTo(f, a.version).map((e) => e.flagKey);
      const s: FState = cur ?? { featureId: f.featureId, pkg: f.pkg, scaffold: { version: a.version, keys }, impl: null, omit: [], removed: [], dynamic: false, experiment: null };
      s.scaffold = { version: a.version, keys };
      if (a.type === 'implement') {
        s.impl = { version: a.version, keys };
        s.omit = [...a.omit];
      }
      states.set(a.featureId, s);
      return;
    }
    if (!cur?.impl) throw new Error(`${a.featureId}: 구현 전 Feature에 ${a.type}을 적용할 수 없습니다.`);
    if (a.type === 'removeCalls') cur.removed = [...new Set([...cur.removed, a.flagKey])];
    else if (a.type === 'experiment') cur.experiment = a.flagKey;
    else cur.dynamic = true;
  }
}

// ── fast-import ─────────────────────────────────────────
const gitDate = (at: number) => `${Math.floor(at / 1000)} +0900`;
function diff(prev: Tree, next: Tree) {
  const out: { path: string; content: string | null }[] = [];
  for (const [p, c] of next) if (prev.get(p) !== c) out.push({ path: p, content: c });
  for (const p of prev.keys()) if (!next.has(p)) out.push({ path: p, content: null });
  return out;
}
class Stream {
  private parts: Buffer[] = [];
  private mark = 0;
  private data(s: string) {
    const b = Buffer.from(s, 'utf8');
    this.parts.push(Buffer.from(`data ${b.length}\n`), b, Buffer.from('\n'));
  }
  commit(ref: string, author: Person, committer: Person, at: number, message: string, parents: number[], changes: { path: string; content: string | null }[]): number {
    const mark = ++this.mark;
    this.parts.push(Buffer.from(`commit ${ref}\nmark :${mark}\nauthor ${author.name} <${author.email}> ${gitDate(at)}\ncommitter ${committer.name} <${committer.email}> ${gitDate(at)}\n`));
    this.data(message);
    if (parents[0]) this.parts.push(Buffer.from(`from :${parents[0]}\n`));
    for (const p of parents.slice(1)) this.parts.push(Buffer.from(`merge :${p}\n`));
    for (const ch of changes) {
      if (ch.content === null) this.parts.push(Buffer.from(`D ${ch.path}\n`));
      else {
        this.parts.push(Buffer.from(`M 100644 inline ${ch.path}\n`));
        this.data(ch.content);
      }
    }
    this.parts.push(Buffer.from('\n'));
    return mark;
  }
  bytes() {
    return Buffer.concat([...this.parts, Buffer.from('done\n')]);
  }
}

/** 저장소 하나를 만든다 — dir은 비어 있거나 없어야 한다. finalFeatures는 정책 키 맞춤 PR(align)부터 쓰는 현재 계획 */
export function writeRepo(dir: string, repo: RepoDef, features: FeatureP[], events: Event[], startAt: number, finalFeatures: FeatureP[] = features): WrittenRepo {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  const r = new Renderer(repo, features);
  const s = new Stream();
  let mainStates: States = new Map();
  let mainTree = r.tree(mainStates);
  let mainMark = s.commit('refs/heads/main', { name: 'platform 구현 담당', email: 'dev-platform@mutuuslab.example' }, { name: 'platform 구현 담당', email: 'dev-platform@mutuuslab.example' }, startAt,
    'chore: 차량 기능 앱 저장소 시작\n\nruntime 패키지(Flag 클라이언트·로컬 Guard·시험 도구)와 저장소 설정을 만든다.\n', [], diff(new Map(), mainTree));
  const main: { mark: number; at: number; subject: string }[] = [{ mark: mainMark, at: startAt, subject: 'chore: 차량 기능 앱 저장소 시작' }];
  interface Live { number: number; states: States; baseMark: number; baseTree: Tree; headMark: number; headTree: Tree; touched: Set<string>; createdAt: number; mergeMark: number | null }
  const live = new Map<PrP, Live>();
  let prNo = 0;
  let aligned = false;
  for (const ev of events) {
    if (!aligned && ev.kind !== 'main-commit' && ev.pr.align) {
      r.useFeatures(finalFeatures);
      aligned = true;
    }
    if (ev.kind === 'pr-commit') {
      let l = live.get(ev.pr);
      if (!l) {
        l = { number: ++prNo, states: clone(mainStates), baseMark: mainMark, baseTree: mainTree, headMark: mainMark, headTree: mainTree, touched: new Set(), createdAt: ev.at, mergeMark: null };
        live.set(ev.pr, l);
      }
      const c = ev.pr.commits[ev.index];
      for (const a of c.actions) {
        r.apply(l.states, a);
        l.touched.add(a.featureId);
      }
      const t = r.tree(l.states);
      l.headMark = s.commit(`refs/heads/${ev.pr.branch}`, c.author, c.author, c.at, c.message, [l.headMark], diff(l.headTree, t));
      l.headTree = t;
    } else if (ev.kind === 'merge') {
      const l = live.get(ev.pr)!;
      const next = clone(mainStates);
      for (const id of l.touched) {
        const b = l.states.get(id);
        if (b) next.set(id, structuredClone(b));
        else next.delete(id);
      }
      const t = r.tree(next);
      const message = `Merge pull request #${l.number} from mutuuslab/${ev.pr.branch}\n\n${ev.pr.title}\n`;
      mainMark = s.commit('refs/heads/main', ev.pr.merger, GITHUB, ev.at, message, [mainMark, l.headMark], diff(mainTree, t));
      l.mergeMark = mainMark;
      mainStates = next;
      mainTree = t;
      main.push({ mark: mainMark, at: ev.at, subject: `Merge pull request #${l.number} from mutuuslab/${ev.pr.branch}` });
    } else {
      const c = ev.commit;
      for (const a of c.actions) r.apply(mainStates, a);
      const t = r.tree(mainStates);
      mainMark = s.commit('refs/heads/main', c.author, c.author, c.at, c.message, [mainMark], diff(mainTree, t));
      mainTree = t;
      main.push({ mark: mainMark, at: c.at, subject: c.message.split('\n')[0] });
    }
  }
  const marksFile = join(dir, '.git', 'ff-marks');
  const res = spawnSync('git', ['-c', `safe.directory=${dir.replace(/\\/g, '/')}`, '-C', dir, 'fast-import', '--quiet', '--done', `--export-marks=${marksFile}`], { input: s.bytes(), maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`git fast-import 실패: ${res.stderr?.toString()}`);
  const shaOf = new Map(readFileSync(marksFile, 'utf8').trim().split('\n').map((l) => {
    const [m, h] = l.split(' ');
    return [Number(m.slice(1)), h] as const;
  }));
  rmSync(marksFile);
  // 병합된 PR 브랜치는 GitHub처럼 지운다. 열림·닫힘 PR 브랜치는 남긴다
  const del = [...live.keys()].filter((p) => p.state === 'MERGED').map((p) => `delete refs/heads/${p.branch}\n`).join('');
  if (del) git(dir, ['update-ref', '--stdin'], del);
  git(dir, ['reset', '-q', '--hard', 'main']);
  const prs: WrittenPr[] = [...live].map(([pr, l]) => ({
    pr, number: l.number, baseSha: shaOf.get(l.baseMark)!, headSha: shaOf.get(l.headMark)!, mergeSha: l.mergeMark ? shaOf.get(l.mergeMark)! : null, createdAt: l.createdAt,
    files: diff(l.baseTree, l.headTree).map((d) => ({ path: d.path, change: d.content === null ? 'DELETE' as const : l.baseTree.has(d.path) ? 'MODIFY' as const : 'ADD' as const })),
  }));
  const packages = [...new Set([...mainStates.values()].filter((x) => x.impl).map((x) => x.pkg))];
  return { dir, main: main.map((c) => ({ sha: shaOf.get(c.mark)!, at: c.at, subject: c.subject })), prs, packages };
}

// ── 스캔(v2) ───────────────────────────────────────────
export interface ManifestV2 {
  format: 'ff-flag-source/v2';
  provider: 'GITHUB';
  repository: string;
  ref: string;
  commit: string;
  scannedAt: string;
  scanner: { name: 'ff-flag-scan'; version: string };
  filesScanned: number;
  usages: ReturnType<typeof scanFlagFiles>['usages'];
  unresolved: ReturnType<typeof scanFlagFiles>['unresolved'];
}

/** 커밋들의 확정 바이트를 읽어 스캔한다(tools/flag-sources.ts scanGitV2와 같은 파일 범위·스캐너 코어). 파일은 한 번에 읽는다 */
export function scanCommits(dir: string, repository: string, targets: { commit: string; ref: string; scannedAt: string }[], paths = ['packages']): ManifestV2[] {
  const lists = targets.map((t) => git(dir, ['ls-tree', '-r', '-z', t.commit, '--', ...paths]).split('\0').filter(Boolean).map((l) => {
    const [meta, path] = l.split('\t');
    return { path, blob: meta.split(' ')[2] };
  }).filter((x) => FLAG_SOURCE_FILE.test(x.path)));
  const blobs = [...new Set(lists.flat().map((x) => x.blob))];
  const raw = execFileSync('git', ['-c', `safe.directory=${dir.replace(/\\/g, '/')}`, '-C', dir, 'cat-file', '--batch'], { input: blobs.join('\n') + '\n', maxBuffer: 1024 * 1024 * 1024 });
  const content = new Map<string, string>();
  let pos = 0;
  for (const b of blobs) {
    const nl = raw.indexOf(0x0a, pos);
    const [sha, , size] = raw.subarray(pos, nl).toString('utf8').split(' ');
    if (sha !== b) throw new Error(`cat-file 응답 순서가 다릅니다: ${sha} ≠ ${b}`);
    const n = Number(size);
    content.set(b, raw.subarray(nl + 1, nl + 1 + n).toString('utf8'));
    pos = nl + 1 + n + 1;
  }
  return targets.map((t, i) => {
    const files = lists[i].map((x) => ({ path: x.path, source: content.get(x.blob)! }));
    const found = scanFlagFiles(files);
    return { format: 'ff-flag-source/v2', provider: 'GITHUB', repository, ref: t.ref, commit: t.commit, scannedAt: t.scannedAt, scanner: { name: 'ff-flag-scan', version: FLAG_SCANNER_VERSION }, filesScanned: files.length, usages: found.usages, unresolved: found.unresolved };
  });
}
