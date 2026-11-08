import { dialectContextOf,translateMigration } from './pg-dialect';
const history=`
CREATE TABLE cost_reference_revision (est_id TEXT NOT NULL REFERENCES cost_project(est_id), line_no INTEGER NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), ref_id TEXT NOT NULL, ref_release TEXT NOT NULL, reference_sha256 TEXT NOT NULL, feature_sha256 TEXT, captured_by TEXT NOT NULL, captured_at TEXT NOT NULL, reason TEXT NOT NULL, doc_sealed TEXT NOT NULL, PRIMARY KEY(est_id,line_no,revision));
CREATE TRIGGER cost_reference_revision_no_delete BEFORE DELETE ON cost_reference_revision BEGIN SELECT RAISE(ABORT, 'cost reference history is append only'); END;
CREATE TRIGGER cost_reference_revision_metadata_immutable BEFORE UPDATE OF est_id,line_no,revision,ref_id,ref_release,reference_sha256,feature_sha256,captured_by,captured_at,reason ON cost_reference_revision BEGIN SELECT RAISE(ABORT, 'cost reference metadata is immutable'); END;
CREATE TABLE cost_approval_source (est_id TEXT NOT NULL, approval_rev INTEGER NOT NULL, line_no INTEGER NOT NULL, source_revision INTEGER NOT NULL, PRIMARY KEY(est_id,approval_rev,line_no), FOREIGN KEY(est_id,approval_rev) REFERENCES cost_result(est_id,rev), FOREIGN KEY(est_id,line_no,source_revision) REFERENCES cost_reference_revision(est_id,line_no,revision));
CREATE TRIGGER cost_approval_source_no_update BEFORE UPDATE ON cost_approval_source BEGIN SELECT RAISE(ABORT, 'cost approval sources are immutable'); END;
CREATE TRIGGER cost_approval_source_no_delete BEFORE DELETE ON cost_approval_source BEGIN SELECT RAISE(ABORT, 'cost approval sources are append only'); END;
`;
export const COST_REFERENCE_MIGRATION={
 name:'451_cost_reference_source',
 sql:`
DROP INDEX cost_line_feature;
ALTER TABLE cost_line RENAME TO cost_line_registered_legacy;
CREATE TABLE cost_line (est_id TEXT NOT NULL,line_no INTEGER NOT NULL,feature_id TEXT,version TEXT,ref_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('PRIMARY','INCLUDED','REFERENCE')),doc TEXT NOT NULL,PRIMARY KEY(est_id,line_no),CHECK((feature_id IS NULL AND version IS NULL AND role='REFERENCE') OR (feature_id IS NOT NULL AND version IS NOT NULL AND role IN ('PRIMARY','INCLUDED'))));
INSERT INTO cost_line(est_id,line_no,feature_id,version,ref_id,role,doc) SELECT est_id,line_no,feature_id,version,ref_id,role,doc FROM cost_line_registered_legacy;
DROP TABLE cost_line_registered_legacy;
CREATE INDEX cost_line_feature ON cost_line(est_id,feature_id,version);
${history}`,
 pg:`
ALTER TABLE cost_line ALTER COLUMN feature_id DROP NOT NULL;
ALTER TABLE cost_line ALTER COLUMN version DROP NOT NULL;
ALTER TABLE cost_line DROP CONSTRAINT cost_line_role_check;
ALTER TABLE cost_line ADD CONSTRAINT cost_line_role_check CHECK(role IN ('PRIMARY','INCLUDED','REFERENCE'));
ALTER TABLE cost_line ADD CONSTRAINT cost_line_origin_check CHECK((feature_id IS NULL AND version IS NULL AND role='REFERENCE') OR (feature_id IS NOT NULL AND version IS NOT NULL AND role IN ('PRIMARY','INCLUDED')));
${translateMigration({sql:history},dialectContextOf([{sql:history}]))}`,
};
