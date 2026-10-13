// 보고서 v1.1 코드 패키지 동기화 — 스키마·예제·용어 규칙만 복사, 원고에서 규칙·시험 카탈로그를 뽑는다(차량 C/C++ 코드·문서·zip은 빠진다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalog, catalogProblems, selectFiles, sha } from './guide-sync.ts';

test('스키마 v2·예제·용어 규칙만 고른다', () => {
  const all = [
    'schema/kill_command.v2.schema.json', 'schema/status_report.v2.schema.json', 'schema/examples/registry.json',
    'schema/examples/kill_dc4_aeb.gate_fail.json', 'harness/terms.json', 'harness/sources.json', 'harness/platform_model.json',
    'c/src/ff_guard.c', 'cpp/src/lpc.cpp', 'docs/ch07_verification_matrix.md', 'tools/platform_policy_gate.py',
    'FF_Safety_Guide_v2_code_examples.zip', 'sbom/ff_examples.cdx.json', 'README.md',
  ];
  assert.deepEqual(selectFiles(all), [
    'harness/terms.json', 'schema/examples/kill_dc4_aeb.gate_fail.json', 'schema/examples/registry.json',
    'schema/kill_command.v2.schema.json', 'schema/status_report.v2.schema.json',
  ]);
});

test('해시는 줄끝과 무관 — Windows 체크아웃(CRLF)과 CI 체크아웃(LF)이 같은 매니페스트를 통과한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guide-eol-'));
  writeFileSync(join(dir, 'a.json'), '{\r\n  "a": 1\r\n}\r\n');
  writeFileSync(join(dir, 'b.json'), '{\n  "a": 1\n}\n');
  assert.equal(sha(join(dir, 'a.json')), sha(join(dir, 'b.json')));
});

test('원고에서 규칙 블록과 시험 표를 뽑는다 — 절 제목·적용 목록 포함, 규칙 밖 목록은 무시', () => {
  const text = [
    '# 3. UN ADS', '## 3.11 규칙', '',
    '### FFG-ADS-002 ADS Feature는 원격 종료가 가능해야 한다',
    '- 수준: 필수', '- 적용: Registry, Safety Manager', '- 규칙: DC4로 분류하지 않는다.', '- 근거: UN ADS §4.1.4.4', '- 검증: Registry 검사',
    '- 예제: tools/gate.py', '  - 하위 항목은 앞 항목에 이어진다', '', '일반 문단은 블록을 끝낸다', '- 수준: 이건 규칙 밖', '## 12.2 시험 카탈로그', '| ID | 시험 | 기대 결과 | 구현 |', '|---|---|---|---|',
    '| TC-FF-02 | 재전송 | 거부 | t02 |', '| TC-FF-01 | 변조 | E2E 거부 | t01 |',
  ].join('\r\n');
  const c = buildCatalog([{ file: '03_ads.md', text }]);
  assert.equal(c.rules.length, 1);
  assert.deepEqual(c.rules[0], {
    id: 'FFG-ADS-002', title: 'ADS Feature는 원격 종료가 가능해야 한다', level: '필수', scope: ['Registry', 'Safety Manager'],
    rule: 'DC4로 분류하지 않는다.', basis: 'UN ADS §4.1.4.4', verify: 'Registry 검사', example: 'tools/gate.py\n- 하위 항목은 앞 항목에 이어진다',
    file: '03_ads.md', section: '3.11 규칙',
  });
  assert.deepEqual(c.tests.map((t) => t.id), ['TC-FF-01', 'TC-FF-02']);
  assert.deepEqual(catalogProblems(c), []);
});

test('ID 중복·필수 항목 누락은 동기화를 막는다', () => {
  const block = (id: string, extra = '') => [`### ${id} 제목`, '- 수준: 필수', extra, '- 근거: x', '- 검증: y'].join('\n');
  const c = buildCatalog([{ file: 'a.md', text: [block('FFG-PLT-001', '- 적용: 플랫폼\n- 규칙: r'), block('FFG-PLT-001')].join('\n') }]);
  assert.deepEqual(catalogProblems(c), ['규칙 ID 중복: FFG-PLT-001', 'FFG-PLT-001: rule 없음', 'FFG-PLT-001: 적용 없음']);
});
