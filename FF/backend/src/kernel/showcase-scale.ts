import { isProduction, seedOf } from './runtime-config';

/** Only synthetic public-showcase cohorts grow. Customer/production data never does. */
export function showcaseScale(env: Record<string, string | undefined> = process.env): 1 | 2 {
  if (env.FF_SHOWCASE !== '1' || isProduction(env) || seedOf(env) === 'none' || env.FF_DATASET === 'ops5y') return 1;
  const scale = Number(env.FF_SHOWCASE_SCALE ?? '1');
  if (scale !== 1 && scale !== 2) throw new Error('FF_SHOWCASE_SCALE은 1 또는 2여야 합니다.');
  return scale;
}
