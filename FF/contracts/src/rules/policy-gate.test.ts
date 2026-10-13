// 플랫폼 정책 게이트 — 보고서 부록 D.4 판정 예·코드 패키지 시험 변형(Golden)과 패키지 Python 게이트 대조.
// TC-FF-16 · TC-FF-45 · TC-FF-46 · TC-FF-47 · TC-FF-48 · TC-FF-49 · TC-FF-50 · TC-FF-53
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDE_DIR, loadGuide } from '../testing/fixtures';
import { GATE_NOW, gateCases } from '../testing/gate-cases';
import { evaluateGate, failedRules, gateVerdict } from './policy-gate';

describe('Golden — D.4 판정 예와 패키지 시험 변형', () => {
  for (const c of gateCases()) {
    it(`${c.tc} ${c.name} → ${c.pass ? 'PASS' : c.fail.join('·') || '해당 규칙 통과'}`, () => {
      const v = gateVerdict(c.cmd, c.registry, new Date(c.now));
      expect(v.errors).toEqual([]);
      const failed = failedRules(v.findings);
      for (const r of c.fail) expect(failed).toContain(r);
      for (const r of c.notFail ?? []) expect(failed).not.toContain(r);
      if (c.pass) expect(v.result).toBe('PASS');
    });
  }
});

describe('하네스 — 게이트 규칙마다 실패 사례', () => {
  // evaluateGate가 판정하는 규칙 전부 — 규칙을 더하면 여기와 사례를 함께 늘린다
  const GATE_RULES = [
    'FFG-PLT-002',
    'FFG-CLS-009',
    'FFG-ADS-002',
    'FFG-ADS-010',
    'FFG-PLT-003',
    'FFG-PLT-004',
    'FFG-PLT-005',
    'FFG-PLT-006',
    'FFG-PLT-007',
    'FFG-PLT-017',
    'FFG-PLT-008',
    'FFG-SEC-003',
    'FFG-PLT-009',
    'FFG-PLT-010',
  ];
  it('14개 규칙이 모두 한 번 이상 실패로 시험된다', () => {
    const covered = new Set(gateCases().flatMap((c) => c.fail));
    expect(GATE_RULES.filter((r) => !covered.has(r))).toEqual([]);
  });
  it('정상 명령은 위 규칙을 빠짐없이 판정한다(조건부 규칙 제외)', () => {
    const ok = gateCases()[0];
    const judged = evaluateGate(ok.cmd, ok.registry, new Date(ok.now)).map((f) => f.rule);
    expect(GATE_RULES.filter((r) => !judged.includes(r))).toEqual(['FFG-ADS-002', 'FFG-ADS-010', 'FFG-PLT-006', 'FFG-PLT-010']); // ADS·폐기·상업 사유·넓히는 조치일 때만
  });
});

describe('스키마 먼저 (FFG-PLT-001 · TC-FF-50)', () => {
  it('v1 safe_mode 명령은 규칙 판정 전에 SCHEMA_FAIL', () => {
    const v = gateVerdict(loadGuide('schema/examples/legacy_v1_kill_safe_stop.schema_fail.json'), loadGuide('schema/examples/registry.json'), new Date(GATE_NOW));
    expect(v.result).toBe('SCHEMA_FAIL');
    expect(v.findings).toEqual([expect.objectContaining({ rule: 'FFG-PLT-001', ok: false })]);
    expect(v.errors.join('\n')).toContain('safe_mode');
  });
  it('Registry에 없는 Feature는 FFG-PLT-002 하나로 끝난다', () => {
    const cmd = loadGuide('schema/examples/kill_safety_dc2_eu.ok.json');
    cmd.feature.id = 'FEAT-09999';
    expect(evaluateGate(cmd, loadGuide('schema/examples/registry.json'), new Date(GATE_NOW))).toEqual([expect.objectContaining({ rule: 'FFG-PLT-002', ok: false })]);
  });
});

/** Python + jsonschema가 있는 환경에서만 — 없으면 이유를 남기고 건너뛴다(CI 등). 그 밖의 실행 오류는 숨기지 않고 실패(broken)로 */
function runPython(input: string): { out?: { name: string; findings: { rule: string; ok: boolean }[] }[]; why?: string; broken?: string } {
  const runner = join(__dirname, '..', 'testing', 'gate_parity.py');
  const gate = join(GUIDE_DIR, 'tools', 'platform_policy_gate.py');
  const file = join(mkdtempSync(join(tmpdir(), 'gate-parity-')), 'cases.json');
  writeFileSync(file, input);
  const tried: string[] = [];
  for (const [cmd, pre] of [
    ['python', []],
    ['python3', []],
    ['py', ['-3']],
  ] as const) {
    const r = spawnSync(cmd, [...pre, runner, gate, file], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    if (r.error) {
      tried.push(`${cmd}: ${(r.error as NodeJS.ErrnoException).code ?? r.error.message}`);
      continue;
    }
    const last = r.stderr.split('\n').filter(Boolean).slice(-1)[0] ?? `exit ${r.status}`;
    if (r.status !== 0) return /No module named 'jsonschema'/.test(r.stderr) ? { why: `${cmd}: jsonschema 없음` } : { broken: `${cmd}: ${last}` };
    return { out: JSON.parse(r.stdout) };
  }
  return { why: `Python 실행 불가(${tried.join(', ')})` };
}

describe('패키지 Python 게이트와 규칙 단위 대조 (gate-parity)', () => {
  const cases = gateCases();
  const py = runPython(JSON.stringify(cases.map((c) => ({ name: c.name, cmd: c.cmd, registry: c.registry, now: c.now }))));
  if (py.why) console.warn(`gate-parity 건너뜀 — ${py.why}`);
  it('러너가 고장 나지 않는다(Python이 있을 때)', () => expect(py.broken).toBeUndefined());
  it('패키지 복사본에 Python 캐시를 남기지 않는다(guide:check 매니페스트)', () => expect(existsSync(join(GUIDE_DIR, 'tools', '__pycache__'))).toBe(false));
  it.skipIf(!py.out)('모든 사례에서 규칙 순서·통과 여부가 같다', () => {
    for (const c of cases) {
      const ts = evaluateGate(c.cmd, c.registry, new Date(c.now)).map((f) => ({ rule: f.rule, ok: f.ok }));
      expect(ts, c.name).toEqual(py.out!.find((p) => p.name === c.name)!.findings);
    }
  });
});
