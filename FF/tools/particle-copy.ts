// 조사 규칙 — 부서·사람 이름처럼 한글이 들어갈 자리 뒤에 받침에 따라 바뀌는 조사를 고정으로 붙이지 않는다(P1-12 '팀로').
// 문구 카탈로그(frontend/src/copy/*.ts)에서 잡는다. 고칠 때는 copy/departments.ts의 roParticle처럼 받침을 보고 고른다.
// 번호·ID·영문 값(`${id}로`, `r${n}로`)은 읽는 방식이 정해지지 않아 보지 않는다 — 이름 자리 변수만 본다.

/** 이름 자리 변수(dept·team·name·org·owner·person·who) 바로 뒤의 고정 조사 */
const NAME_PARTICLE = /\$\{\s*(?:[a-zA-Z_.]*\.)?(?:dept|department|team|name|org|owner|person|who)\b[^}]*\}(으로|로|을|를|은|는|이|가|과|와)(?![가-힣])/;
/** 부서 이름 끝 '팀' 뒤의 틀린 조사 */
const TEAM_WRONG = /팀(로|를|가|는|와)(?![가-힣])/;

export interface ParticleHit {
  line: number;
  text: string;
}

export function particleHits(source: string): ParticleHit[] {
  const out: ParticleHit[] = [];
  source.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*')) return;
    if (NAME_PARTICLE.test(line) || TEAM_WRONG.test(line)) out.push({ line: i + 1, text: t.slice(0, 100) });
  });
  return out;
}
