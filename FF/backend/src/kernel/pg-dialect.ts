// SQLite 방언 → PostgreSQL 방언 번역(D-RD-3 PostgreSQL 이전 1단계, docs/20-architecture/20-92).
// 코드 곳곳의 SQL은 SQLite 방언으로 쓰여 있다. 1단계는 SQL을 고치지 않고 PG 어댑터가 실행 직전에 번역한다 —
// 번역이 감당하지 못하는 마이그레이션만 { pg } 덮어쓰기로 따로 둔다(migrations.ts). 번역 규칙은 여기 한 곳.
//   · 자리표시자 ? → $1..$n (문자열 안은 건드리지 않는다)
//   · INSERT OR IGNORE → INSERT … ON CONFLICT DO NOTHING
//   · INSERT … → … RETURNING <정수 키 | rowid> (lastInsertRowid 대신)
//   · json_extract(x, '$.a.b') → (x)::jsonb #>> '{a,b}'
//   · LIKE → ILIKE (SQLite LIKE는 ASCII 대소문자를 가리지 않는다)
//   · INDEXED BY 색인 / NOT INDEXED(SQLite 플래너 지정) → 지운다(PG는 색인 지정 문법이 없다, 플래너가 고른다)
//   · a IS b / a IS NOT b(값 비교) → IS NOT DISTINCT FROM / IS DISTINCT FROM (PG의 IS 뒤는 NULL·TRUE·FALSE·UNKNOWN만)
//   · 대소문자 섞인 별칭 AS featureId → AS "featureId" (PG는 따옴표 없는 이름을 소문자로 접는다)
//   · DDL: INTEGER → BIGINT, REAL → DOUBLE PRECISION, BLOB → BYTEA, INTEGER PRIMARY KEY AUTOINCREMENT → IDENTITY,
//     정수 키 없는 표에 rowid IDENTITY 열 추가, CREATE/DROP TRIGGER … RAISE(ABORT) → plpgsql 함수 + 트리거, PRAGMA 제거
export interface DialectContext {
  /** 표 → 정수 키 열(INTEGER PRIMARY KEY) — INSERT … RETURNING에 쓴다 */
  readonly intKey: Map<string, string>;
  /** 트리거 → 표 (PG의 DROP TRIGGER는 표 이름이 필요하다) */
  readonly triggerTable: Map<string, string>;
}

export interface Translated {
  text: string;
  /** INSERT에 RETURNING을 붙였다 — 첫 행 첫 열이 lastInsertRowid */
  returnsId: boolean;
  /** 실행할 것이 없다(PRAGMA 등) */
  noop: boolean;
  /** 결과 행에 rowid를 남긴다(SQL이 rowid를 직접 언급) */
  keepRowid: boolean;
}

const LIT = '\u0000';

const SQLITE_MASTER =
  "(SELECT table_name::text AS name, 'table' AS type, table_name::text AS tbl_name FROM information_schema.tables WHERE table_schema = current_schema()" +
  " UNION ALL SELECT indexname::text, 'index', tablename::text FROM pg_indexes WHERE schemaname = current_schema()" +
  " UNION ALL SELECT t.tgname::text, 'trigger', c.relname::text FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace s ON s.oid = c.relnamespace" +
  ' WHERE NOT t.tgisinternal AND s.nspname = current_schema()) AS sqlite_master';

/** 문자열 리터럴('…')·따옴표 이름("…")·주석을 자리표로 바꿔 코드만 남긴다 */
function mask(sql: string): { code: string; lits: string[] } {
  const lits: string[] = [];
  let out = '';
  for (let i = 0; i < sql.length; ) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) break;
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      lits.push(sql.slice(i, j + 1));
      out += `${LIT}${lits.length - 1}${LIT}`;
      i = j + 1;
    } else if (c === '-' && sql[i + 1] === '-') {
      const j = sql.indexOf('\n', i);
      i = j < 0 ? sql.length : j;
    } else if (c === '/' && sql[i + 1] === '*') {
      const j = sql.indexOf('*/', i + 2);
      i = j < 0 ? sql.length : j + 2;
    } else {
      out += c;
      i++;
    }
  }
  return { code: out, lits };
}

const unmask = (code: string, lits: string[]) => code.replace(new RegExp(`${LIT}(\\d+)${LIT}`, 'g'), (_, n) => lits[Number(n)]);
const litValue = (lit: string) => lit.slice(1, -1).replace(/''/g, "'");
const LIT_RE = `${LIT}(\\d+)${LIT}`;

/** 마이그레이션 SQL을 훑어 표의 정수 키·트리거의 표를 모은다(번역 문맥) */
export function dialectContextOf(migrations: readonly { sql: string; pg?: string }[]): DialectContext {
  const intKey = new Map<string, string>();
  const triggerTable = new Map<string, string>();
  for (const m of migrations) {
    const { code } = mask(m.sql);
    for (const t of code.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(/gi)) {
      const body = parenBody(code, t.index! + t[0].length - 1);
      const k = /(?:^|[(,])\s*(\w+)\s+INTEGER\s+PRIMARY\s+KEY\b/i.exec(body);
      if (k) intKey.set(t[1].toLowerCase(), k[1]);
      else intKey.delete(t[1].toLowerCase());
    }
    for (const t of code.matchAll(/CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+(?:BEFORE|AFTER|INSTEAD\s+OF)\s+\w+(?:\s+OF\s+[\w\s,]+?)?\s+ON\s+(\w+)/gi)) {
      triggerTable.set(t[1].toLowerCase(), t[2]);
    }
  }
  return { intKey, triggerTable };
}

/** code[open] === '(' 의 짝 괄호까지 안쪽 */
function parenBody(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) return code.slice(open + 1, i);
  }
  throw new Error(`괄호 짝이 맞지 않습니다: ${code.slice(open, open + 60)}`);
}

/** CREATE TABLE: 정수 키가 없으면 rowid 열을 맨 뒤에 더한다(SQLite 암묵 rowid의 대신) */
function createTables(code: string): string {
  let out = '';
  let last = 0;
  for (const t of code.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(/gi)) {
    const open = t.index! + t[0].length - 1;
    const body = parenBody(code, open);
    const close = open + body.length + 1;
    const hasIntKey = /(?:^|[(,])\s*\w+\s+INTEGER\s+PRIMARY\s+KEY\b/i.test(body);
    out += code.slice(last, close);
    if (!hasIntKey) out += ',\n  rowid BIGINT GENERATED ALWAYS AS IDENTITY';
    last = close;
  }
  return out + code.slice(last);
}

function triggers(code: string, ctx: DialectContext): string {
  code = code.replace(
    /CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+(BEFORE|AFTER)\s+(DELETE|UPDATE|INSERT)((?:\s+OF\s+[\w\s,]+?)?)\s+ON\s+(\w+)(?:\s+FOR\s+EACH\s+ROW)?(?:\s+WHEN\s+([\s\S]+?))?\s+BEGIN\s+([\s\S]+?)\s*;\s*END\s*;?/gi,
    (_m, name: string, when: string, op: string, of: string, table: string, cond: string | undefined, body: string) => {
      const raise = new RegExp(`^SELECT\\s+RAISE\\s*\\(\\s*ABORT\\s*,\\s*(${LIT_RE})\\s*\\)$`, 'i').exec(body.trim());
      if (!raise) throw new Error(`PG 번역이 지원하지 않는 트리거 본문입니다(${name}) — 마이그레이션에 pg 덮어쓰기를 두세요`);
      const fn = `ff_trg_${name}`;
      const ret = op.toUpperCase() === 'DELETE' ? 'OLD' : 'NEW';
      return (
        `CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $ff$ BEGIN IF ${cond ? `(${cond})` : 'TRUE'} THEN RAISE EXCEPTION '%', ${raise[1]}; END IF; RETURN ${ret}; END $ff$;\n` +
        `CREATE TRIGGER ${name} ${when} ${op}${of} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}();`
      );
    },
  );
  return code.replace(/DROP\s+TRIGGER\s+(IF\s+EXISTS\s+)?(\w+)\s*(;|$)/gi, (_m, ifx: string | undefined, name: string, end: string) => {
    const table = ctx.triggerTable.get(name.toLowerCase());
    if (!table) throw new Error(`DROP TRIGGER ${name}: 어느 표의 트리거인지 모릅니다`);
    return `DROP TRIGGER ${ifx ?? ''}${name} ON ${table}${end}`;
  });
}

function jsonExtract(code: string, lits: string[]): string {
  return code.replace(new RegExp(`json_extract\\s*\\(\\s*([\\w.]+)\\s*,\\s*${LIT_RE}\\s*\\)`, 'gi'), (m, expr: string, n: string) => {
    const path = litValue(lits[Number(n)]);
    if (!/^\$(\.\w+)+$/.test(path)) throw new Error(`PG 번역이 지원하지 않는 JSON 경로입니다: ${path}`);
    const keys = path.slice(2).split('.');
    lits.push(`'{${keys.join(',')}}'`);
    return `((${expr})::jsonb #>> ${LIT}${lits.length - 1}${LIT})`;
  });
}

/** 문(statement) 하나를 번역한다. ddl=true면 마이그레이션·exec 문맥(자리표시자 없음) */
export function translate(sql: string, ctx: DialectContext, opts: { ddl?: boolean } = {}): Translated {
  const { code: masked, lits } = mask(sql);
  let code = masked;
  const keepRowid = /\browid\b/i.test(code);

  code = code.replace(/^\s*PRAGMA\b[^;]*;?/gim, '');
  if (!code.trim()) return { text: '', returnsId: false, noop: true, keepRowid };
  code = code.replace(/\bBEGIN\s+(IMMEDIATE|EXCLUSIVE|DEFERRED)\b/gi, 'BEGIN');

  // DDL은 run()으로 와도 DDL로 번역한다(시험이 트리거를 지우는 경우 등)
  const ddl = opts.ddl || /^\s*(CREATE|DROP|ALTER)\b/i.test(code);
  if (ddl) {
    code = triggers(code, ctx);
    code = createTables(code);
    code = code.replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY');
    code = code.replace(/\bREAL\b/g, 'DOUBLE PRECISION').replace(/\bBLOB\b/g, 'BYTEA');
  }
  code = code.replace(/\bINTEGER\b/g, 'BIGINT');
  // rowid — 정수 키가 있는 표(SQLite에서 rowid의 별칭)는 그 열로, 없는 표는 덧붙인 rowid 열 그대로
  if (keepRowid && !opts.ddl) {
    const table = /\b(?:FROM|UPDATE|INTO)\s+(\w+)/i.exec(code)?.[1]?.toLowerCase();
    const key = table ? ctx.intKey.get(table) : undefined;
    if (key) code = code.replace(/(?<!\bAS\s+)\browid\b/gi, key);
  }
  code = code.replace(/\s+(?:INDEXED\s+BY\s+\w+|NOT\s+INDEXED)\b/gi, '');
  code = jsonExtract(code, lits);
  // sqlite_master(표·색인·트리거 목록) → 현재 스키마의 카탈로그
  code = code.replace(/\bsqlite_master\b/gi, SQLITE_MASTER);
  code = code.replace(/\bNOT\s+LIKE\b/gi, 'NOT ILIKE').replace(/(?<!NOT\s+|I)\bLIKE\b/gi, 'ILIKE');
  code = code.replace(/\bAS\s+([A-Za-z_]\w*)\b/g, (m, alias: string) => (/[a-z]/.test(alias) && /[A-Z]/.test(alias) ? `AS "${alias}"` : m));
  // SQLite의 IS는 NULL을 같게 보는 값 비교(자리표시자·열·리터럴) — PG에서는 DISTINCT FROM. IS NULL·TRUE·FALSE·UNKNOWN·DISTINCT는 그대로
  code = code
    .replace(/\bIS\s+NOT\s+(?!NULL\b|TRUE\b|FALSE\b|UNKNOWN\b|DISTINCT\b)/gi, 'IS DISTINCT FROM ')
    .replace(/\bIS\s+(?!NOT\b|NULL\b|TRUE\b|FALSE\b|UNKNOWN\b|DISTINCT\b)/gi, 'IS NOT DISTINCT FROM ');

  let returnsId = false;
  const ignore = /^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(code);
  if (ignore) code = code.replace(/^(\s*)INSERT\s+OR\s+IGNORE\s+INTO\b/i, '$1INSERT INTO');
  const ins = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(code);
  if (ins && !opts.ddl) {
    code = code.replace(/;\s*$/, '');
    if (ignore) code += ' ON CONFLICT DO NOTHING';
    if (!/\bRETURNING\b/i.test(code)) {
      code += ` RETURNING ${ctx.intKey.get(ins[1].toLowerCase()) ?? 'rowid'}`;
      returnsId = true;
    }
  } else if (ignore) {
    code = code.replace(/;\s*$/, '') + ' ON CONFLICT DO NOTHING';
  }

  if (!opts.ddl) {
    let n = 0;
    code = code.replace(/\?/g, () => `$${++n}`);
  }
  return { text: unmask(code, lits), returnsId, noop: false, keepRowid };
}

/** 여러 문을 담은 SQL(마이그레이션)을 문 단위로 나눈다 — 트리거 BEGIN…END 안의 ;는 나누지 않는다 */
export function splitStatements(sql: string): string[] {
  const { code, lits } = mask(sql);
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  const words = code.split(/(;|\bBEGIN\b|\bEND\b|\bCASE\b)/i);
  for (const w of words) {
    const u = w.toUpperCase();
    if (u === 'BEGIN' || u === 'CASE') depth++;
    else if (u === 'END' && depth > 0) depth--;
    if (w === ';' && depth === 0) {
      if (cur.trim()) out.push(unmask(cur, lits).trim() + ';');
      cur = '';
    } else cur += w;
  }
  if (cur.trim()) out.push(unmask(cur, lits).trim());
  return out;
}

/** 마이그레이션 한 건을 PG 문으로(덮어쓰기가 있으면 그대로) */
export function translateMigration(m: { sql: string; pg?: string }, ctx: DialectContext): string {
  if (m.pg !== undefined) return m.pg;
  return splitStatements(m.sql)
    .map((s) => translate(s, ctx, { ddl: true }))
    .filter((t) => !t.noop)
    .map((t) => t.text.replace(/;?\s*$/, ';'))
    .join('\n');
}
