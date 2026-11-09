import {dialectContextOf,translateMigration} from './pg-dialect';
const sql=`
CREATE TABLE cost_review_revision (
 est_id TEXT NOT NULL REFERENCES cost_project(est_id), case_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 kind TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
 content_sha256 TEXT NOT NULL, baseline_sha256 TEXT NOT NULL, document_sha256 TEXT NOT NULL, doc_sealed TEXT NOT NULL,
 PRIMARY KEY(est_id,case_id,revision)
);
CREATE INDEX cost_review_latest ON cost_review_revision(est_id,case_id,revision DESC);
CREATE TRIGGER cost_review_no_delete BEFORE DELETE ON cost_review_revision BEGIN SELECT RAISE(ABORT,'구매 검토 개정은 삭제할 수 없습니다'); END;
CREATE TRIGGER cost_review_no_metadata_update BEFORE UPDATE ON cost_review_revision
 WHEN NEW.est_id<>OLD.est_id OR NEW.case_id<>OLD.case_id OR NEW.revision<>OLD.revision OR NEW.kind<>OLD.kind OR NEW.status<>OLD.status OR NEW.created_by<>OLD.created_by OR NEW.updated_by<>OLD.updated_by OR NEW.updated_at<>OLD.updated_at OR NEW.content_sha256<>OLD.content_sha256 OR NEW.baseline_sha256<>OLD.baseline_sha256 OR NEW.document_sha256<>OLD.document_sha256
 BEGIN SELECT RAISE(ABORT,'구매 검토 개정은 추가만 가능합니다'); END;
`;
export const COST_REVIEW_MIGRATION={name:'461_cost_purchasing_review',sql,pg:translateMigration({sql},dialectContextOf([{sql}]))};
