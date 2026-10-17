// 롤백 저장소 (D03-04) — Plan·수동 요청·실행 (키 열 + doc JSON)
import { Inject, Injectable } from '@nestjs/common';
import type { RollbackExecution, RollbackPlan, RollbackRequest } from '@ff/contracts';
import { DB, type Db } from '../../../kernel/db';

const pad = (n: number) => String(n).padStart(5, '0');
const parse = <T>(rows: { doc: string }[]) => rows.map((r) => JSON.parse(r.doc) as T);

@Injectable()
export class RollbackRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  private next(table: string, col: string, prefix: string) {
    const r = this.db.get<{ m: number | null }>(`SELECT max(CAST(substr(${col}, 5) AS INTEGER)) AS m FROM ${table}`);
    return `${prefix}-${pad((r?.m ?? 0) + 1)}`;
  }

  // Rollback Plan
  nextPlanId = () => this.next('rollback_plan', 'plan_id', 'RBP');
  insertPlan(p: RollbackPlan) {
    this.db.run('INSERT INTO rollback_plan (plan_id, deployment_id, feature_id, status, doc) VALUES (?, ?, ?, ?, ?)', p.planId, p.deploymentId, p.featureId, p.status, JSON.stringify(p));
  }
  updatePlan(p: RollbackPlan) {
    this.db.run('UPDATE rollback_plan SET status = ?, doc = ? WHERE plan_id = ?', p.status, JSON.stringify(p), p.planId);
  }
  plan(id: string): RollbackPlan | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM rollback_plan WHERE plan_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  plans(q: { deploymentId?: string; status?: string; featureId?: string } = {}): RollbackPlan[] {
    return parse<RollbackPlan>(this.db.all('SELECT doc FROM rollback_plan ORDER BY plan_id DESC')).filter((p) => (!q.deploymentId || p.deploymentId === q.deploymentId) && (!q.status || p.status === q.status) && (!q.featureId || p.featureId === q.featureId));
  }

  // 수동 롤백 요청
  nextRequestId = () => this.next('rollback_request', 'request_id', 'RBR');
  insertRequest(r: RollbackRequest) {
    this.db.run('INSERT INTO rollback_request (request_id, deployment_id, feature_id, status, doc) VALUES (?, ?, ?, ?, ?)', r.requestId, r.deploymentId, r.featureId, r.status, JSON.stringify(r));
  }
  updateRequest(r: RollbackRequest) {
    this.db.run('UPDATE rollback_request SET status = ?, doc = ? WHERE request_id = ?', r.status, JSON.stringify(r), r.requestId);
  }
  request(id: string): RollbackRequest | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM rollback_request WHERE request_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  requests(q: { deploymentId?: string; status?: string } = {}): RollbackRequest[] {
    return parse<RollbackRequest>(this.db.all('SELECT doc FROM rollback_request ORDER BY request_id DESC')).filter((r) => (!q.deploymentId || r.deploymentId === q.deploymentId) && (!q.status || r.status === q.status));
  }

  // 롤백 실행
  nextExecutionId = () => this.next('rollback_execution', 'execution_id', 'RBX');
  insertExecution(x: RollbackExecution) {
    this.db.run(
      'INSERT INTO rollback_execution (execution_id, deployment_id, feature_id, plan_id, request_id, status, result, artifact_id, started_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      x.executionId,
      x.deploymentId,
      x.featureId,
      x.planId,
      x.requestId,
      x.status,
      x.result,
      x.artifactId,
      x.startedAt,
      JSON.stringify(x),
    );
  }
  updateExecution(x: RollbackExecution) {
    this.db.run('UPDATE rollback_execution SET status = ?, result = ?, artifact_id = ?, doc = ? WHERE execution_id = ?', x.status, x.result, x.artifactId, JSON.stringify(x), x.executionId);
  }
  execution(id: string): RollbackExecution | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM rollback_execution WHERE execution_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  executionByArtifact(artifactId: string): RollbackExecution | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM rollback_execution WHERE artifact_id = ?', artifactId);
    return r ? JSON.parse(r.doc) : undefined;
  }
  executions(): RollbackExecution[] {
    return parse<RollbackExecution>(this.db.all('SELECT doc FROM rollback_execution ORDER BY execution_id DESC'));
  }
}
