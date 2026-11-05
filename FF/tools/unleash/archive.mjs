// Expand the unchanged official archive with disjoint writers. Decompress once;
// each tar process owns whole packages, including scoped packages and licenses.
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

export function extractionGroups(entries, workers = 4) {
  const weights = new Map();
  for (const entry of entries) {
    const name = entry.replace(/^\.\//, '').replace(/\/$/, '');
    if (!name || name === '.') continue;
    if (name.startsWith('/') || name.includes('\\') || name.includes(':') || name.split('/').some((part) => part === '..' || part === '.')) throw new Error('Unsafe sidecar archive path');
    // Parent directories are made once; no writer recursively extracts a parent
    // also owned by another writer. A scope stays together to avoid shared dirs.
    if (name === 'server' || name === 'server/node_modules') continue;
    const parts = name.split('/');
    const depth = name.startsWith('server/node_modules/') ? 3 : name.startsWith('server/') ? 2 : 1;
    const canonical = parts.slice(0, depth).join('/');
    const root = entry.startsWith('./') ? `./${canonical}` : canonical;
    weights.set(root, (weights.get(root) ?? 0) + 1);
  }
  const groups = Array.from({ length: workers }, () => ({ weight: 0, roots: [] }));
  for (const [root, weight] of [...weights].sort((a, b) => b[1] - a[1])) {
    groups.sort((a, b) => a.weight - b.weight);
    groups[0].weight += weight;
    groups[0].roots.push(root);
  }
  return groups.filter((group) => group.roots.length).map((group) => group.roots);
}

export async function extractSidecarArchive(archive, destination) {
  mkdirSync(destination, { recursive: true });
  const temporaryTar = join(dirname(destination), `.sidecars-${randomUUID()}.tar`);
  const children = [];
  try {
    await pipeline(createReadStream(archive), createGunzip(), createWriteStream(temporaryTar, { flags: 'wx' }));
    const listed = spawnSync('tar.exe', ['-tf', temporaryTar], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    if (listed.status !== 0) throw new Error('Packaged sidecar archive listing failed');
    const groups = extractionGroups(listed.stdout.split(/\r?\n/).filter(Boolean));
    if (!groups.length) throw new Error('Packaged sidecar archive is empty');
    mkdirSync(join(destination, 'server/node_modules'), { recursive: true });
    const results = await Promise.allSettled(groups.map((roots) => new Promise((accept, reject) => {
      const child = spawn('tar.exe', ['-xf', temporaryTar, '-C', destination, ...roots], { windowsHide: true, stdio: 'ignore' });
      children.push(child);
      child.once('error', reject);
      child.once('exit', (code) => code === 0 ? accept() : reject(new Error('Packaged sidecar extraction failed')));
    })));
    if (results.some((result) => result.status === 'rejected')) throw new Error('Packaged sidecar extraction failed');
  } finally {
    // Exact generated temporary file only; customer data and the source archive
    // are retained, including incomplete destination files for a later retry.
    for (const child of children) if (child.exitCode === null && !child.killed) child.kill();
    try { unlinkSync(temporaryTar); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
