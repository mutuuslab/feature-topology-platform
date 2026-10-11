// 하네스 공용 유틸 — Node 24 타입 스트리핑으로 직접 실행 (node tools/x.ts). 외부 의존성 없음.
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FF = fileURLToPath(new URL('..', import.meta.url));
export const BASELINES = join(FF, 'harness', 'baselines.json');

export function walk(dir: string, exts: string[], skip: string[] = ['node_modules', 'dist', '__tests__', 'test']): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!skip.includes(name)) out.push(...walk(p, exts, skip));
    } else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

/** BOM 섞인 JSON도 읽는다 (Windows 편집기 대비). */
export function readJson<T = any>(p: string): T {
  return JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));
}

export function rel(p: string): string {
  return relative(FF, p).split(sep).join('/');
}

type Direction = 'max' | 'min';
export interface Metric {
  value: number;
  /** max: 값이 기준보다 커지면 실패(줄여 나가는 지표) · min: 작아지면 실패(늘려 나가는 지표) */
  direction: Direction;
  note: string;
}

export function loadBaselines(): Record<string, Metric> {
  return existsSync(BASELINES) ? readJson(BASELINES) : {};
}

/**
 * 래칫 비교. 악화되면 false. 개선되면 기준을 잠그라는 안내를 낸다.
 * --update 플래그가 있으면 개선된 값으로 기준을 갱신한다(악화 방향으로는 절대 갱신하지 않는다).
 */
export function ratchet(key: string, value: number, direction: Direction, note: string): boolean {
  const all = loadBaselines();
  const base = all[key];
  const update = process.argv.includes('--update');
  if (!base) {
    all[key] = { value, direction, note };
    writeFileSync(BASELINES, JSON.stringify(all, null, 2) + '\n');
    console.log(`  · ${key}: 기준 신규 등록 = ${value}`);
    return true;
  }
  const worse = direction === 'max' ? value > base.value : value < base.value;
  const better = direction === 'max' ? value < base.value : value > base.value;
  if (worse) {
    console.error(`  ✕ ${key}: ${value} (기준 ${base.value}, ${direction === 'max' ? '이하' : '이상'}이어야 함) — ${note}`);
    return false;
  }
  if (better) {
    if (update) {
      all[key] = { ...base, value };
      writeFileSync(BASELINES, JSON.stringify(all, null, 2) + '\n');
      console.log(`  ✓ ${key}: ${base.value} → ${value} 기준 잠금`);
    } else {
      console.log(`  ✓ ${key}: ${value} (기준 ${base.value}보다 개선 — npm run ratchet -- --update 로 잠그세요)`);
    }
  } else console.log(`  ✓ ${key}: ${value} (기준 유지)`);
  return true;
}
