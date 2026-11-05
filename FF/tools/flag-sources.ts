// npm run flags:scan -- --repo <Git 작업 폴더> --url <저장소 HTTPS 주소> [--ref HEAD] [--path <소스 경로>] [--out <JSON>]
// 작업 중인 파일이 아니라 Git 커밋의 바이트에서 정적 SDK 호출을 찾는다. CI 결과를 FF에 가져오면 Flag에서 실제 코드까지 추적할 수 있다.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const METHODS = new Set(['getBooleanValue', 'getBooleanDetails', 'getStringValue', 'getNumberValue', 'getObjectValue', 'isEnabled', 'getVariant']);
export interface FlagUsage {
  flagKey: string;
  path: string;
  line: number;
  symbol: string;
  method: string;
  safeDefault: 'EXPLICIT_FALSE' | 'SDK_DEFAULT' | 'UNCONFIRMED';
  contentHash: string;
}

export function scanFlagSource(source: string, path: string): { usages: FlagUsage[]; unresolved: number } {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, /x$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const usages: FlagUsage[] = [];
  let unresolved = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const method = ts.isPropertyAccessExpression(expression) ? expression.name.text : ts.isIdentifier(expression) ? expression.text : '';
      if (METHODS.has(method)) {
        const key = node.arguments[0];
        if (key && (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key))) {
          usages.push({
            flagKey: key.text, path, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
            symbol: expression.getText(file), method,
            safeDefault: method === 'isEnabled' || method === 'getVariant' ? 'SDK_DEFAULT' : node.arguments[1]?.kind === ts.SyntaxKind.FalseKeyword ? 'EXPLICIT_FALSE' : 'UNCONFIRMED',
            contentHash: 'sha256:' + createHash('sha256').update(source).digest('hex'),
          });
        } else unresolved++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { usages, unresolved };
}

/** HTTPS 저장소 주소에는 인증 정보·질의·fragment를 넣지 않는다. 링크에 자격 증명이 남는 것을 막는다. */
export function repositoryUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('저장소 주소는 인증 정보·질의가 없는 HTTPS 주소여야 합니다.');
  return url.href.replace(/\.git\/?$/, '').replace(/\/$/, '');
}

export function sourceUrl(provider: 'GITLAB' | 'GITHUB', repo: string, commit: string, path: string, line: number): string {
  const base = repositoryUrl(repo);
  return `${base}/${provider === 'GITLAB' ? '-/blob' : 'blob'}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}#L${line}`;
}

export function scanGit(repo: string, url: string, ref = 'HEAD', paths: string[] = []) {
  const git = (...args: string[]) => execFileSync('git', ['-c', `safe.directory=${resolve(repo).replace(/\\/g, '/')}`, '-C', repo, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const repoUrl = repositoryUrl(url);
  const commit = git('rev-parse', '--verify', `${ref}^{commit}`).trim();
  const provider = new URL(repoUrl).hostname === 'github.com' ? 'GITHUB' as const : 'GITLAB' as const;
  const files = git('ls-tree', '-r', '--name-only', '-z', commit, '--', ...paths).split('\0').filter((p) => /\.[cm]?[jt]sx?$/.test(p));
  if (files.length > 5000) throw new Error('소스 파일이 5,000개를 넘습니다. --path로 소비 애플리케이션 범위를 지정하세요.');
  const usages: FlagUsage[] = [];
  let unresolved = 0;
  for (const path of files) {
    const source = git('show', `${commit}:${path}`);
    const found = scanFlagSource(source, path);
    usages.push(...found.usages);
    unresolved += found.unresolved;
  }
  return { format: 'ff-flag-source/v1' as const, provider, repository: repoUrl, commit, scannedAt: new Date().toISOString(), filesScanned: files.length, unresolvedCalls: unresolved, usages };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const args = process.argv.slice(2);
  const arg = (key: string, fallback?: string) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
  try {
    const repo = arg('--repo');
    const url = arg('--url');
    if (!repo || !url) throw new Error('사용: npm run flags:scan -- --repo <Git 폴더> --url <HTTPS 저장소 주소> [--ref HEAD] [--path 소스 경로] [--out JSON]');
    const path = arg('--path');
    const manifest = scanGit(repo, url, arg('--ref', 'HEAD'), path ? [path] : []);
    const json = JSON.stringify(manifest, null, 2) + '\n';
    const out = arg('--out');
    if (out) writeFileSync(out, json);
    else process.stdout.write(json);
  } catch (error) {
    console.error(error instanceof Error && !('status' in error) ? error.message : 'Git 커밋을 읽지 못했습니다. 폴더와 ref를 확인하세요.');
    process.exitCode = 1;
  }
}
