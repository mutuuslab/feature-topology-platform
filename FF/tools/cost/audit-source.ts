// Read-only workbook/basis comparison. Never recalculates, exports or changes the source xlsx.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {FF} from '../lib.ts';
import {importCostBasis} from './import-basis.ts';
const require=createRequire(import.meta.url);
const {canonicalCostSource}=require(join(FF,'contracts','dist','index.js')) as typeof import('../../contracts/src/index');
const arg=(name:string)=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1];};
const source=arg('--source');if(!source)throw new Error('--source <original workbook> is required');
const bytes=readFileSync(source);const registered=readFileSync(join(FF,'data','source','feature_db_v1.3.xlsx'));
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const imported=importCostBasis(bytes);const stored=JSON.parse(readFileSync(join(FF,'data','reference','cost-basis','v1.3.json'),'utf8'));
const differences:string[]=[];
function compare(a:unknown,b:unknown,path:string){if(canonicalCostSource(a)===canonicalCostSource(b))return;if(a && b && typeof a==='object' && typeof b==='object' && !Array.isArray(a) && !Array.isArray(b)){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))compare((a as any)[key],(b as any)[key],path?`${path}.${key}`:key);}else differences.push(path);}
compare(imported,stored,'');
const report={source,sourceSha256:digest(bytes),registeredSha256:digest(registered),sameWorkbook:digest(bytes)===digest(registered),basisSourceSha256:stored.source.sha256,basisDifferences:differences,sections:Object.keys(imported),sourceUnchanged:digest(readFileSync(source))===digest(bytes)};
if(arg('--out'))writeFileSync(arg('--out')!,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(!report.sameWorkbook || differences.length || !report.sourceUnchanged)process.exitCode=1;
