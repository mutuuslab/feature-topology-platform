// GLEO 교차 언어 계약 — FF_IMP gleo/messages.py validate()와 같은 판정(policy_push 고유 형식, kill_command·status_report는 v2).
import { describe, expect, it } from 'vitest';
import fixtures from './gleo.fixtures.json';
import { gleoMessageErrors } from './gleo';
import { loadGuide } from './testing/fixtures';

describe('GLEO 메시지 계약', () => {
  it.each(fixtures.valid.map((m) => [m.type, m]))('유효: %s', (_t, m) => {
    expect(gleoMessageErrors(m)).toEqual([]);
  });
  it('유효: kill_command·status_report v2 (보고서 패키지 예제)', () => {
    expect(gleoMessageErrors(loadGuide('schema/examples/kill_safety_dc2_eu.ok.json'))).toEqual([]);
    expect(gleoMessageErrors(loadGuide('schema/examples/status_disabled.ok.json'))).toEqual([]);
  });
  it.each(fixtures.invalid.map((m) => [m._why, m]))('거부: %s', (_w, m) => {
    expect(gleoMessageErrors(m).length).toBeGreaterThan(0);
  });
});
