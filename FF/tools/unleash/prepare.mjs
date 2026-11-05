// Download immutable official OSS assets. No changes are made to upstream source or distribution files.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { copyPostgres } from './postgres-assets.mjs';
import { windowsTar } from './archive.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const pins = JSON.parse(readFileSync(join(here, 'pins.json'), 'utf8'));
const root = resolve(here, '../..');
function run(exe, args, cwd) {
  const npmCli = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const r = spawnSync(exe === 'npm.cmd' ? process.execPath : exe, exe === 'npm.cmd' ? [npmCli, ...args] : args, { cwd, windowsHide: true, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`Asset preparation failed: ${exe} (${r.status})`);
}
export async function prepareAssets(destination = join(root, '.unleash-runtime/assets'), pgBin = process.env.FF_PG_BIN) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Native desktop assets currently require Windows x64; use docker/unleash for Linux customers.');
  mkdirSync(destination, { recursive: true });
  const server = join(destination, 'server');
  mkdirSync(server, { recursive: true });
  cpSync(join(here, 'server-package.json'), join(server, 'package.json'));
  cpSync(join(here, 'server-package-lock.json'), join(server, 'package-lock.json'));
  run('npm.cmd', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], server);
  const installed = JSON.parse(readFileSync(join(server, 'node_modules/unleash-server/package.json'), 'utf8'));
  if (installed.version !== pins.server.version) throw new Error('Unleash version mismatch');
  const response = await fetch(pins.edge.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Official Edge download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== pins.edge.sha256) throw new Error('Official Edge SHA256 mismatch');
  const archive = join(destination, 'edge.zip'); writeFileSync(archive, bytes);
  const edge = join(destination, 'edge'); mkdirSync(edge, { recursive: true });
  // PowerShell receives literal arguments via environment, never interpolated shell commands.
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:FF_EDGE_ARCHIVE -DestinationPath $env:FF_EDGE_DEST -Force'], { windowsHide: true, env: { ...process.env, FF_EDGE_ARCHIVE: archive, FF_EDGE_DEST: edge }, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Edge extraction failed');
  pgBin ??= 'C:/Program Files/PostgreSQL/18/bin';
  const version = spawnSync(join(pgBin, 'pg_ctl.exe'), ['--version'], { windowsHide: true, encoding: 'utf8' });
  if (version.status !== 0 || !version.stdout.includes(` ${pins.postgres.version}`)) throw new Error(`PostgreSQL ${pins.postgres.version} binaries required; set FF_PG_BIN.`);
  const pgRoot = resolve(pgBin, '..');
  const pgFiles = copyPostgres(pgRoot, join(destination, 'postgres'));
  const notices = join(destination, 'notices'); mkdirSync(notices, { recursive: true });
  const license = resolve(root, '../vendor/unleash/LICENSE');
  if (!existsSync(license)) throw new Error('Pinned Unleash source submodule is required (git submodule update --init).');
  cpSync(license, join(notices, 'UNLEASH-AGPL-3.0.txt'));
  cpSync(join(edge, 'LICENSE'), join(notices, 'EDGE-MIT.txt'));
  cpSync(join(edge, 'LICENSE-ENTERPRISE.md'), join(notices, 'EDGE-ENTERPRISE-NOTICE.md'));
  const pgLicense = await fetch('https://raw.githubusercontent.com/postgres/postgres/REL_18_3/COPYRIGHT');
  if (!pgLicense.ok) throw new Error('PostgreSQL license download failed');
  writeFileSync(join(notices, 'POSTGRESQL.txt'), await pgLicense.text());
  writeFileSync(join(notices, 'SOURCES.json'), JSON.stringify(pins, null, 2));
  writeFileSync(join(notices, 'POSTGRESQL-BINARIES.json'), JSON.stringify(pgFiles, null, 2));
  writeFileSync(join(destination, 'pins.json'), JSON.stringify(pins, null, 2));
  console.log('Official Unleash 8.3.1, OSS Edge 20.6.0, PostgreSQL 18.3 assets prepared.');
  return destination;
}

/** NSIS paths remain short while every official server file remains unchanged in the archive. */
export function archiveAssets(source, destination) {
  const result = spawnSync(windowsTar(), ['-czf', destination, '-C', source, '.'], { windowsHide: true, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Sidecar archive failed');
  writeFileSync(`${destination}.sha256`, createHash('sha256').update(readFileSync(destination)).digest('hex'));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareAssets(process.argv[2]);
