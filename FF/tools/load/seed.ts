// 부하 시험 데이터 만들기(출시 준비 RD-P2-01) — 빌드된 백엔드를 파일 DB로 한 번 띄워 v0.81 시드와 실제 API 기록(Feature 등록·
// 긴급 차단 요청·발행·전달함)을 남긴 뒤, 그 행을 본으로 복제해 profile 크기까지 채운다(문서 형식은 실제 서비스가 쓴 그대로).
// 감사는 해시 체인을 이어서 만든다(체인 검증이 깨지지 않게). 결과 DB는 .sim/load/ 아래에 내용 해시로 캐시한다.
//   node tools/load/seed.ts --profile light|full [--force]
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { FF } from '../lib.ts';
import { PROFILES, type LoadProfile, type ProfileName } from './profiles.ts';

const require = createRequire(import.meta.url);
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

export const LOAD_DIR = join(FF, '.sim', 'load');

/** 캐시 키 — 스키마(마이그레이션)·시드 픽스처·이 스크립트·데이터 크기가 같으면 같은 DB */
function cacheKey(name: ProfileName): string {
  const h = createHash('sha256');
  for (const f of [join(FF, 'backend', 'src', 'kernel', 'migrations.ts'), join(FF, 'tools', 'load', 'seed.ts')]) h.update(readFileSync(f));
  for (const dir of [join(FF, 'data', 'fixtures', 'v0.81'), join(FF, 'data', 'fixtures', 'demo')]) for (const f of readdirSync(dir).sort()) h.update(f).update(readFileSync(join(dir, f)));
  // 데이터 크기만(요청 수·동시성·예산 배수는 DB와 무관)
  const { features, vehicles, audit, events, notifications, deliveries, statusReports } = PROFILES[name];
  h.update(JSON.stringify({ features, vehicles, audit, events, notifications, deliveries, statusReports }));
  return h.digest('hex').slice(0, 12);
}

export const SEED_ENV = {
  FF_SEED: 'v0.81',
  FF_SCHEDULER: 'manual',
  FF_BOOT_PUBLISH: '0',
  FF_VEHICLE_CHANNEL: 'pull',
  GLEO_MODE: 'internal',
  UNLEASH_MODE: 'mock',
  SIM_MODE: 'auto',
  FF_CLOCK_AT: '2026-10-12T01:00:00.000Z',
  CARLA_RUNNER: join(FF, 'backend', 'test', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'),
};

const H = (id: string, role: string) => ({ 'x-actor-id': id, 'x-actor-role': role, 'content-type': 'application/json' });

/** 1단계 — 실제 앱으로 시드와 본이 될 기록을 만든다 */
async function boot(dbFile: string) {
  for (const s of ['', '-wal', '-shm']) rmSync(dbFile + s, { force: true });
  Object.assign(process.env, SEED_ENV, { FF_DB: dbFile, FF_EVIDENCE_DIR: join(LOAD_DIR, 'evidence') });
  const { createApp } = require(join(FF, 'backend', 'dist', 'app.factory.js'));
  const app = await createApp({ logger: false });
  await app.listen(0, '127.0.0.1');
  const base: string = await app.getUrl();
  const call = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status >= 300) throw new Error(`시드 요청 실패 ${method} ${path} → ${r.status} ${(await r.text()).slice(0, 300)}`);
    return r.json() as Promise<any>;
  };
  const author = H('usr-author', 'FEATURE_AUTHOR');
  await call('POST', '/api/features', author, { name: '부하 시험 본 Feature', description: '복제 본', requirementIds: ['REQ-LOAD-1'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: ['Flag'] });
  // 긴급 차단 요청 → 2인 승인(발행) — 이벤트·알림·감사·게시본·전달함(당겨받기)의 본
  const k = await call('POST', '/api/kill-requests', H('usr-ops', 'OPERATOR'), { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01', 'lead-01'], reason: '부하 시험 본 차단', confirm: 'FEAT-00022', reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', containmentJustification: '원인 분석 전 봉쇄' });
  await call('POST', `/api/kill-requests/${k.killId}/approvals`, H('usr-safety', 'SAFETY_OFFICER'), {});
  await call('POST', `/api/kill-requests/${k.killId}/approvals`, H('usr-opslead', 'OPS_LEAD'), {});
  await app.close();
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');
/** 결정적 의사 난수(시험 데이터가 실행마다 같게) */
function rng(seed = 42) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** 3단계 — 채운 DB로 한 번 더 부팅해 부팅 때 하는 일(이관 Gate 기록 결정 서명·감사 체인 채우기)을 끝내 둔다.
 *  운영 중인 설치의 DB는 이미 이 상태다 — 측정 서버 부팅이 복제분을 매번 다시 서명하지 않게 */
async function settle(dbFile: string) {
  Object.assign(process.env, SEED_ENV, { FF_DB: dbFile, FF_EVIDENCE_DIR: join(LOAD_DIR, 'evidence') });
  const { createApp } = require(join(FF, 'backend', 'dist', 'app.factory.js'));
  const app = await createApp({ logger: false });
  await app.init();
  await app.close();
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
}

/** 2단계 — 본 행을 복제해 크기를 채운다 */
function fill(dbFile: string, p: LoadProfile) {
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF; PRAGMA foreign_keys = OFF;');
  const { chainHash, AUDIT_GENESIS } = require(join(FF, 'backend', 'dist', 'kernel', 'audit.service.js'));
  const rnd = rng();
  const all = (sql: string, ...a: any[]) => db.prepare(sql).all(...a) as any[];
  db.exec('BEGIN');

  // ── Feature: 시드 Feature ID마다 그 버전 묶음을 통째로 복제(문서 안의 Feature ID를 바꿔 쓴다)
  const fvs = all('SELECT * FROM feature_version ORDER BY feature_id, version');
  const byFeature = new Map<string, any[]>();
  for (const r of fvs) byFeature.set(r.feature_id, [...(byFeature.get(r.feature_id) ?? []), r]);
  const templates = [...byFeature.keys()];
  const gates = all('SELECT * FROM gate_record');
  const gatesBy = new Map<string, any[]>();
  for (const g of gates) gatesBy.set(`${g.feature_id}@${g.feature_version}`, [...(gatesBy.get(`${g.feature_id}@${g.feature_version}`) ?? []), g]);
  const safety = new Map(all('SELECT * FROM safety_profile').map((s) => [`${s.feature_id}@${s.version}`, s]));
  const insFv = db.prepare('INSERT INTO feature_version (feature_id, version, lifecycle, baseline_id, doc, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insGate = db.prepare('INSERT INTO gate_record (gate_record_id, feature_id, feature_version, gate, status, judged_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insSafety = db.prepare('INSERT INTO safety_profile (feature_id, version, status, doc) VALUES (?, ?, ?, ?)');
  const fvCols = new Set(all('PRAGMA table_info(feature_version)').map((c) => c.name));
  let gateSeq = 900_000;
  const featureIds: string[] = [...templates];
  for (let i = 0; featureIds.length < p.features; i++) {
    const t = templates[i % templates.length];
    const id = `FEAT-${pad(10_000 + i, 5)}`;
    featureIds.push(id);
    const swap = (s: string) => s.split(`"${t}"`).join(`"${id}"`);
    for (const r of byFeature.get(t)!) {
      insFv.run(id, r.version, r.lifecycle, r.baseline_id, swap(r.doc), fvCols.has('created_by') ? r.created_by : null, fvCols.has('created_at') ? r.created_at : null);
      for (const g of gatesBy.get(`${t}@${r.version}`) ?? []) {
        const gid = `SIM-${g.gate}-${pad(++gateSeq, 7)}`;
        insGate.run(gid, id, r.version, g.gate, g.status, g.judged_at, swap(g.doc).split(`"${g.gate_record_id}"`).join(`"${gid}"`));
      }
      const s = safety.get(`${t}@${r.version}`);
      if (s) insSafety.run(id, r.version, s.status, swap(s.doc));
    }
  }

  // ── 차량: 데모 Fleet 차량을 본으로 VIN만 바꿔 복제
  const fleet = all('SELECT * FROM vehicle ORDER BY vin');
  const insVehicle = db.prepare('INSERT INTO vehicle (vin, doc) VALUES (?, ?)');
  const vins: string[] = fleet.map((v) => v.vin);
  for (let i = 0; vins.length < p.vehicles; i++) {
    const t = fleet[i % fleet.length];
    const vin = `LOAD-${pad(i, 7)}`;
    vins.push(vin);
    insVehicle.run(vin, t.doc.split(`"${t.vin}"`).join(`"${vin}"`));
  }

  // ── 전달함(당겨받기): 발행된 게시본 하나를 여러 차량의 대기 전달로
  const delivery = all('SELECT * FROM vehicle_delivery LIMIT 1')[0];
  if (!delivery) throw new Error('본 전달함 행이 없습니다 — FF_VEHICLE_CHANNEL=pull 발행이 전달함을 만들지 않았습니다');
  const insDelivery = db.prepare('INSERT INTO vehicle_delivery (delivery_id, vin, publication_id, channel, queued_at, fetched_at, fetch_count, acked_at, ack_doc) VALUES (?, ?, ?, ?, ?, NULL, 0, NULL, NULL)');
  for (let i = 0; i < p.deliveries; i++) insDelivery.run(`DLV-LOAD-${pad(i, 7)}`, vins[fleet.length + i], delivery.publication_id, delivery.channel, delivery.queued_at);

  // ── 상태 보고 v2: 받은 보고 기록(추가만) — 차량마다 몇 건씩
  const insStatus = db.prepare('INSERT INTO status_report (vin, feature_id, report_seq, state, accepted, violation, via, doc, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < p.statusReports; i++) {
    const vin = vins[fleet.length + (i % Math.max(1, vins.length - fleet.length))];
    const seq = 65536 + i;
    const doc = JSON.stringify({ spec: 'status_report', version: 2, vehicle_id: vin, feature_id: 'FEAT-00022', report_seq: seq, state: 'ACTIVE', hmi: 'NONE', request_result: 'NONE' });
    insStatus.run(vin, 'FEAT-00022', seq, 'ACTIVE', 1, null, 'pull', doc, '2026-10-11T00:00:00.000Z');
  }

  // ── 이벤트: 실제 이벤트 형식을 본으로, 집계 대상은 Feature들에 고르게
  const evs = all('SELECT * FROM events ORDER BY seq');
  const insEvent = db.prepare('INSERT INTO events (id, type, at, aggregate, component_id, correlation_id, payload) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const t0 = Date.parse('2021-10-12T00:00:00.000Z');
  const span = Date.parse('2026-10-11T00:00:00.000Z') - t0;
  for (let i = 0; i < p.events; i++) {
    const e = evs[i % evs.length];
    insEvent.run(`ev-load-${pad(i, 8)}`, e.type, new Date(t0 + Math.floor((span * i) / p.events)).toISOString(), featureIds[i % featureIds.length], e.component_id, `corr-load-${i}`, e.payload);
  }
  // 기존 이벤트 뒤에 추가했으니 순번을 다시 읽는다 — 알림은 이벤트 순번에 묶인다(UNIQUE)
  const lastSeq = (db.prepare('SELECT max(seq) AS m FROM events').get() as any).m as number;

  // ── 알림: 실제 알림(차단 요청·발행)을 본으로, 새 이벤트 순번에 하나씩
  const ntfs = all('SELECT * FROM notification ORDER BY event_seq');
  if (!ntfs.length) throw new Error('본 알림이 없습니다 — 긴급 차단 요청이 알림을 만들지 않았습니다');
  const recips = all('SELECT * FROM notification_recipient');
  const insN = db.prepare('INSERT INTO notification (notification_id, event_seq, category, severity, created_at, doc) VALUES (?, ?, ?, ?, ?, ?)');
  const insR = db.prepare('INSERT INTO notification_recipient (notification_id, rkey) VALUES (?, ?)');
  const startN = ntfs.length;
  for (let i = 0; i < p.notifications; i++) {
    const n = ntfs[i % ntfs.length];
    const id = `NTF-${pad(startN + i + 1, 5)}`;
    const seq = lastSeq - p.notifications + i + 1;
    const doc = JSON.parse(n.doc);
    Object.assign(doc, { notificationId: id, eventSeq: seq });
    insN.run(id, seq, n.category, n.severity, n.created_at, JSON.stringify(doc));
    for (const r of recips) if (r.notification_id === n.notification_id) insR.run(id, r.rkey);
  }

  // ── 감사: 해시 체인을 이어 만든다(행위자·대상·결과를 섞어서)
  const tail = db.prepare('SELECT hash FROM audit ORDER BY id DESC LIMIT 1').get() as any;
  let prev: string = tail?.hash ?? AUDIT_GENESIS;
  const insAudit = db.prepare(
    'INSERT INTO audit (at, actor_id, actor_role, action, target, result, reason, before_doc, after_doc, correlation_id, component_id, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const actors = [
    ['usr-author', 'FEATURE_AUTHOR'],
    ['usr-approver', 'FEATURE_APPROVER'],
    ['usr-ops', 'OPERATOR'],
    ['usr-safety', 'SAFETY_OFFICER'],
    ['usr-judge', 'GATE_JUDGE'],
    ['usr-release', 'RELEASE_MANAGER'],
  ];
  const actions = ['feature.update', 'gate.judge', 'policy.validate', 'kill.request', 'feature.transition', 'fleet.map.view'];
  for (let i = 0; i < p.audit; i++) {
    const [aid, role] = actors[Math.floor(rnd() * actors.length)];
    const denied = rnd() < 0.03;
    const row = {
      at: new Date(t0 + Math.floor((span * i) / p.audit)).toISOString(),
      actor_id: aid,
      actor_role: role,
      action: actions[i % actions.length],
      target: i % 5 === 0 ? `/api/vehicles/${vins[i % vins.length]}` : `${featureIds[i % featureIds.length]}@1.0.0`,
      result: denied ? 'DENIED' : 'ALLOWED',
      reason: denied ? '역할이 허용되지 않음' : null,
      before_doc: null,
      after_doc: denied ? null : JSON.stringify({ seq: i }),
      correlation_id: `corr-audit-${i}`,
      component_id: 'D01-01',
    };
    const hash = chainHash(prev, row);
    insAudit.run(row.at, row.actor_id, row.actor_role, row.action, row.target, row.result, row.reason, row.before_doc, row.after_doc, row.correlation_id, row.component_id, prev, hash);
    prev = hash;
  }
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('load-seed', ?)").run(JSON.stringify(p));
  db.exec('COMMIT');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
  return { features: featureIds.length, vehicles: vins.length };
}

/** 캐시된 부하 DB 경로 — 없거나 force면 새로 만든다 */
export async function seedFor(name: ProfileName, opts: { force?: boolean; log?: (s: string) => void } = {}): Promise<string> {
  const log = opts.log ?? ((s: string) => console.log(s));
  mkdirSync(LOAD_DIR, { recursive: true });
  const out = join(LOAD_DIR, `${name}-${cacheKey(name)}.db`);
  if (existsSync(out) && !opts.force) {
    log(`부하 DB 재사용: ${out}`);
    return out;
  }
  // 이전 키의 DB는 지운다(크기가 크다)
  for (const f of readdirSync(LOAD_DIR)) if (f.startsWith(`${name}-`) && f.endsWith('.db')) rmSync(join(LOAD_DIR, f), { force: true });
  const building = `${out}.building`;
  const t = Date.now();
  await boot(building);
  const r = fill(building, PROFILES[name]);
  await settle(building);
  for (const s of ['-wal', '-shm']) rmSync(building + s, { force: true });
  copyFileSync(building, out);
  rmSync(building, { force: true });
  log(`부하 DB 생성(${name}): Feature ${r.features} · 차량 ${r.vehicles} · 감사 ${PROFILES[name].audit} · 이벤트 ${PROFILES[name].events} — ${((Date.now() - t) / 1000).toFixed(1)} s`);
  return out;
}

if (import.meta.main) {
  const i = process.argv.indexOf('--profile');
  const name = (i > 0 ? process.argv[i + 1] : 'light') as ProfileName;
  if (!PROFILES[name]) throw new Error(`알 수 없는 profile: ${name}`);
  await seedFor(name, { force: process.argv.includes('--force') });
}
