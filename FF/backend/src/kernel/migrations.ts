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
  {
    name: '004_catalog',
    sql: `
ALTER TABLE product ADD COLUMN created_by TEXT;
ALTER TABLE product ADD COLUMN created_at TEXT;
ALTER TABLE product ADD COLUMN config_approved_by TEXT;
ALTER TABLE product ADD COLUMN release_approved_by TEXT;
`,
  },
  {
    name: '005_policy_runtime',
    sql: `
CREATE TABLE policy (
  policy_id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL, feature_version TEXT NOT NULL, control_point TEXT NOT NULL,
  flag_key TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL,
  doc TEXT NOT NULL
);
CREATE INDEX policy_feature ON policy(feature_id, feature_version);
CREATE INDEX policy_flag ON policy(flag_key);

CREATE TABLE validation_run (
  run_id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL, policy_revision INTEGER NOT NULL, content_hash TEXT NOT NULL,
  decision TEXT NOT NULL, at TEXT NOT NULL, by_actor TEXT NOT NULL,
  doc TEXT NOT NULL
);
CREATE INDEX validation_run_policy ON validation_run(policy_id);

CREATE TABLE vehicle (vin TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE entitlement (grant_id TEXT PRIMARY KEY, vin TEXT NOT NULL, catalog_id TEXT NOT NULL, status TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX entitlement_vin ON entitlement(vin);
`,
  },
  {
    name: '006_delivery',
    sql: `
CREATE TABLE pki_key (key_id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, not_after TEXT NOT NULL, public_pem TEXT NOT NULL, private_pem TEXT NOT NULL, retired_at TEXT);
CREATE TABLE publication (
  publication_id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
  scope_key TEXT NOT NULL, sequence INTEGER NOT NULL, created_at TEXT NOT NULL, doc TEXT NOT NULL,
  UNIQUE (scope_key, sequence)
);
CREATE INDEX publication_status ON publication(status);
CREATE TABLE readback (id INTEGER PRIMARY KEY AUTOINCREMENT, publication_id TEXT NOT NULL, vin TEXT NOT NULL, at TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX readback_pub ON readback(publication_id);
CREATE TABLE if_call (id INTEGER PRIMARY KEY AUTOINCREMENT, if_id TEXT NOT NULL, idem_key TEXT NOT NULL, at TEXT NOT NULL, doc TEXT NOT NULL, UNIQUE (if_id, idem_key));
CREATE TABLE kill_request (kill_id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, status TEXT NOT NULL, doc TEXT NOT NULL);
CREATE TABLE vehicle_runtime (vin TEXT PRIMARY KEY, doc TEXT NOT NULL);
`,
  },
  {
    name: '007_virtual_validation',
    sql: `
CREATE TABLE virtual_run (
  run_id TEXT PRIMARY KEY, policy_id TEXT NOT NULL, feature_id TEXT NOT NULL, feature_version TEXT NOT NULL,
  scenario_id TEXT NOT NULL, content_hash TEXT NOT NULL, at TEXT NOT NULL, doc TEXT NOT NULL
);
CREATE INDEX virtual_run_policy ON virtual_run(policy_id, scenario_id);
CREATE INDEX virtual_run_feature ON virtual_run(feature_id, feature_version);
`,
  },
  {
    name: '008_vehicle_request',
    sql: `
CREATE TABLE vehicle_request (
  request_id TEXT PRIMARY KEY, vin TEXT NOT NULL, at TEXT NOT NULL, boot_id TEXT, sequence INTEGER, doc TEXT NOT NULL
);
CREATE INDEX vehicle_request_vin ON vehicle_request(vin, at);
CREATE UNIQUE INDEX vehicle_request_idem ON vehicle_request(vin, boot_id, sequence) WHERE boot_id IS NOT NULL;
CREATE TABLE vehicle_channel (vin TEXT PRIMARY KEY, boot_id TEXT NOT NULL, sequence INTEGER NOT NULL);
`,
  },
  {
    name: '009_anomaly_feedback',
    sql: `
CREATE TABLE anomaly (anomaly_id TEXT PRIMARY KEY, kind TEXT NOT NULL, feature_id TEXT NOT NULL, status TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX anomaly_open ON anomaly(kind, feature_id, status);
CREATE TABLE quality_feedback (feedback_id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, status TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX quality_feedback_feature ON quality_feedback(feature_id, status);
`,
  },
  {
    name: '010_poc_run',
    sql: `
CREATE TABLE poc_run (run_id TEXT PRIMARY KEY, status TEXT NOT NULL, started_at TEXT NOT NULL, doc TEXT NOT NULL);
`,
  },
  {
    // 기간형 체험권 — 차량 가명 성향(국가·지역·차종·트림·연령대·주행 성향·ADAS 사용)과 데모/합성 구분
    name: '011_trial_analytics',
    sql: `
CREATE TABLE vehicle_profile (vin TEXT PRIMARY KEY, source TEXT NOT NULL, doc TEXT NOT NULL);
ALTER TABLE entitlement ADD COLUMN source TEXT NOT NULL DEFAULT 'DEMO';
CREATE INDEX entitlement_catalog ON entitlement(catalog_id, source);
`,
  },
  {
    // 보고서 v1.1 WP0 커널 신뢰 기반 — 감사 해시 체인(FFG-PLT-015)·서명 키 용도/epoch(FFG-SEC-002)·승인자 개인 키(FFG-PLT-005)·소프트웨어 HSM 비밀
    // 감사 행은 추가만: 삭제는 언제나, 수정은 해시가 채워진 뒤 막는다(해시 없는 옛 행의 채우기만 허용 — AuditService.onModuleInit).
    name: '012_trust',
    sql: `
ALTER TABLE audit ADD COLUMN prev_hash TEXT;
ALTER TABLE audit ADD COLUMN hash TEXT;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only (FFG-PLT-015)'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit WHEN OLD.hash IS NOT NULL BEGIN SELECT RAISE(ABORT, 'audit is append-only (FFG-PLT-015)'); END;
ALTER TABLE pki_key ADD COLUMN purpose TEXT NOT NULL DEFAULT 'policy';
ALTER TABLE pki_key ADD COLUMN epoch INTEGER NOT NULL DEFAULT 1;
CREATE INDEX pki_key_purpose ON pki_key(purpose, status);
CREATE TABLE approver_key (user_id TEXT PRIMARY KEY, kid TEXT NOT NULL UNIQUE, status TEXT NOT NULL, created_at TEXT NOT NULL, public_pem TEXT NOT NULL, private_pem TEXT NOT NULL);
CREATE TABLE hsm_secret (name TEXT NOT NULL, epoch INTEGER NOT NULL, secret TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (name, epoch));
`,
  },
];
