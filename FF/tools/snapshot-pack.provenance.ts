import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function artifactFingerprint(root: string) {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => { if (d.isSymbolicLink()) throw new Error('artifact contains a symlink'); return d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]; });
  const files = walk(root).sort((a, b) => { const x = relative(root, a).replaceAll('\\', '/'), y = relative(root, b).replaceAll('\\', '/'); return x < y ? -1 : x > y ? 1 : 0; });
  const tree = createHash('sha256'); let bytes = 0;
  for (const file of files) { const data = readFileSync(file); bytes += data.length; tree.update(relative(root, file).replaceAll('\\', '/') + '\0' + createHash('sha256').update(data).digest('hex') + '\n'); }
  return { files: files.length, bytes, sha256: tree.digest('hex') };
}
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  if (!process.argv[2]) throw new Error('usage: node tools/snapshot-pack.provenance.ts <artifact> [exact-copy]');
  const source = artifactFingerprint(resolve(process.argv[2]));
  if (!process.argv[3]) console.log(JSON.stringify(source));
  else { const copy = artifactFingerprint(resolve(process.argv[3])); if (JSON.stringify(source) !== JSON.stringify(copy)) throw new Error('source and copied artifact differ'); console.log(JSON.stringify({ source, copy, identical: true })); }
}
