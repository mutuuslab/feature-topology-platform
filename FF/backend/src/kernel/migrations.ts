// 스키마 마이그레이션 — 이름 순 적용, 적용된 것은 다시 실행하지 않는다. 기존 항목은 수정하지 말고 새 항목을 추가한다.
// 도메인 레코드는 "키 열 + doc(JSON)" 형태로 저장한다: 키·조회 조건은 열로, 본문은 contracts zod 스키마로 파싱.
export const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: '001_kernel',
    sql: `
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('ALLOWED','DENIED','FAILED')),
  reason TEXT,
  before_doc TEXT,
  after_doc TEXT,
  correlation_id TEXT,
  component_id TEXT
);
CREATE INDEX audit_target ON audit(target);
CREATE INDEX audit_actor ON audit(actor_id);

CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  aggregate TEXT NOT NULL,
  component_id TEXT,
  correlation_id TEXT,
  payload TEXT NOT NULL
);
CREATE INDEX events_type ON events(type);
CREATE INDEX events_aggregate ON events(aggregate);

CREATE TABLE idempotency (
  key TEXT NOT NULL,
  route TEXT NOT NULL,
  req_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (key, route)
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`,
  },
  {
    name: '002_dataset_v081',
    sql: `
CREATE TABLE feature_version (
  feature_id TEXT NOT NULL, version TEXT NOT NULL,
  lifecycle TEXT NOT NULL, baseline_id TEXT,
  doc TEXT NOT NULL,
  PRIMARY KEY (feature_id, version)
);
CREATE INDEX feature_version_lc ON feature_version(lifecycle);

CREATE TABLE baseline (
  baseline_id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL, version TEXT NOT NULL,
  content_hash TEXT,
  doc TEXT NOT NULL,
  UNIQUE (feature_id, version)
);

CREATE TABLE product (
  catalog_id TEXT NOT NULL, version TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  doc TEXT NOT NULL,
  PRIMARY KEY (catalog_id, version)
);

CREATE TABLE dependency (
  dependency_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source_feature_id TEXT NOT NULL, source_version TEXT NOT NULL,
  target_feature_id TEXT NOT NULL, target_version TEXT,
  doc TEXT NOT NULL
);
CREATE INDEX dependency_src ON dependency(source_feature_id, source_version);
CREATE INDEX dependency_tgt ON dependency(target_feature_id);

CREATE TABLE gate_record (
  gate_record_id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL, feature_version TEXT NOT NULL,
  gate TEXT NOT NULL, status TEXT NOT NULL,
  judged_at TEXT NOT NULL,
  doc TEXT NOT NULL
);
CREATE INDEX gate_record_fv ON gate_record(feature_id, feature_version, gate);

CREATE TABLE evidence (
  evidence_ref TEXT NOT NULL, gate_record_id TEXT NOT NULL,
  doc TEXT NOT NULL,
  PRIMARY KEY (gate_record_id)
);

CREATE TABLE feature_function (
  feature_id TEXT NOT NULL, feature_version TEXT NOT NULL, function_id TEXT NOT NULL,
  doc TEXT NOT NULL,
  PRIMARY KEY (feature_id, feature_version, function_id)
);

CREATE TABLE sw_master (sw_id TEXT NOT NULL, version TEXT NOT NULL, ecu_pno TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (sw_id, version, ecu_pno));
CREATE TABLE ecu_master (ecu_pno TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE version_rationale (feature_id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE precheck_rule (rule_id TEXT PRIMARY KEY, doc TEXT NOT NULL);
`,
  },
  {
    name: '003_registry_bom',
    sql: `
ALTER TABLE feature_version ADD COLUMN created_by TEXT;
ALTER TABLE feature_version ADD COLUMN created_at TEXT;
ALTER TABLE baseline ADD COLUMN approved_by TEXT;
ALTER TABLE baseline ADD COLUMN approved_at TEXT;
ALTER TABLE baseline ADD COLUMN request_id TEXT;

CREATE TABLE baseline_request (
  request_id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL, version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  requested_by TEXT NOT NULL, requested_at TEXT NOT NULL, reason TEXT NOT NULL,
  decided_by TEXT, decided_at TEXT, decision_reason TEXT,
  baseline_id TEXT
);
CREATE INDEX baseline_request_status ON baseline_request(status);
`,
  },
];
