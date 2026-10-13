// 테스트 전용: 커밋된 v0.81 픽스처를 읽는다 (런타임 코드에서 import 금지 — Node fs 사용).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATASET_FILES, type Dataset } from '../schemas/dataset';

export const FIXTURES_DIR = join(__dirname, '..', '..', '..', 'data', 'fixtures', 'v0.81');

export function loadDataset(): Dataset {
  const ds = {} as Record<string, unknown>;
  for (const k of Object.keys(DATASET_FILES)) ds[k] = JSON.parse(readFileSync(join(FIXTURES_DIR, `${k}.json`), 'utf8'));
  return ds as unknown as Dataset;
}

/** 보고서 v1.1 코드 패키지 복사본(tools/guide-sync.ts) — 스키마·예제·규칙 카탈로그 */
export const GUIDE_DIR = join(__dirname, '..', '..', '..', 'harness', 'guide');
export function loadGuide<T = any>(rel: string): T {
  return JSON.parse(readFileSync(join(GUIDE_DIR, rel), 'utf8'));
}
