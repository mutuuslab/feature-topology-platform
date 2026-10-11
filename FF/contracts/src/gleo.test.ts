// GLEO 교차 언어 계약 — 같은 픽스처를 FF_IMP(Python)도 검사한다(tests/test_messages.py).
import { describe, expect, it } from 'vitest';
import fixtures from './gleo.fixtures.json';
import { GleoMessage } from './gleo';

describe('GLEO 메시지 계약', () => {
  it.each(fixtures.valid.map((m) => [m.type, m]))('유효: %s', (_t, m) => {
    expect(GleoMessage.safeParse(m).success).toBe(true);
  });
  it.each(fixtures.invalid.map((m) => [m._why, m]))('거부: %s', (_w, m) => {
    expect(GleoMessage.safeParse(m).success).toBe(false);
  });
});
