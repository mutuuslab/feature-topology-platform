export interface MetricRow { method: string; route: string; requests: number; errors: number; meanMs: number | null }

/** Only measured counters/histogram sums are shown; absent latency remains unknown. */
export function measuredMetrics(text: string): MetricRow[] {
  const rows = new Map<string, MetricRow & { sum: number | null; count: number | null }>();
  for (const line of text.split(/\r?\n/)) {
    const hit = /^(ff_http_requests_total|ff_http_request_duration_seconds_sum|ff_http_request_duration_seconds_count)\{([^}]+)\}\s+([\d.eE+-]+)(?:\s|$)/.exec(line);
    if (!hit || !Number.isFinite(Number(hit[3])) || Number(hit[3]) < 0) continue;
    const labels: Record<string, string> = {};
    try { for (const m of hit[2].matchAll(/(\w+)="((?:\\.|[^"\\])*)"/g)) labels[m[1]] = JSON.parse(`"${m[2]}"`); } catch { continue; }
    if (!labels.method || !labels.route) continue;
    const key = `${labels.method} ${labels.route}`;
    const row = rows.get(key) ?? { method: labels.method, route: labels.route, requests: 0, errors: 0, meanMs: null, sum: null, count: null };
    const value = Number(hit[3]);
    if (hit[1] === 'ff_http_requests_total') { row.requests += value; if (/^[45]\d\d$/.test(labels.status)) row.errors += value; }
    else if (hit[1].endsWith('_sum')) row.sum = value;
    else row.count = value;
    rows.set(key, row);
  }
  return [...rows.values()].map(({ sum, count, ...row }) => ({ ...row, meanMs: sum !== null && count !== null && count > 0 ? sum / count * 1000 : null })).sort((a, b) => b.requests - a.requests || a.route.localeCompare(b.route));
}

export function recordedTimeBins(times: string[], size = 12) {
  const values = times.map(Date.parse).filter(Number.isFinite);
  if (!values.length) return { from: null, to: null, counts: [] as number[] };
  const from = Math.min(...values), to = Math.max(...values), width = Math.max(1, to - from);
  const counts = Array.from({ length: size }, () => 0);
  for (const at of values) counts[Math.min(size - 1, Math.floor((at - from) / width * size))]++;
  return { from, to, counts };
}
