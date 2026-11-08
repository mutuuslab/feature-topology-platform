// SVG 글자 폭 어림 — 브라우저 측정 없이(시험·서버 렌더에서도 같은 결과) 줄바꿈·말줄임을 정한다.
// 한글·한자는 글자 크기의 0.95배, 영문 대문자·숫자 0.62배, 소문자 0.54배, 공백 0.3배로 넉넉히 잡는다.
export function textWidth(s: string, fontSize: number): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x1100 && (c <= 0x11ff || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef))) w += 0.95;
    else if (ch === ' ') w += 0.3;
    else if (/[A-Z0-9]/.test(ch)) w += 0.62;
    else if (/[a-z]/.test(ch)) w += 0.54;
    else w += 0.42;
  }
  return w * fontSize;
}

/** 폭에 맞게 끝을 줄인다(…) */
export function ellipsize(s: string, maxW: number, fontSize: number): string {
  if (textWidth(s, fontSize) <= maxW) return s;
  const chars = [...s];
  while (chars.length && textWidth(chars.join('') + '…', fontSize) > maxW) chars.pop();
  return chars.length ? chars.join('').trimEnd() + '…' : '';
}

/** 공백에서 우선 줄을 바꾸고, 한 단어가 넘치면 글자 단위로 자른다. 줄 수를 넘으면 마지막 줄을 줄인다 */
export function wrapText(s: string, maxW: number, fontSize: number, maxLines: number): string[] {
  const words = s.split(/(\s+)/).filter((x) => x.length);
  const lines: string[] = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) lines.push(cur.trim());
    cur = '';
  };
  for (const w of words) {
    if (textWidth(cur + w, fontSize) <= maxW) {
      cur += w;
      continue;
    }
    if (/^\s+$/.test(w)) {
      push();
      continue;
    }
    if (cur.trim()) push();
    if (textWidth(w, fontSize) <= maxW) cur = w;
    else
      for (const ch of w) {
        if (textWidth(cur + ch, fontSize) > maxW) push();
        cur += ch;
      }
  }
  push();
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = ellipsize(lines.slice(maxLines - 1).join(' '), maxW, fontSize);
  return kept;
}

/** 간선 이름표 두 줄 — 첫 줄을 최대한 채우되, 끝이 공백·'·'·괄호 앞이면 그곳에서 자른다(첫 줄 폭의 절반 이상일 때). 둘째 줄은 넘치면 줄인다 */
export function wrapLabel(s: string, maxW: number, fontSize: number): string[] {
  if (textWidth(s, fontSize) <= maxW) return [s];
  const chars = [...s];
  let n = 0;
  while (n < chars.length && textWidth(chars.slice(0, n + 1).join(''), fontSize) <= maxW) n++;
  let cut = n;
  for (let i = n; i > 0; i--) {
    const prev = chars[i - 1];
    const next = chars[i];
    if (prev === ' ' || prev === '·' || next === '(' || next === ' ') {
      if (textWidth(chars.slice(0, i).join(''), fontSize) >= maxW * 0.5) cut = i;
      break;
    }
  }
  const first = chars.slice(0, cut).join('').trimEnd();
  const rest = chars.slice(cut).join('').trimStart();
  return rest ? [first, ellipsize(rest, maxW, fontSize)] : [first];
}
