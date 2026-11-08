export const SOFTWARE_MIGRATION = {
  name:'441_software_delivery',
  sql:`
CREATE TABLE software_package (package_id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, feature_version TEXT NOT NULL, sw_id TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL, file_id TEXT NOT NULL REFERENCES binary_object(file_id), doc TEXT NOT NULL);
CREATE INDEX software_package_feature ON software_package(feature_id,feature_version,status);
CREATE TABLE software_download (download_id TEXT PRIMARY KEY, package_id TEXT NOT NULL REFERENCES software_package(package_id), vin TEXT NOT NULL, actor_id TEXT NOT NULL, at TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX software_download_package ON software_download(package_id,at);
CREATE TRIGGER software_download_no_update BEFORE UPDATE ON software_download BEGIN SELECT RAISE(ABORT, 'software_download is append only'); END;
CREATE TRIGGER software_download_no_delete BEFORE DELETE ON software_download BEGIN SELECT RAISE(ABORT, 'software_download is append only'); END;
`,
};
