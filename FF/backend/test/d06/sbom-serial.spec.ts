// SBOM 일련번호(serialNumber)는 게시본·Feature Version으로 정해진다 — 패키지 해시(서명 시각이 든 payloadHash)에 따라 바뀌지 않는다.
// 회귀(2026-11-06 하네스 리뷰 시드 결정성): 일련번호가 payloadHash를 섞어 만들어져, 정적 공개본 스냅샷 파일 이름(sbom/<urn>)이 배포마다 바뀌었다.
// 패키지와의 결합은 일련번호가 아니라 metadata.component.hashes(= payloadHash, FFG-SBOM-003)가 맡는다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SbomService } from '../../src/domains/d06-qsec/vuln-monitor/sbom.service';
import { bootApp } from '../helpers';

describe('SBOM 일련번호 결정성', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => {
    b = await bootApp({ at: '2026-10-12T01:00:00.000Z' });
  });
  afterAll(async () => {
    await b.app.close();
  });

  it('같은 게시본은 패키지 해시가 달라도 같은 일련번호, 다른 게시본은 다른 일련번호 — 해시 결합은 metadata.component', () => {
    const sbom = b.get(SbomService);
    const h1 = 'sha256:' + 'a'.repeat(64);
    const h2 = 'sha256:' + 'b'.repeat(64);
    const one = sbom.build('PUB-00001', 'FEAT-00022', '1.0.0', h1);
    const again = sbom.build('PUB-00001', 'FEAT-00022', '1.0.0', h2);
    expect(again.serialNumber).toBe(one.serialNumber);
    expect(one.serialNumber).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(sbom.build('PUB-00002', 'FEAT-00022', '1.0.0', h1).serialNumber).not.toBe(one.serialNumber);
    expect(one.metadata.component.hashes[0].content).toBe('a'.repeat(64));
    expect(again.metadata.component.hashes[0].content).toBe('b'.repeat(64));
  });
});
