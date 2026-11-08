import { describe, expect, it } from 'vitest';
import { SubmitSupplierArtifactBody } from '@ff/contracts';
import { artifactChecksum, publicArtifactUri, verifyArtifact } from '../../src/domains/d05-ext/supplier/supplier-proof';

const pkg = { featureId: 'FEAT-00010', featureVersion: '2.0.0', version: '2.0.0' };
const binding = { featureId: pkg.featureId, featureVersion: pkg.featureVersion, packageVersion: pkg.version };
const content = (extra: object = {}) => JSON.stringify({ title: '협력사 개발 문서', package: binding, ...extra });
const artifact = (text: string | null = content()) => SubmitSupplierArtifactBody.parse({ type: 'HUMAN_DOC', version: pkg.version, title: '개발 문서', uri: 'https://supplier.example/releases/2.0.0/guide', text, checksum: artifactChecksum(text ?? content()) });

describe('서버의 산출물 본문 검증', () => {
  it('신고만 한 기록에 VERIFIED가 저장돼 있어도 본문 없이는 검증 완료가 아니다', () => {
    expect(verifyArtifact(pkg, { ...artifact(null), integrity: 'VERIFIED' } as ReturnType<typeof artifact>).integrity).toBe('DECLARED');
  });
  it('실제 UTF-8 바이트·대상 manifest·산출물 버전이 일치해야 한다', () => {
    expect(verifyArtifact(pkg, artifact()).integrity).toBe('VERIFIED');
    expect(verifyArtifact(pkg, { ...artifact(), checksum: 'sha256:' + '0'.repeat(64) }).integrity).toBe('MISMATCH');
    expect(verifyArtifact(pkg, artifact(content({ package: { ...binding, featureVersion: '1.0.0' } }))).integrity).toBe('MISMATCH');
    expect(verifyArtifact(pkg, { ...artifact(), version: '1.0.0' }).integrity).toBe('MISMATCH');
  });
  it('본문을 따로 확인하지 않은 메타데이터를 검수 값으로 쓰지 않는다', () => {
    const metadata = { mappingIds: ['SFM-00001'] };
    const text = JSON.stringify({ package: binding, ...metadata });
    const a = SubmitSupplierArtifactBody.parse({ ...artifact(text), type: 'FEATURE_MAPPING', mappingIds: ['SFM-00002'] });
    expect(verifyArtifact(pkg, a)).toMatchObject({ integrity: 'MISMATCH', reason: expect.stringContaining('메타데이터') });
  });
  it('개발 PC·사설망·파일 주소를 외부 출처로 받지 않는다', () => {
    for (const uri of ['C:/developer/guide.json', 'file:///C:/guide.json', 'http://supplier.example/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://10.1.2.3/a', 'https://portal.internal/a', 'https://user:password@supplier.example/a']) expect(publicArtifactUri(uri), uri).toBe(false);
    expect(publicArtifactUri('https://supplier.example/releases/guide.json')).toBe(true);
  });
});
