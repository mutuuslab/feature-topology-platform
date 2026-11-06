// Grafana 운영 대시보드 링크(80-80) — 빌드 설정으로만 받는다. 값이 없거나 https가 아니면 링크를 숨긴다(빈 칸·'연결 안 됨'을 보이지 않는다).
//   VITE_GRAFANA_PUBLIC_URL         차량 텔레메트리 수신 공개 대시보드(로그인 없이) — /ops/telemetry
//   VITE_GRAFANA_FEATURE_PUBLIC_URL Feature 운영 건강도 공개 대시보드 — 변수를 못 쓰므로 Feature로 좁히지 않는다
//   VITE_GRAFANA_URL                스택 주소(https://<스택>.grafana.net) — 로그인 사용자는 해당 Feature로 좁힌 대시보드(var-feature)
//   VITE_GRAFANA_EMBED=1            운영 데이터 화면에 공개 대시보드를 함께 싣는다(공개 사이트 CSP frame-src에 스택 주소 필요)
type Env = Record<string, string | boolean | undefined>;

const https = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString().replace(/\/$/, '') : null;
  } catch {
    return null;
  }
};

export interface GrafanaLinks {
  telemetry: string | null;
  feature: (featureId: string, version?: string) => { url: string; scoped: boolean } | null;
  embed: string | null;
}

export function grafanaLinks(env: Env = import.meta.env as Env): GrafanaLinks {
  const pub = https(env.VITE_GRAFANA_PUBLIC_URL);
  const featurePub = https(env.VITE_GRAFANA_FEATURE_PUBLIC_URL);
  const stack = https(env.VITE_GRAFANA_URL);
  const telemetry = pub ?? (stack ? `${stack}/d/ff-vehicle-telemetry` : null);
  return {
    telemetry,
    feature: (featureId, version) => {
      if (stack) {
        const q = new URLSearchParams({ 'var-feature': featureId, ...(version && { 'var-feature_version': version }), from: 'now-24h', to: 'now' });
        return { url: `${stack}/d/ff-feature-health?${q}`, scoped: true };
      }
      return featurePub ? { url: featurePub, scoped: false } : null;
    },
    embed: env.VITE_GRAFANA_EMBED === '1' || env.VITE_GRAFANA_EMBED === true ? pub : null,
  };
}
