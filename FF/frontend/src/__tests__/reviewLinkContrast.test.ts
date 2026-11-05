// 심사 결재함 링크 색 대비(담당자 웨이브 P3-11) — 링크 색(=강조색)이 본문 글자와 3:1 이상(WCAG 1.4.1 링크 구분), 바탕·머리 띠·옅은 강조 면과 4.5:1 이상.
// 예전: 강조색 #334155가 본문 글자(#15171b)와 1.72:1 — 밑줄 말고는 링크를 구분할 수 없었다. 토큰(tokens.css)만 본다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'design', 'tokens.css'), 'utf8').replace(/\r\n/g, '\n');

/** 선택자(머리 글자 그대로)로 시작하는 첫 블록의 색 토큰 */
function block(selector: string): Record<string, string> {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`없는 블록: ${selector}`);
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2].toLowerCase()]));
}

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const light = { ...block(':root {'), ...block(":root[data-workspace='review'] {") };
const dark = { ...light, ...block("[data-theme='dark'],\n[data-zone='ops'] {"), ...block(":root[data-theme='dark'][data-workspace='review'] {") };

describe('심사 결재함 링크 대비(P3-11)', () => {
  for (const [name, t] of [
    ['밝은 테마', light],
    ['어두운 테마', dark],
  ] as const)
    it(`${name} — 링크(강조색)가 본문 글자와 3:1 이상, 바탕·머리 띠·옅은 강조 면·강조 버튼 글자와 4.5:1 이상`, () => {
      expect(contrast(t['--accent'], t['--ink'])).toBeGreaterThanOrEqual(3);
      for (const bg of ['--surface', '--paper', '--ws-band', '--accent-soft', '--accent-ink']) expect(contrast(t['--accent'], t[bg]), bg).toBeGreaterThanOrEqual(4.5);
    });
});
