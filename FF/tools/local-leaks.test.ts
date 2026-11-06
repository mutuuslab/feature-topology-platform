// 공개 정적 데모의 로컬 PC 흔적 검사(tools/local-leaks.ts) — 2026-11-06 점검에서 나온 실제 누출 모양을 잡고, 라이브러리 기본 문자열·화면 경로는 넘긴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanDirs, scanText } from './local-leaks.ts';
import { assertSnapshotClean } from './snapshot-api.ts';

const kinds = (text: string, file = 'a.json', users = ['TaehoKim']) => scanText(text, file, users).map((l) => l.kind);

test('점검에서 나온 누출 — 검증 서버 상태·Evidence 경로·재생 명령·사설 IP·CI 경로', () => {
  assert.deepEqual(kinds('{"host":"127.0.0.1","port":2100}'), ['loopback']);
  assert.ok(kinds(JSON.stringify({ runner: 'C:\\project\\2026-06-04_Feature_Platform-static\\FF\\backend\\x.mjs' })).includes('windows-path'));
  assert.ok(kinds(JSON.stringify({ python: 'C:/project/2026-10-17_Carlra/.venv/Scripts/python.exe' })).includes('windows-path'));
  const dir = kinds(JSON.stringify({ dir: 'C:\\Users\\TaehoKim\\AppData\\Local\\Temp\\ff-snapshot-evidence-z5XtwE\\TEST-1' }));
  for (const k of ['windows-path', 'appdata', 'user-name']) assert.ok(dir.includes(k), k);
  assert.deepEqual(kinds('{"url":"http://192.168.0.12:8765"}'), ['private-ip']);
  assert.deepEqual(kinds('{"url":"ws://10.20.3.4/x"}'), ['private-ip']);
  assert.deepEqual(kinds('{"url":"http://172.20.1.1/"}'), ['private-ip']);
  assert.deepEqual(kinds('{"p":"/home/runner/work/ff/ff/x"}'), ['posix-path']);
  assert.deepEqual(kinds('{"p":"/tmp/ff-vv-abc/TEST"}'), ['posix-path']);
  assert.deepEqual(kinds('<p>localhost로 접속했다면</p>', 'recovery.html'), ['localhost']);
});

test('넘기는 것 — 라이브러리 자리표시 원점(js만)·화면 경로·버전·공개 주소·축약 코드', () => {
  assert.deepEqual(kinds('var yc=new URL("http://localhost");', 'main.js'), []);
  assert.deepEqual(kinds('var yc=new URL("http://localhost");', 'a.json'), ['localhost']); // 스냅샷에서는 허용하지 않는다
  assert.deepEqual(kinds('{path:"/home/customize",routes:["/","/home/customize"]}', 'main.js'), []);
  assert.deepEqual(kinds('{"v":"CARLA 0.9.16","sw":"10.2.3","ip":"172.32.0.1","doi":"https://doi.org/10.1016/j.x"}'), []);
  assert.deepEqual(kinds('e?{a:1}:{b:2};x=c?a:/re/.test(s);y=d?A:/re/.test(s)', 'main.js'), []);
  assert.deepEqual(kinds('{"replay":"python sim/carla/ffcarla_cli.py --replay \\"evidence/TEST-1/carla_recording.log\\""}'), []);
  assert.deepEqual(kinds('"by":"TaehoKimchi"', 'a.json'), []); // 이름이 더 긴 단어의 일부면 아니다
});

test('폴더 검사 — 글자 파일만, 파일 경로를 알린다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-leaks-'));
  try {
    mkdirSync(join(dir, 'api-snapshot'));
    writeFileSync(join(dir, 'api-snapshot', 'ok.json'), '{"a":"evidence/TEST-1"}');
    writeFileSync(join(dir, 'api-snapshot', 'sim_status.json'), '{"host":"127.0.0.1"}');
    writeFileSync(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0x31, 0x32, 0x37, 0x2e, 0x30, 0x2e, 0x30, 0x2e, 0x31]));
    const leaks = scanDirs([dir], []);
    assert.equal(leaks.length, 1);
    assert.match(leaks[0].file, /api-snapshot\/sim_status\.json$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 회귀(2026-11-06 하네스 점검): 정책별 가상검증 목록 스냅샷에 다른 실행의 Evidence 임시 폴더 경로가 남아 public에 있었다 —
// static-build만 흔적을 검사해 단독 실행(npm run snapshot:api·배포 CI)이 만든 스냅샷은 걸리지 않았다
test('스냅샷 흔적 게이트 — 단독 실행도 실패하고 흔적 있는 스냅샷을 지운다', () => {
  const base = mkdtempSync(join(tmpdir(), 'ff-snapgate-'));
  try {
    const snap = join(base, 'api-snapshot');
    mkdirSync(snap);
    writeFileSync(join(snap, 'virtual-validations_policyId_POL-00001.json'), '{"items":[{"evidence":{"dir":"evidence/TEST-1"}}]}');
    assertSnapshotClean(snap, (dirs) => scanDirs(dirs, ['TaehoKim'])); // 깨끗하면 그대로 둔다
    assert.ok(existsSync(snap));
    const leak = JSON.stringify({ items: [{ repro: { replay: 'python sim/carla/ffcarla_cli.py --replay "C:\\Users\\TaehoKim\\AppData\\Local\\Temp\\ff-snapshot-evidence-dbaDCZ\\TEST-1\\carla_recording.log"' }, evidence: { dir: 'C:\\Users\\TaehoKim\\AppData\\Local\\Temp\\ff-snapshot-evidence-dbaDCZ\\TEST-1' } }] });
    writeFileSync(join(snap, 'virtual-validations_policyId_POL-00001.json'), leak);
    assert.throws(() => assertSnapshotClean(snap, (dirs) => scanDirs(dirs, ['TaehoKim'])), /빌드 PC 흔적[\s\S]*windows-path\s+\S*virtual-validations_policyId_POL-00001\.json/);
    assert.ok(!existsSync(snap), '흔적 있는 스냅샷은 공개 폴더에 남기지 않는다');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
