// Preserve core PostgreSQL binaries byte-for-byte; exclude optional local PostGIS/GUI installations.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function peImports(buffer) {
  const pe = buffer.readUInt32LE(0x3c), optional = pe + 24;
  if (buffer.toString('ascii', pe, pe + 4) !== 'PE\0\0') throw new Error('Invalid PE image');
  const count = buffer.readUInt16LE(pe + 6), size = buffer.readUInt16LE(pe + 20);
  const directory = optional + (buffer.readUInt16LE(optional) === 0x20b ? 112 : 96);
  const sections = [];
  for (let i = 0; i < count; i++) { const at = optional + size + i * 40; sections.push({ va: buffer.readUInt32LE(at + 12), size: Math.max(buffer.readUInt32LE(at + 8), buffer.readUInt32LE(at + 16)), raw: buffer.readUInt32LE(at + 20) }); }
  const offset = (rva) => { const s = sections.find((s) => rva >= s.va && rva < s.va + s.size); if (!s) throw new Error('Invalid PE import RVA'); return s.raw + rva - s.va; };
  const rva = buffer.readUInt32LE(directory + 8); if (!rva) return [];
  const names = [];
  for (let at = offset(rva); buffer.readUInt32LE(at + 12); at += 20) { const start = offset(buffer.readUInt32LE(at + 12)); names.push(buffer.toString('ascii', start, buffer.indexOf(0, start))); }
  return names;
}
export function copyPostgres(pgRoot, destination) {
  const candidates = new Map();
  for (const part of ['bin', 'lib']) for (const name of readdirSync(join(pgRoot, part))) if (/\.(dll|exe)$/i.test(name)) candidates.set(name.toLowerCase(), { part, name });
  const pending = ['postgres.exe', 'initdb.exe', 'pg_ctl.exe', 'pg_isready.exe', 'psql.exe', 'pg_dump.exe', 'pg_dumpall.exe', 'pg_restore.exe', 'plpgsql.dll'];
  // initdb installs C-language text search and encoding conversions through dynamic $libdir loads,
  // which do not appear in the PE import table. Preserve these mandatory core modules too.
  pending.push(...[...candidates.keys()].filter((name) => /^(dict_snowball|.*_and_.*|llvmjit)\.dll$/i.test(name)));
  const copied = new Set();
  while (pending.length) {
    const key = pending.pop().toLowerCase(); if (copied.has(key)) continue;
    const file = candidates.get(key); if (!file) continue; // OS-provided system DLLs are not redistributed.
    copied.add(key);
    const source = join(pgRoot, file.part, file.name), target = join(destination, file.part);
    mkdirSync(target, { recursive: true }); cpSync(source, join(target, file.name));
    pending.push(...peImports(readFileSync(source)));
  }
  for (const name of ['postgres.exe', 'initdb.exe', 'pg_ctl.exe', 'plpgsql.dll', 'dict_snowball.dll']) if (!copied.has(name)) throw new Error(`Required PostgreSQL binary missing: ${name}`);
  // Core catalogs, text search and timezone data. Only plpgsql is installed as a default extension.
  const share = join(pgRoot, 'share');
  cpSync(share, join(destination, 'share'), { recursive: true, filter: (source) => !['contrib', 'extension', 'doc', 'man', 'locale'].some((name) => source === join(share, name)) });
  for (const name of readdirSync(join(share, 'extension')).filter((name) => name.startsWith('plpgsql'))) { mkdirSync(join(destination, 'share/extension'), { recursive: true }); cpSync(join(share, 'extension', name), join(destination, 'share/extension', name)); }
  return [...copied].sort();
}
