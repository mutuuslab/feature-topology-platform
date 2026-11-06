// 정적 데모 빈 화면 하네스의 문구 집합 — 화면 문구(frontend/src/copy)의 빈 상태·정적 안내 문구를 그대로 모은다.
// 화면에 이 문구가 보이면 '데이터로 채우지 않고 문구로 때운 곳'이다(2026-11-05 사용자 규칙 — 공개 데모 어디에도 빈 상태 금지).
//   · 키 끝 이름에 empty가 들어간 문구(빈 목록 안내) — '표시할 항목이 없습니다' 같은 공통 빈 상자 문구 포함
//   · 키 끝 이름에 static이 들어가거나 '데모에서는·백엔드·정적 시연·연결하면·수집하지 않'이 든 문구(정적이라 비었다는 안내)
//   · 키 끝 이름이 none·noXxx이고 '…없습니다'로 말하는 문장(빈 목록·회신 없음 안내)
//   · 단, 검색 방식·조회 범위 안내처럼 빈 상태가 아닌 문장은 NOT_EMPTY에 이유와 함께 뺀다
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const COPY = join(__dirname, '..', '..', 'frontend', 'src', 'copy');
const STATIC_WORDS = /표시할 항목이 없습니다|데모에서는|백엔드|정적 시연|연결하면|수집하지 않/;
const NONE_KEY = /^(none|no[A-Z0-9]\w*)$/;

/** 빈 상태가 아닌 정적 안내 — [모듈:키 경로, 이유] */
const NOT_EMPTY: [string, string][] = [
  ['ko:ko.events.sse.static', '실시간 패널이 빌 때만 쓰는 안내 — 정적 공개본은 받아 둔 이벤트 흐름을 보인다'],
  ['ko:ko.events.status.static', "흐름 표식 '저장된 흐름'"],
  ['refdb:featureDb.staticSearch', '검색 방식 안내 — 받아 둔 목록에서 찾는다'],
  ['propose:propose.searchHintStatic', '검색 입력 칸 도움말'],
  ['workbench:workbench.staticPartial', '조회 범위 안내 — 저장된 범위는 채워져 있다'],
  ['analysis:analysis.deviation.none', '판정 결과 문장(대표 ASIL과 같아 따로 볼 사유 없음) — 빈 목록이 아니다'],
  ['catalog-experience:catalogExperience.noEntitlement', '정책 조건 사실(사용 권한 조건 없음) — 빈 목록이 아니다'],
  ['ko:ko.fleetMap.noRuntime', '합성 모집단 차량의 성격 설명 — 빈 목록이 아니다'],
  ['ko:ko.fleetMap.noWebgl', '브라우저 환경 안내(표로 대신 보인다)'],
  ['ko:ko.shell.noItems', '메뉴 거르기 결과 안내(사람이 고른 조건)'],
];
const SKIP = new Set(NOT_EMPTY.map(([k]) => k));

function collect(): string[] {
  const out = new Set<string>();
  for (const file of readdirSync(COPY).filter((f) => f.endsWith('.ts'))) {
    const mod = file.replace(/\.ts$/, '');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require(join(COPY, file)) as Record<string, unknown>;
    const walk = (x: unknown, path: string) => {
      if (typeof x === 'string') {
        const last = path.split('.').pop() ?? '';
        const hit = /empty/i.test(last) || /static/i.test(last) || STATIC_WORDS.test(x) || (NONE_KEY.test(last) && /(없|않)습니다/.test(x));
        // '—'·'비어 있음' 같은 짧은 칸 표식은 본문 다른 곳과 겹친다 — 문장만 대조한다
        if (hit && !SKIP.has(`${mod}:${path}`) && x.trim().length >= 6) out.add(x.trim());
      } else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) walk(v, path ? `${path}.${k}` : k);
    };
    for (const [k, v] of Object.entries(m)) walk(v, k);
  }
  return [...out];
}

/** 화면에 보이면 안 되는 빈 상태 문구 — 정확한 문장 */
export const EMPTY_PHRASES = collect();

/**
 * 문구 집합 밖(서버 응답·조립 문장)의 같은 뜻 — 정적이라 비었다는 안내, 모의 연계 표시(D-ALM-17), 준비 안 된 껍데기.
 * 쓰기 차단 표시는 '공개 시연본 · 보기 전용'처럼 짧게 — '데모·백엔드·연결·없습니다'로 말하면 여기에 걸린다(2026-11-05 코디네이터)
 */
export const EMPTY_PATTERN = new RegExp(
  [
    '표시할 항목이 없습니다',
    '아직 [^.。]*없습니다',
    '(읽기 전용|정적|공개) 데모(에서는|라 |입니다)',
    '정적 데모',
    '이 데모에서는',
    '백엔드에 연결',
    '정적 시연에서는[^.]*(없|않)',
    '수집하지 않습니다',
    '아직 실제 시스템에 연결되지 않은',
    '아직 연결되지 않았습니다',
    '모의 응답',
    '모의\\(연결 전\\)',
    '첫 페이지만 볼 수 있습니다',
    '준비 중 \\d+',
    '단계 준비 중',
    '아직 연결 전',
    '이 플랫폼에는 없습니다',
  ].join('|'),
);

// 문구 파일 형식이 바뀌어 집합이 비면 하네스가 조용히 통과한다 — 대표 문구로 확인한다
for (const must of ['표시할 항목이 없습니다', '아직 기록이 없습니다. 항목이 생기면 여기에 표시됩니다.']) if (!EMPTY_PHRASES.includes(must)) throw new Error(`빈 상태 문구 집합에 '${must}'가 없습니다 — empty-copy.ts를 고치세요`);
