// IF-04 Policy Tool — Unleash OSS 8.2.0 Admin API 클라이언트 (hfp-feature-lifecycle tools/unleash-bridge.js·test UNI_STUB의 TS 이식).
//   UNLEASH_MODE=mock(기본: 메모리 안의 Unleash — 같은 경로·응답 모양) | live(UNLEASH_URL, 기본 http://127.0.0.1:4242) | off
//   live는 Admin API 허용 목록 경로만 부르고, 토큰은 Authorization 헤더에 원문으로 보낸다(UNLEASH_ADMIN_TOKEN). 결과 상태: OK·NOT_FOUND·DENIED·FAILED·INVALID.
import { Injectable } from '@nestjs/common';
import type { UnleashConstraint } from '@ff/contracts';

export type UnleashState = 'OK' | 'NOT_FOUND' | 'DENIED' | 'FAILED' | 'INVALID' | 'UNKNOWN';
export interface UnleashResult<T = any> {
  state: UnleashState;
  code: number;
  data: T | null;
  why: string | null;
}

const ID = '[A-Za-z0-9_~.-]+';
const VAL = '[A-Za-z0-9_~.%:@-]+';
/** hfp 브리지와 같은 Admin API 허용 목록 (쿼리·끝 슬래시는 떼고 비교) */
export const ADMIN_ALLOWLIST = [
  `projects(/${ID})?`,
  `projects/${ID}/features`,
  `projects/${ID}/features/${ID}`,
  `projects/${ID}/features/${ID}/environments/${ID}/(on|off|strategies|variants)`,
  `projects/${ID}/features/${ID}/environments/${ID}/strategies/${ID}`,
  `projects/${ID}/features/${ID}/(tags|dependencies|lifecycle)`,
  `projects/${ID}/features/${ID}/dependencies/${ID}`,
  `projects/${ID}/dependencies`,
  `projects/${ID}/tags`,
  `features/${ID}/tags`,
  `features/${ID}/tags/${VAL}/${VAL}`,
  'tags',
  `tags/${VAL}/${VAL}`,
  'tag-types',
  `tag-types/${ID}`,
  'environments',
  'playground',
  'playground/advanced',
  `events/${ID}`,
  'events',
  `archive/${ID}`,
  `archive/revive/${ID}`,
  'instance-admin/statistics',
].map((p) => new RegExp(`^${p}$`));

export const allowed = (path: string) => ADMIN_ALLOWLIST.some((re) => re.test(path.split('?')[0].replace(/\/+$/, '')));

const stateOf = (code: number): UnleashState => (code >= 200 && code < 300 ? 'OK' : code === 404 ? 'NOT_FOUND' : code === 401 || code === 403 ? 'DENIED' : code === 400 || code === 422 ? 'INVALID' : 'FAILED');

export interface UnleashClient {
  readonly mode: 'mock' | 'live' | 'off';
  readonly url: string | null;
  health(): Promise<UnleashResult<{ version: string | null; instanceId: string | null }>>;
  admin<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<UnleashResult<T>>;
}

// ---------------- live ----------------
class LiveUnleash implements UnleashClient {
  readonly mode = 'live' as const;
  constructor(
    readonly url: string,
    private readonly token: string,
    private readonly timeoutMs = 8000,
  ) {}

  private async call<T>(method: string, full: string, body?: unknown, auth = true): Promise<UnleashResult<T>> {
    try {
      const res = await fetch(`${this.url}${full}`, {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(auth && { Authorization: this.token }) },
        body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const text = await res.text();
      const data = text ? (JSON.parse(text) as T) : null;
      const state = stateOf(res.status);
      return { state, code: res.status, data, why: state === 'OK' ? null : ((data as any)?.message ?? (data as any)?.error ?? res.statusText) };
    } catch (e) {
      return { state: 'FAILED', code: 0, data: null, why: `Unleash 연결 실패: ${(e as Error).message}` };
    }
  }

  async health() {
    const h = await this.call<{ health: string }>('GET', '/health', undefined, false);
    if (h.state !== 'OK') return { ...h, data: null };
    const s = await this.call<{ versionOSS?: string; instanceId?: string }>('GET', '/api/admin/instance-admin/statistics');
    return { state: s.state, code: s.code, why: s.why, data: { version: s.data?.versionOSS ?? null, instanceId: s.data?.instanceId ?? null } };
  }

  admin<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<UnleashResult<T>> {
    if (!allowed(path)) return Promise.resolve({ state: 'DENIED', code: 403, data: null, why: `허용 목록 밖 경로: ${path}` });
    return this.call<T>(method, `/api/admin/${path}`, body);
  }
}

// ---------------- mock (메모리 안의 Unleash) ----------------
interface MockFeature {
  name: string;
  type: string;
  description: string;
  archived: boolean;
  enabled: Record<string, boolean>;
  strategies: Record<string, { id: string; name: string; title?: string; disabled?: boolean; parameters: { groupId: string; rollout: string; stickiness: string }; constraints: UnleashConstraint[] }[]>;
  tags: { type: string; value: string }[];
  dependencies: { feature: string }[];
}

const semver = (v: string) => v.split(/[.+-]/).slice(0, 3).map((x) => Number(x));
const cmpSemver = (a: string, b: string) => {
  const x = semver(a);
  const y = semver(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

/** Unleash 제약 의미 — 문맥이 없으면 false(Unleash는 3치 논리가 아니다: P0의 UNKNOWN→HOLD와 다른 점) */
export function unleashConstraintTrue(c: UnleashConstraint, props: Record<string, string | undefined>): boolean {
  const raw = props[c.contextName];
  let ok: boolean;
  if (raw === undefined) ok = false;
  else {
    const v = c.caseInsensitive ? raw.toLowerCase() : raw;
    const vals = (c.values ?? (c.value !== undefined ? [c.value] : [])).map((x) => (c.caseInsensitive ? x.toLowerCase() : x));
    const one = c.value ?? vals[0];
    switch (c.operator) {
      case 'IN': ok = vals.includes(v); break;
      case 'NOT_IN': ok = !vals.includes(v); break;
      case 'STR_CONTAINS': ok = vals.some((x) => v.includes(x)); break;
      case 'STR_STARTS_WITH': ok = vals.some((x) => v.startsWith(x)); break;
      case 'STR_ENDS_WITH': ok = vals.some((x) => v.endsWith(x)); break;
      case 'NUM_EQ': ok = Number(v) === Number(one); break;
      case 'NUM_GT': ok = Number(v) > Number(one); break;
      case 'NUM_GTE': ok = Number(v) >= Number(one); break;
      case 'NUM_LT': ok = Number(v) < Number(one); break;
      case 'NUM_LTE': ok = Number(v) <= Number(one); break;
      case 'SEMVER_EQ': ok = cmpSemver(v, one) === 0; break;
      case 'SEMVER_GT': ok = cmpSemver(v, one) > 0; break;
      case 'SEMVER_LT': ok = cmpSemver(v, one) < 0; break;
      case 'DATE_AFTER': ok = Date.parse(v) > Date.parse(one); break;
      case 'DATE_BEFORE': ok = Date.parse(v) < Date.parse(one); break;
      default: ok = false;
    }
  }
  // NOT_IN은 문맥이 없어도 참이다(Unleash 동작)
  if (raw === undefined && c.operator === 'NOT_IN') ok = true;
  return c.inverted ? !ok : ok;
}

export class MockUnleash implements UnleashClient {
  readonly mode = 'mock' as const;
  readonly url = null;
  features = new Map<string, MockFeature>();
  tagTypes = new Set<string>(['simple']);
  tags: { type: string; value: string }[] = [];
  private seq = 0;
  /** 시험용 — 다른 도구가 Unleash에서 직접 바꾼 흔적(drift)을 흉내 낸다 */
  tamper(name: string, fn: (f: MockFeature) => void) {
    const f = this.features.get(name);
    if (f) fn(f);
  }

  async health() {
    return { state: 'OK' as const, code: 200, why: null, data: { version: '8.2.0 (mock)', instanceId: 'mock-unleash' } };
  }

  /** 실제 HTTP처럼 응답은 항상 사본 — 내부 상태와 참조를 공유하지 않는다 */
  private ok<T>(data: T, code = 200): UnleashResult<T> {
    return { state: 'OK', code, data: structuredClone(data), why: null };
  }
  private err(code: number, why: string): UnleashResult {
    return { state: stateOf(code), code, data: code === 404 ? ({ name: 'NotFoundError', message: why } as any) : null, why };
  }

  async admin<T>(method: string, path: string, body: any = {}): Promise<UnleashResult<T>> {
    if (!allowed(path)) return this.err(403, `허용 목록 밖 경로: ${path}`) as UnleashResult<T>;
    const p = path.split('?')[0].replace(/\/+$/, '').split('/');
    const r = (x: UnleashResult) => x as UnleashResult<T>;
    if (p[0] === 'tag-types') {
      if (method === 'GET') return r(this.ok({ tagTypes: [...this.tagTypes].map((name) => ({ name })) }));
      this.tagTypes.add(body.name);
      return r(this.ok({ name: body.name }, 201));
    }
    if (p[0] === 'tags') {
      if (method === 'GET') return r(this.ok({ tags: this.tags }));
      if (!this.tagTypes.has(body.type)) return r(this.err(400, `태그 유형 ${body.type} 없음`));
      if (!this.tags.some((t) => t.type === body.type && t.value === body.value)) this.tags.push({ type: body.type, value: body.value });
      return r(this.ok({ tag: body }, 201));
    }
    if (p[0] === 'archive' && p[1] === 'revive') {
      const f = this.features.get(p[2]);
      if (!f) return r(this.err(404, `${p[2]} 없음`));
      f.archived = false;
      return r(this.ok({}));
    }
    if (p[0] === 'features' && p[2] === 'tags') {
      const f = this.features.get(p[1]);
      if (!f || f.archived) return r(this.err(404, `${p[1]} 없음`));
      if (method === 'GET') return r(this.ok({ tags: f.tags }));
      if (!f.tags.some((t) => t.type === body.type && t.value === body.value)) f.tags.push({ type: body.type, value: body.value });
      return r(this.ok(body, 201));
    }
    if (p[0] === 'playground' && p[1] === 'advanced') return r(this.playground(body));
    if (p[0] === 'instance-admin') return r(this.ok({ versionOSS: '8.2.0 (mock)', instanceId: 'mock-unleash', featureToggles: this.features.size }));
    if (p[0] !== 'projects') return r(this.err(404, `모의 Unleash가 다루지 않는 경로: ${path}`));
    // projects/{p}/features[/{f}[/…]]
    const name = p[3];
    if (p.length === 3) {
      if (method === 'GET') return r(this.ok({ features: [...this.features.values()].filter((f) => !f.archived) }));
      if (this.features.has(body.name)) return r(this.err(409, `${body.name}이(가) 이미 있습니다`));
      this.features.set(body.name, { name: body.name, type: body.type ?? 'release', description: body.description ?? '', archived: false, enabled: {}, strategies: {}, tags: [], dependencies: [] });
      return r(this.ok({ name: body.name }, 201));
    }
    const f = this.features.get(name);
    if (!f || f.archived) return r(this.err(404, `${name} 없음`));
    if (p.length === 4) return r(this.ok({ name: f.name, description: f.description, environments: Object.keys({ development: 1, ...f.enabled }).map((env) => ({ name: env, enabled: !!f.enabled[env], strategies: f.strategies[env] ?? [] })), tags: f.tags }));
    if (p[4] === 'dependencies') {
      if (method === 'GET') return r(this.ok(f.dependencies));
      if (!this.features.has(body.feature)) return r(this.err(400, `상위 flag ${body.feature} 없음`));
      if (!f.dependencies.some((d) => d.feature === body.feature)) f.dependencies.push({ feature: body.feature });
      return r(this.ok({}, 200));
    }
    if (p[4] === 'environments') {
      const env = p[5];
      if (p[6] === 'on' || p[6] === 'off') {
        f.enabled[env] = p[6] === 'on';
        return r(this.ok({}));
      }
      const list = (f.strategies[env] ??= []);
      if (p[6] === 'strategies' && p.length === 7) {
        if (method === 'GET') return r(this.ok(list));
        const s = { id: `mock-${++this.seq}`, name: body.name, title: body.title, disabled: !!body.disabled, parameters: body.parameters, constraints: body.constraints ?? [] };
        list.push(s);
        return r(this.ok(s, 200));
      }
      const i = list.findIndex((s) => s.id === p[7]);
      if (i < 0) return r(this.err(404, `전략 ${p[7]} 없음`));
      if (method === 'DELETE') {
        list.splice(i, 1);
        return r(this.ok({}));
      }
      list[i] = { ...list[i], ...body, id: list[i].id };
      return r(this.ok(list[i]));
    }
    return r(this.err(404, `모의 Unleash가 다루지 않는 경로: ${path}`));
  }

  /** playground/advanced — 문맥은 객체 하나여야 한다(배열은 400, hfp와 같다) */
  private playground(body: any): UnleashResult {
    if (!body?.context || Array.isArray(body.context) || typeof body.context !== 'object') return this.err(400, 'context는 객체여야 합니다');
    const env = body.environments?.[0] ?? 'development';
    const props: Record<string, string | undefined> = { ...(body.context.properties ?? {}), userId: body.context.userId };
    const evalFeature = (f: MockFeature): boolean => {
      const strategies = (f.strategies[env] ?? []).filter((s) => !s.disabled);
      return strategies.some((s) => s.constraints.every((c) => unleashConstraintTrue(c, props)) && Number(s.parameters.rollout) >= 100);
    };
    const features = [...this.features.values()]
      .filter((f) => !f.archived)
      .map((f) => {
        const envOn = !!f.enabled[env];
        const strategiesOk = evalFeature(f);
        const unsatisfied = f.dependencies.some((d) => {
          const parent = this.features.get(d.feature);
          return !parent || !parent.enabled[env] || !evalFeature(parent);
        });
        const enabled = envOn && strategiesOk && !unsatisfied;
        return {
          name: f.name,
          environments: {
            [env]: [
              {
                name: f.name,
                isEnabled: enabled,
                isEnabledInCurrentEnvironment: envOn,
                hasUnsatisfiedDependency: unsatisfied,
                context: { userId: body.context.userId, properties: body.context.properties },
                strategies: { result: strategiesOk, data: (f.strategies[env] ?? []).map((s) => ({ id: s.id, name: s.name, disabled: !!s.disabled, parameters: s.parameters, result: { enabled: s.constraints.every((c) => unleashConstraintTrue(c, props)), evaluationStatus: 'complete' }, constraints: s.constraints.map((c) => ({ ...c, result: unleashConstraintTrue(c, props) })) })) },
              },
            ],
          },
        };
      });
    return this.ok({ features });
  }
}

class OffUnleash implements UnleashClient {
  readonly mode = 'off' as const;
  readonly url = null;
  async health() {
    return { state: 'UNKNOWN' as const, code: 0, data: null, why: 'UNLEASH_MODE=off' };
  }
  async admin() {
    return { state: 'UNKNOWN' as const, code: 0, data: null, why: 'UNLEASH_MODE=off' };
  }
}

/** 모드는 부팅 때 정한다 — 시험은 UNLEASH_MODE로 바꿔 새 앱을 띄운다 */
@Injectable()
export class UnleashGateway {
  readonly client: UnleashClient;
  constructor() {
    const mode = process.env.UNLEASH_MODE ?? 'mock';
    this.client =
      mode === 'live'
        ? new LiveUnleash(process.env.UNLEASH_URL ?? 'http://127.0.0.1:4242', process.env.UNLEASH_ADMIN_TOKEN ?? '')
        : mode === 'off'
          ? new OffUnleash()
          : new MockUnleash();
  }
}
