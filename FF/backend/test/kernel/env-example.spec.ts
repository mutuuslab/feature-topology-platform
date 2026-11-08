// 설치 환경 템플릿(docker/app/.env.example) ↔ 운영 모드 설정 검사(runtime-config.ts·auth-config.ts) 정합 — 출시 준비 RD-OPS-05.
// 운영에 필요한 설정이 템플릿에서 빠지면(새 필수 설정을 검사에만 넣고 템플릿을 잊으면) 실패한다. 템플릿에 시험·데모 손잡이가 들어가도 실패한다.
// readiness: RD-OPS-05
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runtimeConfigProblems } from '../../src/kernel/runtime-config';

const FF = join(__dirname, '..', '..', '..');
const TEMPLATE = join(FF, 'docker', 'app', '.env.example');
const text = readFileSync(TEMPLATE, 'utf8');

/** KEY=값 줄만(주석 제외) — 순서대로 */
const entries = text
  .split(/\r?\n/)
  .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l))
  .map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)] as const;
  });
const keys = entries.map(([k]) => k);
/** 주석으로 적어 둔 선택 설정(`# KEY=예`) — 값을 비워 두면 형식 검사에 걸리는 것(FF_VEHICLE_CERT_HEADER)은 주석으로 설명한다 */
const documented = [...keys, ...[...text.matchAll(/^#\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1])];
const SECRET = /SECRET|KEY|TOKEN|^FF_KEK$/;
/** 비밀 자리에 넣을 시험 값 — KEK는 base64 32바이트 형식이어야 한다 */
const fillSecret = (k: string) => (k === 'FF_KEK' ? Buffer.alloc(32, 9).toString('base64') : 'z'.repeat(48));

/** 비밀(빈 값)을 채운다 — 설치하는 사람이 할 일을 시험이 대신한다 */
const filled = (over: Record<string, string> = {}) => {
  const env: Record<string, string> = {};
  for (const [k, v] of entries) env[k] = v === '' && SECRET.test(k) ? fillSecret(k) : v;
  return { ...env, ...over };
};

/** 검사 소스가 읽는 환경 변수 이름 */
const sourceKeys = (file: string) => [...new Set([...readFileSync(join(FF, 'backend', 'src', 'kernel', file), 'utf8').matchAll(/env(?:\.([A-Z][A-Z0-9_]+)|\[['"]([A-Z][A-Z0-9_]+)['"]\])/g)].map((m) => m[1] ?? m[2]))];
const TEST_KNOBS = ['FF_CLOCK_AT', 'FF_SCHEDULER', 'FF_HSM_VEHICLE_ROOT', 'FF_DEMO_FIXTURES', 'FF_SYNTHETIC', 'FF_EXT_FIXTURES', 'FF_SEED_ANCHOR'];

describe('설치 환경 템플릿 docker/app/.env.example', () => {
  it('키가 겹치지 않는다', () => {
    expect(keys.length).toBe(new Set(keys).size);
  });

  it('비밀만 채우면 운영 모드 설정 검사를 그대로 통과한다 — 운영 필수 설정이 모두 들어 있다', () => {
    expect(runtimeConfigProblems(filled())).toEqual([]);
  });

  it('비밀을 채우지 않으면 부팅을 거부한다 — 템플릿의 비밀은 비어 있다(값을 커밋하지 않는다)', () => {
    const secrets = entries.filter(([k]) => SECRET.test(k));
    expect(secrets.length).toBeGreaterThan(0);
    for (const [k, v] of secrets) expect(v, `${k}는 템플릿에서 비어 있어야 한다`).toBe('');
    const p = runtimeConfigProblems(Object.fromEntries(entries)).join('\n');
    for (const k of ['FF_AUDIT_KEY', 'FF_SESSION_SECRET', 'OIDC_CLIENT_SECRET', 'FF_KEK']) expect(p).toContain(k);
  });

  it('템플릿에서 필수 키 하나를 빼면 검사가 그 키를 문제로 낸다 — 시험이 실제로 템플릿에 기대고 있다', () => {
    for (const k of ['FF_INSTANCE_ID', 'FF_DB', 'FF_AUDIT_ANCHOR_FILE', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'FF_PUBLIC_URL', 'OIDC_ROLE_MAP']) {
      const env = filled();
      delete env[k];
      expect(runtimeConfigProblems(env).join('\n'), `${k}를 빼면`).toContain(k);
    }
  });

  it('Unleash를 live로 바꾸면 주소·토큰 키가 이미 템플릿에 있다', () => {
    expect(runtimeConfigProblems(filled({ UNLEASH_MODE: 'live', UNLEASH_URL: 'https://unleash.customer.example' }))).toEqual([]);
  });

  it('OTA 서버로 전달(IF-05)하면 주석의 키를 풀고 비밀만 채우면 통과한다 — 빠지면 그 키를 문제로 낸다', () => {
    const ota = Object.fromEntries([...text.matchAll(/^#\s*(FF_OTA_[A-Z_]+)=(.*)$/gm)].map((m) => [m[1], m[2] || (SECRET.test(m[1]) && !m[1].endsWith('_PREVIOUS') ? fillSecret(m[1]) : '')]).filter(([, v]) => v !== ''));
    expect(Object.keys(ota)).toEqual(expect.arrayContaining(['FF_OTA_URL', 'FF_OTA_TOKEN_URL', 'FF_OTA_CLIENT_ID', 'FF_OTA_CLIENT_SECRET', 'FF_OTA_WEBHOOK_SECRET']));
    expect(runtimeConfigProblems(filled({ ...ota, FF_VEHICLE_CHANNEL: 'ota' }))).toEqual([]);
    const { FF_OTA_WEBHOOK_SECRET: _, ...missing } = ota;
    expect(runtimeConfigProblems(filled({ ...missing, FF_VEHICLE_CHANNEL: 'ota' })).join(' / ')).toContain('FF_OTA_WEBHOOK_SECRET');
  });

  it('설정 검사가 읽는 변수는 모두 템플릿에 설명과 함께 있다(시험·데모 손잡이만 예외)', () => {
    // KEK는 이름을 조합해 읽는다(kms/key-protection.ts readKeyMaterial) — 이름을 직접 적는다
    const read = [...sourceKeys('runtime-config.ts'), ...sourceKeys(join('auth', 'auth-config.ts')), ...sourceKeys('vehicle-auth-config.ts'), ...sourceKeys('ota-config.ts'), 'FF_KEK', 'FF_KEK_FILE', 'FF_KEK_PREVIOUS'].filter((k) => !TEST_KNOBS.includes(k));
    expect(read.length).toBeGreaterThan(15);
    const missing = read.filter((k) => !documented.includes(k));
    expect(missing, '템플릿에 없는 운영 설정 — docker/app/.env.example에 추가').toEqual([]);
  });

  it('시험·데모 손잡이는 템플릿에 없다', () => {
    expect(keys.filter((k) => TEST_KNOBS.includes(k))).toEqual([]);
  });

  it('줄마다 설명이 붙어 있다 — 키 바로 위가 주석이거나 같은 묶음의 주석 아래', () => {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!/^[A-Z][A-Z0-9_]*=/.test(lines[i])) continue;
      let j = i - 1;
      while (j >= 0 && /^[A-Z][A-Z0-9_]*=/.test(lines[j])) j--;
      expect(lines[j]?.startsWith('#'), `${lines[i].split('=')[0]} 위에 설명 주석이 없다`).toBe(true);
    }
  });
});
