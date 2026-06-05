import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { severityMeta, SeverityBadge } from '../components/ui';
import { Steps } from '../components/charts';

describe('회귀 — Consistency severity 정규화', () => {
  it('코드 B/W/I → 풀네임 라벨', () => {
    expect(severityMeta('B').label).toBe('Blocking');
    expect(severityMeta('W').label).toBe('Warning');
    expect(severityMeta('I').label).toBe('Info');
  });
  it('풀네임 입력도 동일 메타로 정규화', () => {
    expect(severityMeta('blocking').color).toBe(severityMeta('B').color);
  });
});

describe('컴포넌트 스모크', () => {
  it('SeverityBadge가 라벨을 렌더', () => {
    render(<SeverityBadge code="B" />);
    expect(screen.getByText(/Blocking/)).toBeInTheDocument();
  });
  it('Steps가 모든 단계를 렌더', () => {
    render(<Steps steps={['A', 'B', 'C']} current={1} />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });
});
