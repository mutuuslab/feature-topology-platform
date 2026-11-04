import { describe, expect, it } from 'vitest';
import { FeatureFlagRow, FlagSourceManifest, flagSourceUrl } from './flag-source';

const manifest = () => ({ format: 'ff-flag-source/v1', provider: 'GITHUB', repository: 'https://github.com/acme/vehicle', commit: 'a'.repeat(40), scannedAt: '2026-11-05T00:00:00.000Z', filesScanned: 1, unresolvedCalls: 0, usages: [{ flagKey: 'ivi_00024_guide', path: 'src/guide.ts', line: 7, symbol: 'client.getBooleanValue', method: 'getBooleanValue', safeDefault: 'EXPLICIT_FALSE', contentHash: `sha256:${'b'.repeat(64)}` }] });

describe('Git Flag 소스 스냅샷 계약', () => {
  it('원문 scanner 형식, URL·커밋·시각을 정규화한다', () => {
    const value = FlagSourceManifest.parse({ ...manifest(), repository: 'https://github.com/acme/vehicle.git/', commit: 'A'.repeat(64), scannedAt: '2026-11-05T09:00:00+09:00' });
    expect(value.repository).toBe('https://github.com/acme/vehicle');
    expect(value.commit).toBe('a'.repeat(64));
    expect(value.scannedAt).toBe('2026-11-05T00:00:00.000Z');
  });

  it.each(['http://github.com/acme/vehicle', 'https://token@github.com/acme/vehicle', 'https://u:p@github.com/acme/vehicle', 'https://github.com/acme/vehicle?token=x', 'https://github.com/acme/vehicle#x', 'https://github.com/acme/vehicle?', 'https://github.com/'])('저장소 주소 거부: %s', (repository) => {
    expect(FlagSourceManifest.safeParse({ ...manifest(), repository }).success).toBe(false);
  });

  it.each(['../a.ts', 'src/../a.ts', '/src/a.ts', 'C:/src/a.ts', 'src\\a.ts', 'src//a.ts', './a.ts'])('상대 POSIX 경로만: %s', (path) => {
    const value = manifest(); value.usages[0].path = path;
    expect(FlagSourceManifest.safeParse(value).success).toBe(false);
  });

  it('추가 필드·축약 커밋·해시·시각·음수 집계·0행을 거부한다', () => {
    for (const patch of [{ extra: true }, { format: 'v1' }, { commit: 'abc1234' }, { scannedAt: '어제' }, { filesScanned: -1 }, { filesScanned: 0 }, { unresolvedCalls: 0.5 }]) expect(FlagSourceManifest.safeParse({ ...manifest(), ...patch }).success).toBe(false);
    for (const patch of [{ line: 0 }, { method: 'eval' }, { safeDefault: 'SDK_DEFAULT' }, { contentHash: 'sha256:wrong' }, { column: 4 }]) expect(FlagSourceManifest.safeParse({ ...manifest(), usages: [{ ...manifest().usages[0], ...patch }] }).success).toBe(false);
  });

  it('같은 파일의 해시가 다른 사용처와 스캔 파일 수보다 많은 파일을 거부한다', () => {
    const first = manifest().usages[0];
    expect(FlagSourceManifest.safeParse({ ...manifest(), usages: [first, { ...first, line: 8, contentHash: `sha256:${'c'.repeat(64)}` }] }).success).toBe(false);
    expect(FlagSourceManifest.safeParse({ ...manifest(), usages: [first, { ...first, path: 'src/other.ts' }] }).success).toBe(false);
  });

  it('Unleash 기본값 분류와 안전한 소스 URL, 명시적인 null을 유지한다', () => {
    const value = FlagSourceManifest.parse({ ...manifest(), provider: 'GITLAB', usages: [{ ...manifest().usages[0], path: 'src/한 글#?.ts', method: 'isEnabled', safeDefault: 'SDK_DEFAULT' }] });
    expect(flagSourceUrl({ ...value, ...value.usages[0] })).toBe(`https://github.com/acme/vehicle/-/blob/${value.commit}/src/%ED%95%9C%20%EA%B8%80%23%3F.ts#L7`);
    const row = { flagKey: 'unbound', featureId: null, version: null, featureName: null, policy: null, sources: [], publication: null };
    expect(FeatureFlagRow.parse(row)).toEqual(row);
    const { publication, ...missing } = row;
    expect(FeatureFlagRow.safeParse(missing).success).toBe(false);
  });
});
