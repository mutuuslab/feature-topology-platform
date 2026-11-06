// 가상검증 응답에 로컬 절대 경로가 실리지 않는다 — 공개 데모(정적 스냅샷)·서버 모드 공통(2026-11-06 로컬 의존 점검).
// 실행기·Python 경로는 저장소 기준 상대 경로나 파일 이름만, Evidence 폴더·재생 명령은 Evidence 저장 폴더 기준(evidence/...)으로 낸다.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publicEvidencePath } from '../../src/adapters/sim/carla.adapter';
import { VirtualRunRepo } from '../../src/domains/d06-qsec/scenario-validation/virtual-run.repo';
import { actor, bootApp } from '../helpers';

const FAKE = resolve(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs');
const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const JUDGE = actor('lee.judge', 'GATE_JUDGE');
/** 절대 경로(Windows 드라이브·UNC·POSIX 루트)와 임시 폴더 흔적 */
const ABS = /[A-Za-z]:[\\/]|\\\\|(^|[\s"'])\/(tmp|home|Users|var|mnt)\/|AppData|ff-vv-/;

describe('가상검증 응답의 경로 — 로컬 절대 경로 없음', () => {
  let app: INestApplication;
  let http: () => any;
  let evidence = '';
  beforeAll(async () => {
    evidence = mkdtempSync(join(tmpdir(), 'ff-vv-'));
    process.env.FF_EVIDENCE_DIR = evidence;
    process.env.CARLA_RUNNER = FAKE;
    process.env.FAKE_SIM_PROBE_FAIL = '1';
    delete process.env.SIM_MODE;
    delete process.env.CARLA_PYTHON;
    ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' }));
  });
  afterAll(async () => {
    await app.close();
    ['CARLA_RUNNER', 'FF_EVIDENCE_DIR', 'FAKE_SIM_PROBE_FAIL'].forEach((k) => delete process.env[k]);
  });

  it('상태: 실행기는 저장소 기준 상대 경로, Python은 절대 경로가 아니다(서버 모드에 필요한 호스트·포트는 유지)', async () => {
    const st = (await http().get('/api/sim/status').expect(200)).body;
    expect(st.runner).toBe('backend/test/fixtures/fake-carla/ffcarla_cli.mjs');
    expect(st.python).not.toMatch(ABS);
    expect(st).toMatchObject({ host: '127.0.0.1', port: 2100 });
    expect(JSON.stringify(st)).not.toMatch(ABS);
  });

  it('실행: evidence.dir·재생 명령은 evidence/<시험 ID> 상대 경로, Evidence 파일은 그대로 내려받는다', async () => {
    const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: 'care_00022_param', description: '감속 요청 파라미터 r2', safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
    const runs = (await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: c.body.policyId, scenarioIds: ['SCN-FEAT00022-NOMINAL'] }).expect(201)).body.items;
    const r = runs[0];
    expect(r.evidence.dir).toBe(`evidence/${r.testId}`);
    expect(r.repro.replay).toBe(`python sim/carla/ffcarla_cli.py --replay "evidence/${r.testId}/carla_recording.log"`);
    const d = (await http().get(`/api/virtual-validations/${r.runId}`).expect(200)).body;
    expect(JSON.stringify(d)).not.toMatch(ABS);
    expect(JSON.stringify((await http().get('/api/virtual-validations').expect(200)).body)).not.toMatch(ABS);
    // Evidence 파일(실행기가 쓴 판정·기록)에도 빌드 PC 경로가 남지 않는다 — 정적 데모가 그대로 복사한다
    const v = await http().get(`/api/virtual-validations/${r.runId}/files/verdict.json`).expect(200);
    expect(v.text ?? JSON.stringify(v.body)).not.toMatch(ABS);
    await http().get(`/api/virtual-validations/${r.runId}/files/carla_recording.log`).expect(200);
  });

  // 회귀(2026-11-06 하네스 점검 — 공개 스냅샷 virtual-validations_policyId_POL-00001.json에 C:\Users\…\ff-snapshot-evidence-…가 남았다):
  // 절대 경로로 저장된 이전 기록 — 지금 저장 폴더 안의 것과, 저장 폴더 밖(다른 실행의 임시 폴더)의 것 모두 모든 응답 경로에서 evidence/…로 보인다
  it('이전 기록(절대 경로 저장) — 정책별·Feature별·전체 목록·상세·TMS 제출·Evidence 판정/보고서 어디에도 절대 경로 없음', async () => {
    const repo = app.get(VirtualRunRepo);
    const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: 'care_00022_param', description: '감속 요청 파라미터 r3', safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
    const pid = c.body.policyId;
    const runs = (await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: pid }).expect(201)).body.items.filter((r: any) => r.source === 'carla' && r.role !== 'BASELINE_REMOTE');
    expect(runs.length).toBeGreaterThanOrEqual(2);
    const other = mkdtempSync(join(tmpdir(), 'ff-snapshot-evidence-'));
    try {
      // 예전 실행기가 쓴 모양 그대로 — 기록의 evidence.dir·repro.replay와 판정·보고서 파일 안에 절대 경로
      const old = (r: any, dir: string) => {
        const rec = join(dir, 'carla_recording.log');
        const replay = `python sim/carla/ffcarla_cli.py --replay "${rec}"`;
        repo.update({ ...repo.get(r.runId)!, evidence: { ...r.evidence, dir }, repro: { ...r.repro, replay } });
        const v = JSON.parse(readFileSync(join(dir, 'verdict.json'), 'utf8'));
        writeFileSync(join(dir, 'verdict.json'), JSON.stringify({ ...v, repro: { ...v.repro, replay } }));
        writeFileSync(join(dir, 'report.html'), `<html><body><code>${replay.replace(/"/g, '&quot;')}</code><p>${dir}</p></body></html>`);
      };
      old(runs[0], join(evidence, runs[0].testId)); // 저장 폴더 안
      const moved = join(other, runs[1].testId); // 저장 폴더 밖(다른 스냅샷의 임시 폴더)
      cpSync(join(evidence, runs[1].testId), moved, { recursive: true });
      old(runs[1], moved);
      expect(JSON.stringify(repo.get(runs[1].runId))).toMatch(ABS); // 저장된 기록은 그대로(파일을 되찾는 데 쓴다)

      const bodies = [
        (await http().get('/api/virtual-validations').query({ policyId: pid }).expect(200)).body,
        (await http().get('/api/virtual-validations').query({ featureId: 'FEAT-00022', featureVersion: '1.0.0' }).expect(200)).body,
        (await http().get('/api/virtual-validations').expect(200)).body,
      ];
      for (const r of runs) bodies.push((await http().get(`/api/virtual-validations/${r.runId}`).expect(200)).body);
      for (const b of bodies) expect(JSON.stringify(b)).not.toMatch(ABS);
      const listed = bodies[0].items.find((x: any) => x.runId === runs[1].runId);
      expect(listed.evidence.dir).toBe(`evidence/${runs[1].testId}`);
      expect(listed.repro.replay).toBe(`python sim/carla/ffcarla_cli.py --replay "evidence/${runs[1].testId}/carla_recording.log"`);

      const tms = (await http().post(`/api/virtual-validations/${runs[1].runId}/tms`).set(JUDGE).send({}).expect(201)).body;
      expect(tms.tms).toBeTruthy();
      expect(JSON.stringify(tms)).not.toMatch(ABS);

      for (const r of runs) {
        const v = await http().get(`/api/virtual-validations/${r.runId}/files/verdict.json`).expect(200);
        const text = v.text || JSON.stringify(v.body);
        expect(text).not.toMatch(ABS);
        expect(text).toContain(`evidence/${r.testId}/carla_recording.log`);
        expect(v.headers['x-evidence-rewritten']).toBe('local-paths');
        const h = await http().get(`/api/virtual-validations/${r.runId}/files/report.html`).expect(200);
        expect(h.text).not.toMatch(ABS);
        expect(h.headers['content-type']).toMatch(/text\/html/);
        // 기록(바이너리)은 그대로 내려받는다
        await http().get(`/api/virtual-validations/${r.runId}/files/carla_recording.log`).expect(200);
      }
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe('publicEvidencePath — 저장 폴더 안·밖의 Evidence 절대 경로', () => {
  const root = process.platform === 'win32' ? 'C:\\ev\\root' : '/ev/root';
  it.each([
    ['저장 폴더 밖(Windows, 공백 폴더)', 'python sim/carla/ffcarla_cli.py --replay "C:\\Users\\John Doe\\AppData\\Local\\Temp\\ff-x\\TEST-a-1\\carla_recording.log"', 'python sim/carla/ffcarla_cli.py --replay "evidence/TEST-a-1/carla_recording.log"'],
    ['UNC', '\\\\srv\\share\\ev\\TEST-e\\report.html', 'evidence/TEST-e/report.html'],
    ['POSIX 임시 폴더', '/tmp/ff-snapshot-evidence-x/TEST-c/carla_recording.log', 'evidence/TEST-c/carla_recording.log'],
    ['따옴표 안 POSIX', 'see "/home/runner/w/TEST-d"', 'see "evidence/TEST-d"'],
    ['두 경로 중 시험 폴더만', 'C:\\a\\b and C:\\c\\TEST-h', 'C:\\a\\b and evidence/TEST-h'],
  ])('%s', (_k, input, out) => expect(publicEvidencePath(input, root)).toBe(out));
  it('저장 폴더 안은 폴더 기준으로', () => expect(publicEvidencePath(`${root}${process.platform === 'win32' ? '\\' : '/'}TEST-b`, root)).toBe('evidence/TEST-b'));
  it.each([['URL', 'https://host/a/TEST-f/x'], ['이미 상대 경로', 'evidence/TEST-g/carla_recording.log'], ['시험 ID만', 'TEST-i only']])('바꾸지 않는다 — %s', (_k, input) => expect(publicEvidencePath(input, root)).toBe(input));
});
