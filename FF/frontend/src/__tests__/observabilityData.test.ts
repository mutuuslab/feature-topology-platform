import { describe, expect, it } from 'vitest';
import { measuredMetrics, recordedTimeBins } from '../screens/ops/observability-data';

describe('관측된 지표·시간 분포', () => {
  it('실제 합계와 계수로만 평균을 구하고 누락된 지연은 미확인으로 남긴다', () => {
    const rows = measuredMetrics('ff_http_requests_total{method="POST",route="/api/flags",status="200"} 2\nff_http_requests_total{method="POST",route="/api/flags",status="503"} 1\nff_http_request_duration_seconds_sum{method="POST",route="/api/flags"} 0.3\nff_http_request_duration_seconds_count{method="POST",route="/api/flags"} 3\nff_http_requests_total{method="GET",route="/api/events",status="200"} 1');
    expect(rows[0]).toMatchObject({ method: 'POST', route: '/api/flags', requests: 3, errors: 1 });
    expect(rows[0].meanMs).toBeCloseTo(100, 6);
    expect(rows[1].meanMs).toBeNull();
  });
  it('유효한 실제 시각만 같은 시간축으로 집계하고 기록 없는 기간을 만들지 않는다', () => {
    const bins = recordedTimeBins(['2026-11-05T00:00:00Z', '2026-11-05T00:01:00Z', 'bad', '2026-11-05T00:02:00Z'], 2);
    expect(bins.counts).toEqual([1, 2]); expect(bins.from).toBe(Date.parse('2026-11-05T00:00:00Z'));
    expect(recordedTimeBins(['bad'])).toEqual({ from: null, to: null, counts: [] });
  });
});
