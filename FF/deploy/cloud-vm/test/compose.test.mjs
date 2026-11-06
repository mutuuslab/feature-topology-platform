// 클라우드 VM 구성 검사(20-99) — 실제 compose 해석 결과(docker compose config)로 공개 범위·내부망·인증 설정·비밀 전달을 확인한다.
//   node --test deploy/cloud-vm/test/compose.test.mjs      (docker CLI가 없으면 compose 해석 시험은 건너뛴다)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'ff-cloud-vm-'));
const ENV = join(tmp, '.env');
const run = (cmd, args, env = {}) => spawnSync(cmd, args, { cwd: KIT, encoding: 'utf8', env: { ...process.env, ...env } });
const hasDocker = run('docker', ['compose', 'version']).status === 0;
const hasBash = run('bash', ['--version']).status === 0;
let config = null;

const parseEnv = (text) => Object.fromEntries(text.split(/\r?\n/).filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

before(() => {
  if (!hasBash) return;
  const r = run('bash', ['scripts/gen-secrets.sh', '--ip', '203.0.113.10', '--email', 'ops@example.com'], { FF_ENV_FILE: ENV });
  assert.equal(r.status, 0, r.stderr);
  if (!hasDocker) return;
  const c = run('docker', ['compose', '--project-directory', KIT, '-f', join(KIT, 'docker-compose.yml'), '--env-file', ENV, 'config', '--format', 'json']);
  assert.equal(c.status, 0, c.stderr);
  config = JSON.parse(c.stdout);
});
after(() => rmSync(tmp, { recursive: true, force: true }));

test('비밀 생성 — 템플릿의 빈 값을 모두 채우고 화면에 값을 찍지 않는다, 두 번째 실행은 덮어쓰지 않는다', { skip: !hasBash }, () => {
  const tpl = parseEnv(readFileSync(join(KIT, '.env.example'), 'utf8'));
  const env = parseEnv(readFileSync(ENV, 'utf8'));
  assert.deepEqual(Object.keys(env), Object.keys(tpl));
  // 비워 두는 것은 선택 설정뿐
  const optional = ['FF_COMPOSE_EXTRA', 'FF_IMAGE_SIGNER', 'FF_DEMO_LOGIN_ID', 'FF_DEMO_PASSWORD', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_ROLE_MAP', 'OIDC_ROLE_CLAIM', 'BACKUP_RCLONE_REMOTE', 'BACKUP_RCLONE_PLAINTEXT'];
  for (const [k, v] of Object.entries(tpl)) if (v === '' && !optional.includes(k)) assert.notEqual(env[k], '', `${k}가 비었다`);
  assert.equal(env.FF_DOMAIN, '203-0-113-10.sslip.io');
  assert.equal(env.FF_PUBLIC_URL, 'https://203-0-113-10.sslip.io');
  for (const k of ['PG_ADMIN_PASSWORD', 'FF_DB_PASSWORD', 'UNLEASH_DB_PASSWORD']) assert.match(env[k], /^[0-9a-f]{64}$/, `${k} — init-databases.sh 규칙`);
  assert.equal(Buffer.from(env.FF_KEK, 'base64').length, 32);
  assert.match(env.UNLEASH_ADMIN_TOKEN, /^\*:\*\.[0-9a-f]{64}$/);
  // 템플릿에는 비밀 값이 없다
  for (const k of ['FF_SESSION_SECRET', 'FF_KEK', 'FF_AUDIT_KEY', 'PG_ADMIN_PASSWORD', 'UNLEASH_ADMIN_TOKEN', 'GITLAB_WEBHOOK_TOKEN']) assert.equal(tpl[k], '', `${k}는 템플릿에서 비어야 한다`);
  const again = run('bash', ['scripts/gen-secrets.sh', '--ip', '203.0.113.10', '--email', 'ops@example.com'], { FF_ENV_FILE: ENV });
  assert.notEqual(again.status, 0);
  assert.ok(!/[0-9a-f]{64}/.test(again.stdout + again.stderr), '값을 출력하지 않는다');
});

test('바깥에 여는 포트는 Caddy의 80·443뿐 — DB·Unleash·Edge·FF는 호스트 포트가 없다', { skip: !config }, () => {
  for (const [name, svc] of Object.entries(config.services)) {
    const published = (svc.ports ?? []).map((p) => `${p.published}/${p.protocol ?? 'tcp'}`);
    if (name === 'caddy') assert.deepEqual(published.sort(), ['443/tcp', '443/udp', '80/tcp']);
    else assert.deepEqual(published, [], `${name}가 호스트 포트를 연다`);
  }
});

test('DB·Unleash·Edge는 인터넷과 끊긴 내부망에만, FF는 앞단과 내부망 둘 다', { skip: !config }, () => {
  const internal = Object.entries(config.networks).filter(([, n]) => n.internal).map(([k]) => k);
  assert.deepEqual(internal, ['backend']);
  for (const s of ['db', 'web', 'edge']) assert.deepEqual(Object.keys(config.services[s].networks), ['backend'], s);
  assert.deepEqual(Object.keys(config.services.app.networks).sort(), ['backend', 'front']);
  assert.deepEqual(Object.keys(config.services.caddy.networks), ['front']);
});

test('기존 구성(docker/unleash)의 고정 이미지를 그대로 쓰고, Caddy도 다이제스트로 고정한다', { skip: !config }, () => {
  const base = readFileSync(join(KIT, '..', '..', 'docker', 'unleash', 'docker-compose.yml'), 'utf8');
  for (const s of ['db', 'web', 'edge']) {
    assert.match(config.services[s].image, /@sha256:[0-9a-f]{64}$/, s);
    assert.ok(base.includes(config.services[s].image), `${s} 이미지가 기존 구성과 다르다`);
  }
  assert.match(config.services.caddy.image, /^caddy:[\d.]+-alpine@sha256:[0-9a-f]{64}$/);
});

test('FF — 시연 데이터 + 공개 데모 게이트 + 차량 인증 필수, 운영 모드가 아니다, 컨테이너 권한 최소', { skip: !config }, () => {
  const app = config.services.app;
  const e = app.environment;
  assert.equal(e.FF_AUTH, 'demo');
  assert.equal(e.FF_DEMO_GATE, 'on');
  assert.equal(e.FF_VEHICLE_AUTH, 'required');
  assert.notEqual(e.FF_ENV, 'production');
  assert.equal(e.FF_SEED, 'v0.81');
  assert.equal(e.FF_SHOWCASE, '1');
  assert.equal(e.FF_TRUST_PROXY, 'uniquelocal');
  assert.match(e.FF_PUBLIC_URL, /^https:\/\//);
  assert.match(e.FF_DB_URL, /^postgresql:\/\/ff_app:[0-9a-f]{64}@db:5432\/feature_platform$/);
  assert.equal(e.UNLEASH_MODE, 'live');
  // 관리자 비밀은 FF 컨테이너에 넘기지 않는다(PostgreSQL 관리자·Unleash 관리 화면 비밀번호)
  for (const k of ['PG_ADMIN_PASSWORD', 'UNLEASH_ADMIN_PASSWORD', 'UNLEASH_DB_PASSWORD']) assert.ok(!(k in e), `${k}가 FF에 넘어간다`);
  assert.ok(!app.env_file?.length, '.env 전체를 넘기지 않는다');
  assert.equal(app.read_only, true);
  assert.deepEqual(app.cap_drop, ['ALL']);
  assert.ok(!app.profiles?.length);
  assert.equal(app.build.args.FF_WEB_AUTH, 'demo');
});

test('Caddy — 차량 인증서 주체 머리글을 지우고, 바깥 webhook·지표를 닫는다', () => {
  const caddy = readFileSync(join(KIT, 'caddy', 'Caddyfile'), 'utf8');
  assert.match(caddy, /request_header -X-Client-Cert-Subject/);
  assert.match(caddy, /@closed path .*\/api\/webhooks\/\*.*\/api\/health\/metrics/);
  assert.match(caddy, /admin off/);
  const mtls = readFileSync(join(KIT, 'caddy', 'vehicle-mtls.caddy'), 'utf8');
  assert.match(mtls, /mode require_and_verify/);
  assert.match(mtls, /request_header -X-Client-Cert-Subject/);
});

test('공개 전 확인(preflight) — 게이트를 끈 데모 인증과 latest 이미지를 거부한다', { skip: !hasBash }, () => {
  const original = readFileSync(ENV, 'utf8');
  const pre = (over) => {
    const env = join(tmp, `.env.${Object.keys(over).join('-')}`);
    const text = Object.entries(over).reduce((t, [k, v]) => t.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`), original);
    writeFileSync(env, text);
    return run('bash', ['-c', '. scripts/lib.sh && preflight'], { FF_ENV_FILE: env });
  };
  assert.equal(pre({}).status, 0, pre({}).stderr);
  const gateOff = pre({ FF_DEMO_GATE: 'off' });
  assert.notEqual(gateOff.status, 0);
  assert.match(gateOff.stderr, /FF_DEMO_GATE/);
  assert.equal(pre({ FF_AUTH: 'oidc', FF_DEMO_GATE: 'off' }).status, 0, 'OIDC는 게이트 없이 된다');
  for (const image of ['ghcr.io/mutuuslab/feature-platform:latest', 'ghcr.io/mutuuslab/feature-platform', 'localhost:5000/ff']) {
    const r = pre({ FF_IMAGE: image });
    assert.notEqual(r.status, 0, image);
    assert.match(r.stderr, /FF_IMAGE/);
  }
  assert.equal(pre({ FF_IMAGE: `ghcr.io/mutuuslab/feature-platform@sha256:${'a'.repeat(64)}` }).status, 0);
  assert.equal(pre({ FF_IMAGE: 'localhost:5000/ff:v1' }).status, 0);
});

// ── 하네스 2판(2026-11-06) — 적대적 리뷰에서 찾은 우회·약점의 회귀 시험 ──

test('공개 전 확인 — FF_AUTH 표기 변형(따옴표·대소문자·공백)으로 게이트 없는 데모 인증을 통과시키지 않는다', { skip: !hasBash }, () => {
  const original = readFileSync(ENV, 'utf8');
  const pre = (over, name) => {
    const env = join(tmp, `.env.auth-${name}`);
    const text = Object.entries(over).reduce((t, [k, v]) => t.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`), original);
    writeFileSync(env, text);
    return run('bash', ['-c', '. scripts/lib.sh && preflight'], { FF_ENV_FILE: env });
  };
  // 백엔드는 정확히 'oidc'가 아니면 데모 인증이다(auth-config.ts authModeOf) — compose는 따옴표를 벗긴다
  const open = [['"demo"', 'dq'], ["'demo'", 'sq'], ['Demo', 'case'], [' demo', 'space'], ['demo\r', 'cr'], ['OIDC', 'oidc-upper'], ['"OIDC"', 'oidc-upper-q'], ['', 'empty']];
  for (const [auth, name] of open) {
    const r = pre({ FF_AUTH: auth, FF_DEMO_GATE: 'off' }, name);
    assert.notEqual(r.status, 0, `FF_AUTH=${JSON.stringify(auth)} + 게이트 off가 통과했다`);
    assert.match(r.stderr, /FF_DEMO_GATE/);
  }
  assert.equal(pre({ FF_AUTH: '"oidc"', FF_DEMO_GATE: 'off' }, 'oidc-q').status, 0, '따옴표 친 oidc는 compose가 oidc로 넘긴다');
  // 게이트 켬 표기도 백엔드와 같게(on·1·true, 대소문자·따옴표 무관)
  for (const [gate, name] of [['"on"', 'g-dq'], ['ON', 'g-up'], ['true', 'g-true'], ['1', 'g-1']]) {
    const r = pre({ FF_AUTH: 'demo', FF_DEMO_GATE: gate }, name);
    assert.equal(r.status, 0, `FF_DEMO_GATE=${gate}: ${r.stderr}`);
  }
});

test('비밀 생성 — 도메인은 소문자로(공개 출처 비교가 소문자), 메일·포트·IP에 줄바꿈·이상한 값을 받지 않는다', { skip: !hasBash }, () => {
  const gen = (args, name) => run('bash', ['scripts/gen-secrets.sh', ...args], { FF_ENV_FILE: join(tmp, `.env.gen-${name}`) });
  const r = gen(['--domain', 'FF.Example.COM', '--email', 'ops@example.com'], 'upper');
  assert.equal(r.status, 0, r.stderr);
  const env = parseEnv(readFileSync(join(tmp, '.env.gen-upper'), 'utf8'));
  assert.equal(env.FF_DOMAIN, 'ff.example.com');
  assert.equal(env.FF_PUBLIC_URL, 'https://ff.example.com');
  assert.notEqual(gen(['--domain', 'ff.example.com', '--email', 'a@b.example\nFF_DEMO_GATE=off'], 'nl').status, 0, '메일에 줄바꿈(설정 끼워 넣기)');
  assert.notEqual(gen(['--domain', 'ff.example.com', '--email', 'not-an-email'], 'mail').status, 0);
  assert.notEqual(gen(['--domain', 'ff.example.com', '--email', 'ops@example.com', '--https-port', '44a3'], 'port').status, 0);
  assert.notEqual(gen(['--ip', '203.0.113.300', '--email', 'ops@example.com'], 'ip').status, 0, 'IPv4 형식이 아닌 --ip');
});

/** 가짜 명령(rclone·docker·cosign)을 PATH 앞에 둔 셸에서 lib.sh 함수를 부른다 */
const withFakes = (fakes, script) => {
  const bin = mkdtempSync(join(tmp, 'bin-'));
  for (const [name, body] of Object.entries(fakes)) writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  const posix = bin.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
  return run('bash', ['-c', `export PATH="${posix}:$PATH"; . scripts/lib.sh; ${script}`], { FF_ENV_FILE: ENV });
};

test('백업 바깥 저장소 — rclone 원격이 암호화(crypt)가 아니면 올리지 않는다(BACKUP_RCLONE_PLAINTEXT=1로만 허용)', { skip: !hasBash }, () => {
  const rclone = `[ "$1" = listremotes ] && printf 's3remote:  s3\\nvault:     crypt\\n'`;
  assert.equal(withFakes({ rclone }, 'rclone_remote_encrypted vault:ff-backups').status, 0);
  assert.notEqual(withFakes({ rclone }, 'rclone_remote_encrypted s3remote:ff-backups').status, 0);
  assert.notEqual(withFakes({ rclone }, 'rclone_remote_encrypted nothere:x').status, 0);
  const backup = readFileSync(join(KIT, 'scripts', 'backup.sh'), 'utf8');
  assert.match(backup, /rclone_remote_encrypted "\$remote"/);
  assert.match(backup, /BACKUP_RCLONE_PLAINTEXT/);
  assert.match(backup, /chmod 700 "\$root"/);
});

test('이미지 고정 — 받은 태그를 레지스트리 다이제스트로 묶고(같은 태그를 다시 올려도 같은 내용), 서명 신원을 주면 cosign으로 확인한다', { skip: !hasBash }, () => {
  const digest = `sha256:${'b'.repeat(64)}`;
  const docker = `[ "$1 $2" = "image inspect" ] && printf '["ghcr.io/other/x@sha256:${'c'.repeat(64)}","ghcr.io/mutuuslab/feature-platform@${digest}"]\\n'`;
  const r = withFakes({ docker }, 'pinned_ref ghcr.io/mutuuslab/feature-platform:v0.1.0-demo');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), `ghcr.io/mutuuslab/feature-platform:v0.1.0-demo@${digest}`);
  // 이미 다이제스트면 그대로, 레지스트리 기록이 없으면(로컬 빌드·docker load) 그대로
  assert.equal(withFakes({ docker }, `pinned_ref ghcr.io/mutuuslab/feature-platform@${digest}`).stdout.trim(), `ghcr.io/mutuuslab/feature-platform@${digest}`);
  assert.equal(withFakes({ docker: `printf '[]\\n'` }, 'pinned_ref ff-platform:ci-demo').stdout.trim(), 'ff-platform:ci-demo');
  // 서명 — FF_IMAGE_SIGNER가 비면 건너뛰고, 있으면 cosign verify가 통과해야 한다
  const log = join(tmp, 'cosign.log').replace(/\\/g, '/');
  const cosignOk = `echo "$@" >> '${log}'; exit 0`;
  const cosignBad = 'exit 1';
  assert.equal(withFakes({ cosign: cosignBad }, 'verify_image_signature ghcr.io/x@sha256:1').status, 0, '서명 신원이 없으면 확인하지 않는다');
  const signer = 'https://github.com/mutuuslab/.+/.github/workflows/app-image.yml@.*';
  const signed = withFakes({ cosign: cosignOk }, `FF_IMAGE_SIGNER='${signer}' verify_image_signature ghcr.io/x@sha256:1`);
  assert.equal(signed.status, 0, signed.stderr);
  const args = readFileSync(join(tmp, 'cosign.log'), 'utf8');
  assert.match(args, /verify .*--certificate-identity-regexp/);
  assert.match(args, /--certificate-oidc-issuer https:\/\/token\.actions\.githubusercontent\.com/);
  assert.notEqual(withFakes({ cosign: cosignBad }, `FF_IMAGE_SIGNER='${signer}' verify_image_signature ghcr.io/x@sha256:1`).status, 0, '서명 확인 실패면 멈춘다');
  for (const f of ['install.sh', 'update.sh']) {
    const sh = readFileSync(join(KIT, 'scripts', f), 'utf8');
    assert.match(sh, /pinned_ref/, `${f}가 다이제스트로 묶지 않는다`);
    assert.match(sh, /verify_image_signature/, `${f}가 서명을 확인하지 않는다`);
  }
  const wf = readFileSync(join(KIT, '..', '..', '..', '.github', 'workflows', 'app-image.yml'), 'utf8');
  assert.match(wf, /cosign sign --yes/);
  assert.match(wf, /id-token: write/);
});

test('cloud-init — SSH 강화가 cloud-init 기본 설정(50-cloud-init.conf)보다 먼저 읽히고, 비밀번호 로그인을 끈다', () => {
  const ci = readFileSync(join(KIT, 'cloud-init.yaml'), 'utf8');
  // sshd는 같은 키의 첫 값을 쓴다 — sshd_config.d는 이름 순이라 50-cloud-init.conf(PasswordAuthentication yes일 수 있다)보다 앞이어야 한다
  const conf = /path: \/etc\/ssh\/sshd_config\.d\/(\S+\.conf)/.exec(ci)?.[1];
  assert.ok(conf, 'sshd 강화 파일이 없다');
  assert.ok(conf < '50-cloud-init.conf', `${conf}는 50-cloud-init.conf 뒤에 읽혀 무시될 수 있다`);
  assert.match(ci, /^ssh_pwauth: false$/m);
  assert.match(ci, /PasswordAuthentication no/);
  // root는 키로만(Hetzner·DigitalOcean 기본 사용자가 root — 아예 막으면 잠긴다)
  assert.match(ci, /PermitRootLogin (no|prohibit-password)/);
  assert.match(ci, /\[ufw, limit, OpenSSH\]/, 'SSH는 ufw limit(연결 속도 제한)');
  assert.match(ci, /backend = systemd/, 'fail2ban은 저널을 읽는다(Ubuntu 24.04 최소 이미지에는 auth.log가 없을 수 있다)');
  assert.doesNotMatch(ci, /usermod -aG docker/, 'docker 그룹은 root와 같다 — sudo로만 쓴다');
});

test('상태 점검 — 게이트 확인은 설정 값을 믿지 않고 늘 본다(세션 없이 401, OIDC도 마찬가지)', () => {
  const health = readFileSync(join(KIT, 'scripts', 'health.sh'), 'utf8');
  assert.doesNotMatch(health, /FF_AUTH\)" = oidc \] && return 0/);
});

test('Caddy — 닫는 경로는 끝 빗금·하위 경로까지(path는 정확 일치), OTA 서버 webhook도 닫는다', () => {
  const caddy = readFileSync(join(KIT, 'caddy', 'Caddyfile'), 'utf8');
  const closed = /@closed path ([^\n]+)/.exec(caddy)?.[1].split(/\s+/) ?? [];
  for (const p of ['/api/webhooks', '/api/webhooks/*', '/api/ota/v1/events', '/api/ota/v1/events/*', '/api/health/metrics', '/api/health/metrics/*']) assert.ok(closed.includes(p), `${p}가 닫혀 있지 않다`);
});

test('시험 도구 — 호스트 포트 확인은 HTTP가 아닌 창구(PostgreSQL)도 잡는 TCP 연결로 본다', () => {
  const smoke = readFileSync(join(KIT, 'test', 'gate-smoke.sh'), 'utf8');
  assert.match(smoke, /\/dev\/tcp\/127\.0\.0\.1/);
  assert.doesNotMatch(smoke, /curl -s -o \/dev\/null --max-time 3 "http:\/\/127\.0\.0\.1:\$p\/"/);
});
