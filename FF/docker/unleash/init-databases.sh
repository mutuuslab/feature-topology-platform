#!/bin/sh
set -eu
# Secrets enter psql on stdin, never in command arguments. The generator uses exactly 64 hex characters.
case "$FF_DB_PASSWORD" in *[!a-fA-F0-9]*|'') echo 'Generate FF_DB_PASSWORD as a hex secret' >&2; exit 1;; esac
case "$UNLEASH_DB_PASSWORD" in *[!a-fA-F0-9]*|'') echo 'Generate UNLEASH_DB_PASSWORD as a hex secret' >&2; exit 1;; esac
[ "${#FF_DB_PASSWORD}" -eq 64 ] && [ "${#UNLEASH_DB_PASSWORD}" -eq 64 ]
psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 <<SQL
CREATE ROLE ff_app LOGIN PASSWORD '$FF_DB_PASSWORD';
CREATE ROLE unleash_app LOGIN PASSWORD '$UNLEASH_DB_PASSWORD';
CREATE DATABASE feature_platform OWNER ff_app TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C';
CREATE DATABASE unleash OWNER unleash_app TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C';
REVOKE CONNECT ON DATABASE feature_platform FROM PUBLIC;
REVOKE CONNECT ON DATABASE unleash FROM PUBLIC;
GRANT CONNECT ON DATABASE feature_platform TO ff_app;
GRANT CONNECT ON DATABASE unleash TO unleash_app;
SQL
