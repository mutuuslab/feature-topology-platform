// Derive only new cost API files from the authorized workbook/reference source.
// Immutable captured API files are read, never edited, copied or replaced.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url),FF=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const {canonicalCostSource,costReferenceMissing,costFeatureSourceOf,compareRelease,refStatusPolicy,snapshotFile,routeUrl}=require(join(FF,'contracts/dist/index.js'));
const digest=b=>createHash('sha256').update(b).digest('hex'),json=f=>JSON.parse(readFileSync(f,'utf8'));
export function deriveCostReferenceArchive({snapshotDir,outDir,manifestPath}={}){
 if(!snapshotDir||!outDir||!manifestPath)throw Error('snapshotDir, outDir and manifestPath are required');
 const input=resolve(snapshotDir),output=resolve(outDir);if(existsSync(output))throw Error('Use a new supplemental directory');
 const data=join(FF,'data/reference/feature-db/v1.3'),basisFile=join(FF,'data/reference/cost-basis/v1.3.json'),workbook=join(FF,'data/source/feature_db_v1.3.xlsx');
 const rows=json(join(data,'refs.json')),sources=json(join(data,'sources.json')),sourceManifest=json(join(data,'manifest.json')),basis=json(basisFile),workbookSha256=digest(readFileSync(workbook));
 if(sourceManifest.source.sha256!==workbookSha256||basis.source.sha256!==workbookSha256)throw Error('Workbook/reference/basis provenance differs');
 const raw=(name,params={})=>{const f=join(input,snapshotFile(routeUrl(name,params)));return existsSync(f)?{value:json(f),file:f,sha256:digest(readFileSync(f))}:null;};
 const releases=raw('refReleases')?.value?.items;if(!releases?.length)throw Error('Captured publication versions are required');
 const release=[...releases].sort((a,b)=>compareRelease(a.release,b.release)).at(-1).release;
 const files=[],consumed=new Map();mkdirSync(output,{recursive:true});
 const sorted=[...rows].sort((a,b)=>a.refId.localeCompare(b.refId));
 for(const [ord,original]of sorted.entries()){
  const captured=raw('refDetail',{refId:original.refId});if(!captured?.value.ref)throw Error('Captured reference missing '+original.refId);
  consumed.set(captured.file,captured.sha256);const ref={...original,...captured.value.ref};
  const relatedReferences=original.duplicateOf?[rows.find(r=>r.refId===original.duplicateOf)].filter(Boolean):[];
  const features=[];for(const u of captured.value.usedBy??[]){const f=raw('featureDetail',{id:u.featureId,ver:u.version});if(f?.value?.feature){const row=f.value.feature;consumed.set(f.file,f.sha256);features.push({featureId:row.featureId,version:row.version,name:row.name,asil:row.asil,lifecycle:row.lifecycle,sha256:digest(canonicalCostSource(costFeatureSourceOf(row)))});}}
  const missing=costReferenceMissing(ref,basis),referenceSha256=digest(canonicalCostSource(ref));
  const body={ref,ord,relatedReferences,basisVersion:basis.version,refRelease:release,referenceSha256,usable:refStatusPolicy(ref.status).costUsable&&!missing.length,missing,sources:sources.filter(s=>ref.sourceIds.includes(s.sourceId)),features,provenance:{kind:'WORKBOOK_DERIVED_REFERENCE',workbookSha256,sourceReferenceRelease:'v1.3',capturedPublicRelease:release,capturedPublicReferenceSha256:captured.sha256,boundary:'REFERENCE_ONLY_NOT_SUPPLIER_QUOTE_OR_CONTRACT'}};
  const relative=snapshotFile(routeUrl('costReference',{refId:ref.refId})).replace(/^api-snapshot\//,'');if(existsSync(join(input,'api-snapshot',relative)))throw Error('Supplement collides with original '+relative);
  const text=JSON.stringify(body)+'\n';writeFileSync(join(output,relative),text);files.push({path:relative,bytes:Buffer.byteLength(text),sha256:digest(text),referenceSha256});
 }
 const shaOf=f=>digest(readFileSync(f)),sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:FF,encoding:'utf8'}).trim();
 const treeSha256=digest([...files].sort((a,b)=>a.path.localeCompare(b.path)).map(f=>f.path+'\0'+f.sha256+'\n').join(''));
 for(const [file,sha]of consumed)if(digest(readFileSync(file))!==sha)throw Error('Original capture changed during derivation');
 if(digest(readFileSync(workbook))!==workbookSha256)throw Error('Workbook changed during derivation');
 const sourceDirty=!!execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:FF,encoding:'utf8'}).trim();
 const manifest={schema:'ff.cost.offline.references/1',sourceCommit,sourceDirty,sourceWorkbookSha256:workbookSha256,sourceReferenceRelease:'v1.3',capturedPublicRelease:release,sourceReferenceFileSha256:shaOf(join(data,'refs.json')),sourceBasisFileSha256:shaOf(basisFile),sourcePublicReferenceInputs:consumed.size,sourcePublicInputTreeSha256:digest([...consumed].sort(([a],[b])=>a.localeCompare(b)).map(([f,h])=>relative(input,f).split(sep).join('/')+'\0'+h+'\n').join('')),supplementalTreeSha256:treeSha256,files:files.length,records:files,containsSupplierQuotes:false,containsParticipantOriginalFiles:false,originalCaptureFilesChanged:0,boundary:'WORKBOOK_REFERENCE_ONLY; SYNTHETIC_REVIEW_INPUTS_CREATED_EXPLICITLY_IN_BROWSER'};
 mkdirSync(dirname(resolve(manifestPath)),{recursive:true});writeFileSync(resolve(manifestPath),JSON.stringify(manifest,null,2)+'\n');
 return {outDir:output,manifestPath:resolve(manifestPath),files:files.length,sourceWorkbookSha256:workbookSha256,supplementalTreeSha256:treeSha256,sourceCommit};
}
if(process.argv[1]&&resolve(process.argv[1]).toLowerCase()===fileURLToPath(import.meta.url).toLowerCase()){const args=process.argv.slice(2),names={'--snapshot':'snapshotDir','--out':'outDir','--manifest':'manifestPath'},opts={};for(let i=0;i<args.length;i+=2){if(!names[args[i]]||!args[i+1])throw Error('Usage: --snapshot <public> --out <new-api-json-dir> --manifest <json>');opts[names[args[i]]]=args[i+1];}console.log(JSON.stringify(deriveCostReferenceArchive(opts),null,2));}
