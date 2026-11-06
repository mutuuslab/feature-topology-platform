// 등록 변환 규칙 읽기(FR-LGCY-001-006) — 기본 규칙(모의 외부 시스템 표)에 담당자가 등록·수정한 규칙을 덮어 해석에 쓴다.
import { mergeLegacyRules, type LegacyMapping, type LegacyRule } from '@ff/contracts';
import type { Db } from '../../../kernel/db';

export const registeredLegacyRules = (db: Db): LegacyRule[] => db.all<{ doc: string }>('SELECT doc FROM legacy_transform_rule ORDER BY legacy_code').map((r) => JSON.parse(r.doc) as LegacyRule);

/** 해석에 쓰는 규칙 — 기본 + 등록(같은 코드면 등록) */
export const effectiveLegacyRules = (db: Db, base: LegacyMapping[]): LegacyRule[] => mergeLegacyRules(base, registeredLegacyRules(db));
