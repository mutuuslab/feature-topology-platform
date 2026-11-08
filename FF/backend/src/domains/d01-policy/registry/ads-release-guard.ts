// ADS 분류 전이 거부(ADS-BE16·FFP-F001·F004) — Lifecycle 전이가 함께 본다. 상태 없는 DB 읽기(D01 모듈 순환 import 없이).
// 적용 범위: 모든 Version(2026-11-07 결정 — 미분류 Feature를 분류 시드로 채운 뒤 전체 적용으로 전환).
//  · RELEASED 전이: 분류 미등록(행 없음·확정 전·축 빈칸·상태별 책임자 미지정)이면 CLS_UNREGISTERED
//  · 그 밖 전이: 분류 행이 있는 Version에서 도착 상태의 책임자(생성·운영·중단·폐기)가 비어 있으면 LIFECYCLE_OWNER_MISSING
//    (행이 없는 출시·중단 Version의 중단·폐기 전이는 막지 않는다 — 이미 운영 중인 Version을 한꺼번에 묶지 않게)
import { classificationReleaseBlocker, LIFECYCLE_TO_OWNER_STATE, type AdsClassification, type Blocker } from '@ff/contracts';
import type { Db } from '../../../kernel/db';

const OWNER_STATE_LABEL: Record<string, string> = { CREATE: '생성', OPERATE: '운영', SUSPEND: '중단', DISPOSE: '폐기' };

export function adsClassificationOf(db: Db, featureId: string, version: string): AdsClassification | null {
  const r = db.get<{ doc: string }>('SELECT doc FROM ads_classification WHERE feature_id = ? AND version = ?', featureId, version);
  return r ? (JSON.parse(r.doc) as AdsClassification) : null;
}

/** 출시 전이 거부 규칙 적용 범위 — 모든 Version(행이 없어도 미분류로 거부) */
export const CLASSIFICATION_RULE_SCOPE = 'ALL' as const;

export function adsTransitionBlockers(db: Db, f: { featureId: string; version: string }, to: string): Blocker[] {
  const cls = adsClassificationOf(db, f.featureId, f.version);
  if (to === 'RELEASED') {
    const b = classificationReleaseBlocker({ adsScope: true, classification: cls });
    return b ? [{ code: b.code as Blocker['code'], message: b.message, ref: cls ? b.ref : `${f.featureId}@${f.version}` }] : [];
  }
  if (!cls) return [];
  const st = LIFECYCLE_TO_OWNER_STATE[to];
  if (st && !cls.lifecycleOwners?.[st]) return [{ code: 'LIFECYCLE_OWNER_MISSING' as Blocker['code'], message: `${OWNER_STATE_LABEL[st]} 상태 책임자가 지정되지 않아 ${to}로 전이할 수 없습니다 — 분류에서 상태별 책임자를 지정하세요.`, ref: `${f.featureId}@${f.version}` }];
  return [];
}
