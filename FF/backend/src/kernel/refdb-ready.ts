// 준비 점검의 Feature DB 항목(health/ready checks.refdb, 30-95 §9) — 패키지에 가져오기 자료(data/reference/feature-db)가 빠져 빈 Feature DB로 뜨면
// Feature를 등록할 수 없다(기준 행 연결 필수). 커널은 도메인 모듈을 가져오지 않으므로 표를 직접 센다(마이그레이션 080·081).
//  · 기대 행 수 = 첫 기동 가져오기 기록(meta seed-refdb)의 행 수(가져오기 manifest의 refs 행 수) + 발행된 추가 요청 수
//    (승인 발행은 새 행, 반려 발행은 요청 중 행을 폐기로 — 둘 다 행이 남는다). 실제 = 요청 중(PENDING, 아직 발행 전) 행을 뺀 기준 행 수.
//  · FF_REFDB_SEED=off면 빈 Feature DB가 의도이므로 행이 없어도 통과(고객이 기준 데이터를 따로 옮기는 설치).
import { compareRelease } from '@ff/contracts';
import type { Db } from './db';

/** refdb-seed.ts SEED_META_KEY와 같은 값 */
const SEED_META_KEY = 'seed-refdb';

export interface RefdbReadyCheck {
  ok: boolean;
  detail: string;
  /** 발행된 기준 행 수(요청 중 제외) */
  rows: number;
  /** 가져오기 기록 + 발행 이력으로 기대하는 행 수 — 가져오기 기록이 없으면 null */
  expected: number | null;
  /** 최신 발행 버전(v1.3 …) — 없으면 null */
  release: string | null;
  /** FF_REFDB_SEED=off — 빈 Feature DB 허용 */
  seedOff: boolean;
}

const seedOff = (env: Record<string, string | undefined>) => /^(off|0|false)$/i.test((env.FF_REFDB_SEED ?? '').trim());
const num = (v: unknown) => Number(v ?? 0);

export function refdbReadyCheck(db: Db, env: Record<string, string | undefined> = process.env): RefdbReadyCheck {
  const off = seedOff(env);
  const rows = num(db.get<{ n: number | string }>("SELECT count(*) AS n FROM feature_ref WHERE status != 'PENDING'")?.n);
  // 발행된 추가 요청 — 발행 버전은 doc에만 있다(변경 요청 수는 많지 않아 doc을 읽는다)
  const published = db.all<{ doc: string }>("SELECT doc FROM ref_change WHERE kind = 'ADD'").filter((c) => (JSON.parse(c.doc) as { release?: string | null }).release).length;
  const release = db.all<{ release_id: string }>('SELECT release_id FROM ref_release').map((r) => r.release_id).sort(compareRelease).at(-1) ?? null;
  const raw = db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', SEED_META_KEY)?.value;
  let seeded: number | null = null;
  try {
    const v = raw ? (JSON.parse(raw) as { refs?: unknown }).refs : undefined;
    seeded = typeof v === 'number' ? v : null;
  } catch {
    seeded = null;
  }
  const expected = seeded === null ? null : seeded + published;
  const base = { rows, expected, release, seedOff: off };
  if (off) return { ok: true, detail: `가져오기 꺼짐(FF_REFDB_SEED=off) — 기준 행 ${rows}개`, ...base };
  if (rows === 0) return { ok: false, detail: 'Feature DB가 비었습니다 — 가져오기 자료(data/reference/feature-db)가 패키지에 없는지 확인하세요', ...base };
  if (expected !== null && rows !== expected) return { ok: false, detail: `기준 행 ${rows}개 ≠ 가져오기·발행 이력 ${expected}개`, ...base };
  return { ok: true, detail: `기준 행 ${rows}개${release ? ` · ${release}` : ''}`, ...base };
}
