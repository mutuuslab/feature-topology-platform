// 공개 정적 데모의 로컬 PC 의존 검사(2026-11-06 로컬 의존 점검) — api-snapshot·dist 안에 빌드 PC 흔적이 없어야 한다:
// localhost·127.0.0.1·사설 IP(10/172.16-31/192.168)·Windows 절대 경로(X:\ X:/)·/home/·/tmp/·AppData·빌드 사용자 이름.
// 라이브러리 기본 문자열은 ALLOW에 이유와 함께 최소로 둔다. 사용: node tools/local-leaks.ts <폴더>... (발견하면 종료 1)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Leak {
  file: string;
  kind: string;
  match: string;
  context: string;
}

/** 검사하는 글자 파일(그림·글꼴·엑셀 등 바이너리는 뺀다) */
const TEXT = new Set(['.json', '.js', '.mjs', '.cjs', '.css', '.html', '.htm', '.txt', '.log', '.md', '.svg', '.map', '.xml', '.csv', '.webmanifest', '']);

export const RULES: { kind: string; re: RegExp }[] = [
  { kind: 'localhost', re: /localhost/gi },
  { kind: 'loopback', re: /\b127\.0\.0\.1\b|\b0\.0\.0\.0\b/g },
  { kind: 'private-ip', re: /(?<![\d.])(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}(?![\d.])/g },
  // 드라이브 글자(대문자 — Node·OS가 내는 모양) + 구분자 + 폴더 + 구분자(JSON의 \\ 포함) + 다음 이름 — 축약 코드 'c?A:/re/.test'는 빠진다
  { kind: 'windows-path', re: /(?<![A-Za-z0-9_$])[A-Z]:(?:\\\\|\\|\/)[A-Za-z0-9_][\w .-]*(?:\\\\|\\|\/)\w/g },
  // /home/<계정>/… — 화면 경로 '/home/customize'(하위 폴더 없음)는 빠진다
  { kind: 'posix-path', re: /(?<![\w.:/-])\/(?:(?:home|Users)\/[\w.-]+\/|tmp\/[\w.-]|mnt\/[a-z]\/|var\/folders\/)/g },
  { kind: 'appdata', re: /AppData/g },
];

/** 허용 — 공개본에 있어도 빌드 PC와 상관없는 라이브러리 기본 문자열(파일 종류·글자 그대로) */
export const ALLOW: { why: string; file: RegExp; text: string }[] = [
  { why: 'react-router — 기준 URL이 없을 때 쓰는 자리표시 원점(요청하지 않는다)', file: /\.js$/, text: '"http://localhost"' },
  // Supplier artifact validation rejects private/local hosts; these exact regex literals are rules, never request targets.
  { why: '협력사 공개 HTTPS 산출물 검증 — 로컬·사설 호스트 거부 정규식', file: /(?:^|\/)supplier-[\w-]+\.js$/, text: '/^(localhost|127\\.|0\\.|10\\.|192\\.168\\.|169\\.254\\.|172\\.(1[6-9]|2\\d|3[01])\\.)/i' },
  { why: '협력사 공개 HTTPS 산출물 검증 — 로컬 도메인 접미사 거부 정규식', file: /(?:^|\/)supplier-[\w-]+\.js$/, text: '/\\.(localhost|local|internal)$/i' },
];

/** 빌드 사용자 이름(4자 이상만 — 짧으면 일반 단어와 겹친다) */
export function userNames(): string[] {
  const names = new Set<string>();
  try {
    names.add(userInfo().username);
  } catch {
    /* 계정 정보를 못 읽는 환경 */
  }
  for (const k of ['USERNAME', 'USER']) if (process.env[k]) names.add(process.env[k]!);
  return [...names].filter((n) => n.length >= 4);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 글자 하나에서 찾는다 — 허용 문자열은 먼저 지운다 */
export function scanText(text: string, file = 'x.json', users: string[] = userNames()): Leak[] {
  let t = text;
  for (const a of ALLOW) if (a.file.test(file)) t = t.split(a.text).join(' ');
  const rules = [...RULES, ...users.map((u) => ({ kind: 'user-name', re: new RegExp(`(?<![A-Za-z0-9])${escape(u)}(?![a-z0-9])`, 'g') }))];
  const out: Leak[] = [];
  for (const { kind, re } of rules) {
    for (const m of t.matchAll(re)) {
      // Common machine-account names are also ordinary technical words. Keep identity-value
      // checks; absolute account paths remain covered by RULES independently.
      if (kind === 'user-name' && /^(runner|root|admin|user|build|system)$/i.test(m[0]) && !/["']?\b(?:user(?:name)?|by|created[_-]?by|updated[_-]?by|author|owner|actor(?:Id)?|id)\b["']?\s*:\s*["']\s*$/i.test(t.slice(Math.max(0, m.index! - 100), m.index!))) continue;
      out.push({ file, kind, match: m[0], context: t.slice(Math.max(0, m.index! - 50), m.index! + m[0].length + 50).replace(/\s+/g, ' ') });
      if (out.filter((x) => x.kind === kind).length >= 3) break; // 같은 파일·같은 종류는 3건까지만 보인다
    }
  }
  return out;
}

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (TEXT.has(extname(name).toLowerCase())) out.push(p);
  }
  return out;
}

/** 폴더들을 훑는다 — 파일 경로는 그 폴더 기준 */
export function scanDirs(dirs: string[], users: string[] = userNames()): Leak[] {
  const out: Leak[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) throw new Error(`검사할 폴더가 없습니다: ${dir}`);
    for (const p of files(dir)) {
      const buf = readFileSync(p);
      if (buf.includes(0)) continue; // 글자 파일이 아니다
      out.push(...scanText(buf.toString('utf8'), relative(dir, p).replace(/\\/g, '/'), users).map((l) => ({ ...l, file: `${relative(process.cwd(), dir).replace(/\\/g, '/') || '.'}/${l.file}` })));
    }
  }
  return out;
}

export function report(leaks: Leak[], max = 40): string {
  const kinds = [...new Set(leaks.map((l) => l.kind))].map((k) => `${k} ${leaks.filter((l) => l.kind === k).length}`).join(' · ');
  return [`로컬 PC 흔적 ${leaks.length}건 (${kinds})`, ...leaks.slice(0, max).map((l) => `  ${l.kind}  ${l.file}  «${l.match}»  …${l.context}…`), leaks.length > max ? `  … ${leaks.length - max}건 더` : ''].filter(Boolean).join('\n');
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const dirs = process.argv.slice(2);
  if (!dirs.length) {
    console.error('사용: node tools/local-leaks.ts <폴더>...');
    process.exit(2);
  }
  const leaks = scanDirs(dirs.map((d) => resolve(d)));
  if (leaks.length) {
    console.error(report(leaks));
    process.exit(1);
  }
  console.log(`local-leaks — ${dirs.join(', ')}: 로컬 PC 흔적 0건`);
}
