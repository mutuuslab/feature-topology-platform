const schema = (bytes: string) => `
CREATE TABLE binary_capacity (id INTEGER PRIMARY KEY CHECK(id=1), used_bytes BIGINT NOT NULL CHECK(used_bytes>=0));
INSERT INTO binary_capacity(id,used_bytes) VALUES(1,0);
CREATE TABLE binary_object (file_id TEXT PRIMARY KEY, scope TEXT NOT NULL, request_key TEXT NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL, media_type TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('UPLOADING','READY','ATTACHED')), bytes BIGINT NOT NULL, sha256 TEXT, chunks INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(scope,request_key));
CREATE INDEX binary_object_expiry ON binary_object(status,expires_at);
CREATE TABLE binary_chunk (file_id TEXT NOT NULL REFERENCES binary_object(file_id) ON DELETE CASCADE, seq INTEGER NOT NULL, data ${bytes} NOT NULL, PRIMARY KEY(file_id,seq));
`;
export const BINARY_MIGRATION = { name: '431_binary_objects', sql: schema('BLOB'), pg: schema('BYTEA') };
