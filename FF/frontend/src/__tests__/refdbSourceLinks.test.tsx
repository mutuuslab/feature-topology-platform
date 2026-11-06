// Feature DB 출처 주소 — 원천(xlsx)이 한 칸에 ' ; '로 이은 여러 주소가 하나의 깨진 링크가 되던 결함, 'doi:' 주소가 열리지 않던 결함.
// 데이터는 그대로 두고 화면에서 주소별 링크로 나눈다(원천 재적재 검사 data:check를 바꾸지 않는다).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SourceTitleLinks, splitSourceUrls } from '../screens/refdb/sourceLinks';

afterEach(cleanup);

describe('Feature DB 출처 주소 나누기', () => {
  it("' ; '로 이은 주소를 각각 나누고 doi:는 doi.org 링크로, 뒤의 설명은 따로 둔다", () => {
    expect(splitSourceUrls('https://universal-variability-language.github.io/ ; https://www.flamapy.org').map((l) => l.href)).toEqual(['https://universal-variability-language.github.io/', 'https://www.flamapy.org/']);
    expect(splitSourceUrls('doi:10.1016/j.ijpe.2011.05.018 (첨부 번들)')).toEqual([{ href: 'https://doi.org/10.1016/j.ijpe.2011.05.018', label: 'doi:10.1016/j.ijpe.2011.05.018', note: '(첨부 번들)' }]);
    expect(splitSourceUrls('https://a.example/x;https://b.example').map((l) => l.href)).toEqual(['https://a.example/x', 'https://b.example/']);
    expect(splitSourceUrls('사내 자료')).toEqual([{ href: null, label: '사내 자료', note: null }]);
    expect(splitSourceUrls(null)).toEqual([]);
  });

  it('제목은 첫 주소로, 나머지 주소는 주소별 링크로 보인다 — 이어 붙인 문자열이 href가 되지 않는다', () => {
    const { container } = render(<SourceTitleLinks title="ISO·ASAM 진단 표준" url="https://www.iso.org/standard/86587.html ; https://www.iso.org/standard/85133.html ; https://www.asam.net/standards/detail/sovd/" />);
    expect(screen.getByRole('link', { name: 'ISO·ASAM 진단 표준' }).getAttribute('href')).toBe('https://www.iso.org/standard/86587.html');
    expect(screen.getByRole('link', { name: 'iso.org/standard/85133.html' }).getAttribute('href')).toBe('https://www.iso.org/standard/85133.html');
    expect(screen.getByRole('link', { name: 'asam.net/standards/detail/sovd/' })).toBeTruthy();
    for (const a of container.querySelectorAll('a')) expect(a.getAttribute('href')).not.toMatch(/;|\s/);
  });

  it('doi: 주소는 https://doi.org/로 연다', () => {
    render(<SourceTitleLinks title="Product platform cost" url="doi:10.1016/j.ijpe.2011.05.018 (첨부 번들)" />);
    expect(screen.getByRole('link', { name: 'Product platform cost' }).getAttribute('href')).toBe('https://doi.org/10.1016/j.ijpe.2011.05.018');
    expect(screen.getByText('(첨부 번들)', { exact: false })).toBeTruthy();
  });
});
