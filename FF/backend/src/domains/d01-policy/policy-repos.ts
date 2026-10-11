// 정책·검증 이력·차량·사용 권한 저장소 (키 열 + doc JSON)
import { Inject, Injectable } from '@nestjs/common';
import { canonicalJson, PolicySpec, type Entitlement, type Policy, type Vehicle } from '@ff/contracts';
import { createHash } from 'node:crypto';
import { DB, type Db } from '../../kernel/db';
import type { ValidatorResult } from '@ff/contracts';

const pad = (n: number, w: number) => String(n).padStart(w, '0');
const parse = <T>(rows: { doc: string }[]) => rows.map((r) => JSON.parse(r.doc) as T);

/** 정책 내용 해시 — 승인한 내용과 배포할 내용이 같은지(P0 publishCheck HASH_MISMATCH) 확인하는 기준 */
export function policyHash(p: Policy | PolicySpec): string {
  const spec = PolicySpec.parse(Object.fromEntries(Object.keys(PolicySpec.shape).map((k) => [k, (p as any)[k]])));
  return 'sha256:' + createHash('sha256').update(canonicalJson(spec)).digest('hex');
}

export interface ValidationRun {
  runId: string;
  policyId: string;
  policyRevision: number;
  contentHash: string;
  decision: 'GO' | 'HOLD' | 'BLOCKED';
  reasons: string[];
  at: string;
  by: string;
  results: ValidatorResult[];
}

@Injectable()
export class PolicyRepo {
  constructor(@Inject(DB) private readonly db: Db) {}
  get(id: string): Policy | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM policy WHERE policy_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  all(): Policy[] {
    return parse<Policy>(this.db.all('SELECT doc FROM policy ORDER BY policy_id'));
  }
  forFeature(featureId: string, version: string): Policy[] {
    return parse<Policy>(this.db.all('SELECT doc FROM policy WHERE feature_id = ? AND feature_version = ? ORDER BY policy_id', featureId, version));
  }
  byFlag(flagKey: string): Policy[] {
    return parse<Policy>(this.db.all('SELECT doc FROM policy WHERE flag_key = ? ORDER BY policy_id', flagKey));
  }
  /** 이 flagKey로 지금 배포된 정책 (차량 평가 기준) */
  deployed(flagKey: string): Policy | undefined {
    const r = this.db.get<{ doc: string }>("SELECT doc FROM policy WHERE flag_key = ? AND status = 'DEPLOYED' ORDER BY revision DESC LIMIT 1", flagKey);
    return r ? JSON.parse(r.doc) : undefined;
  }
  /** Control Point 중 승인·배포 정책이 있는 수 — Lifecycle DEVELOPING→VERIFIED 조건 */
  coverage(featureId: string, version: string): number {
    return this.db.get<{ n: number }>(
      "SELECT count(DISTINCT control_point) AS n FROM policy WHERE feature_id = ? AND feature_version = ? AND status IN ('APPROVED','DEPLOYED')",
      featureId,
      version,
    )!.n;
  }
  insert(p: Policy) {
    this.db.run(
      'INSERT INTO policy (policy_id, feature_id, feature_version, control_point, flag_key, status, revision, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      p.policyId,
      p.featureId,
      p.featureVersion,
      p.controlPoint,
      p.flagKey,
      p.status,
      p.revision,
      JSON.stringify(p),
    );
  }
  update(p: Policy) {
    this.db.run('UPDATE policy SET status = ?, revision = ?, flag_key = ?, control_point = ?, doc = ? WHERE policy_id = ?', p.status, p.revision, p.flagKey, p.controlPoint, JSON.stringify(p), p.policyId);
  }
  nextId(): string {
    const r = this.db.get<{ m: number | null }>('SELECT max(CAST(substr(policy_id, 5) AS INTEGER)) AS m FROM policy');
    return `POL-${pad((r?.m ?? 0) + 1, 5)}`;
  }

  // 검증 이력 (D06-04)
  insertRun(v: ValidationRun) {
    this.db.run(
      'INSERT INTO validation_run (run_id, policy_id, policy_revision, content_hash, decision, at, by_actor, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      v.runId,
      v.policyId,
      v.policyRevision,
      v.contentHash,
      v.decision,
      v.at,
      v.by,
      JSON.stringify(v),
    );
  }
  run(id: string): ValidationRun | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM validation_run WHERE run_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  runs(policyId?: string): ValidationRun[] {
    return policyId
      ? parse<ValidationRun>(this.db.all('SELECT doc FROM validation_run WHERE policy_id = ? ORDER BY at DESC, run_id DESC', policyId))
      : parse<ValidationRun>(this.db.all('SELECT doc FROM validation_run ORDER BY at DESC, run_id DESC LIMIT 200'));
  }
  nextRunId(): string {
    const r = this.db.get<{ m: number | null }>('SELECT max(CAST(substr(run_id, 5) AS INTEGER)) AS m FROM validation_run');
    return `VAL-${pad((r?.m ?? 0) + 1, 6)}`;
  }
}

@Injectable()
export class FleetRepo {
  constructor(@Inject(DB) private readonly db: Db) {}
  vehicles(): Vehicle[] {
    return parse<Vehicle>(this.db.all('SELECT doc FROM vehicle ORDER BY vin'));
  }
  vehicle(vin: string): Vehicle | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM vehicle WHERE vin = ?', vin);
    return r ? JSON.parse(r.doc) : undefined;
  }
  updateVehicle(v: Vehicle) {
    this.db.run('UPDATE vehicle SET doc = ? WHERE vin = ?', JSON.stringify(v), v.vin);
  }
  grants(vin?: string): Entitlement[] {
    return vin ? parse<Entitlement>(this.db.all('SELECT doc FROM entitlement WHERE vin = ? ORDER BY grant_id', vin)) : parse<Entitlement>(this.db.all('SELECT doc FROM entitlement ORDER BY grant_id'));
  }
  grant(id: string): Entitlement | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM entitlement WHERE grant_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  updateGrant(e: Entitlement) {
    this.db.run('UPDATE entitlement SET status = ?, doc = ? WHERE grant_id = ?', e.status, JSON.stringify(e), e.grantId);
  }
}
