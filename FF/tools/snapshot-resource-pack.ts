import { createHash } from 'node:crypto';
import { existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,renameSync,unlinkSync,writeFileSync } from 'node:fs';
import { isAbsolute,join,relative,resolve } from 'node:path';
import { RESOURCE_DIR,RESOURCE_INDEX,RESOURCE_VERSION,PAGES_MAX_FILE_BYTES,resourcePacketFile,resourceRequest,type ResourceIndex,type ResourcePacket } from './snapshot-resource-format.ts';
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const fail=(s:string):never=>{throw new Error(`snapshot-resource-pack: ${s}`);};
function within(root:string,file:string) {
  const full=resolve(root,file),rel=relative(resolve(root),full);
  if(!rel||rel.startsWith('..')||isAbsolute(rel))fail('path leaves artifact');
  if(existsSync(full)){const actual=relative(realpathSync(root),realpathSync(full));if(!actual||actual.startsWith('..')||isAbsolute(actual)||lstatSync(full).isSymbolicLink())fail('invalid resource path');}
  return full;
}
const bytes=(dir:string,file:string)=>{const p=within(dir,file);if(!lstatSync(p).isFile())fail('not a regular file');return readFileSync(p);};
const json=(dir:string,file:string)=>JSON.parse(bytes(dir,file).toString('utf8'));
function canonical(dir:string) {
  const vins=new Set<string>((json(dir,'vehicles.json').items??[]).map((v:any)=>v.vin));
  const path='features_latestOnly_false.json';
  const features=new Map<string,Set<string>>();
  if(existsSync(join(dir,path)))for(const f of json(dir,path).items??[]){const versions=features.get(f.featureId)??new Set<string>();versions.add(f.version);features.set(f.featureId,versions);}
  return {vins,features};
}
function validSource(target:NonNullable<ReturnType<typeof resourceRequest>>,source:ReturnType<typeof canonical>) {
  return target.kind==='VEHICLE'?source.vins.has(target.id):source.features.has(target.id)&&(!target.version||source.features.get(target.id)!.has(target.version));
}
function expectedFiles(kind:ResourcePacket['kind'],id:string,source:ReturnType<typeof canonical>) {
  if(kind==='VEHICLE')return ['runtime','requests','status','feature-state','verdicts','customer-state','openfeature','installs'].map(s=>`vehicles_${id}_${s}.json`).sort();
  const files=['','_baselines','_evaluations','_history','_ops-metrics','_reviews','_trace-links'].map(s=>`features_${id}${s}.json`);
  for(const version of source.features.get(id)??[]){
    files.push(`features_${id}_reviews_version_${version}.json`);
    for(const suffix of ['','_analysis','_baseline-checklist','_classification','_flag-code-gate','_gate-na-requests','_gates','_release-candidate','_release-signoff','_safety','_support-drills','_variability'])files.push(`features_${id}_versions_${version}${suffix}.json`);
  }
  return files.sort();
}
export function resourceLogicalFiles(dir:string,allowOriginals=false):string[] {
  if(!existsSync(join(dir,RESOURCE_INDEX)))return [];
  const index=json(dir,RESOURCE_INDEX) as ResourceIndex,source=canonical(dir),logical:string[]=[],ids=new Set<string>();
  if(index.version!==RESOURCE_VERSION||!Array.isArray(index.packets))fail('invalid resource index');
  for(const info of index.packets){
    const key=`${info.kind}:${info.id}`;
    if(ids.has(key)||info.file!==resourcePacketFile(hash(key))||!Array.isArray(info.files)||!info.files.length)fail('invalid or duplicate resource path');
    ids.add(key);
    if(JSON.stringify([...info.files].sort())!==JSON.stringify(expectedFiles(info.kind,info.id,source)))fail('resource canonical query coverage');
    const raw=bytes(dir,info.file);
    if(raw.length>PAGES_MAX_FILE_BYTES||raw.length!==info.bytes||hash(raw)!==info.sha256)fail('resource packet integrity');
    const packet=JSON.parse(raw.toString('utf8')) as ResourcePacket;
    if(packet.version!==RESOURCE_VERSION||packet.kind!==info.kind||packet.id!==info.id||!packet.responses||Array.isArray(packet.responses)||JSON.stringify(Object.keys(packet.responses).sort())!==JSON.stringify([...info.files].sort()))fail('resource packet entries');
    for(const file of info.files){
      const target=resourceRequest(file),entry=packet.responses[file];
      if(!target||target.kind!==info.kind||target.id!==info.id||!validSource(target,source))fail('unknown resource family or canonical target');
      if(!entry||typeof entry.body!=='string'||Buffer.byteLength(entry.body)!==entry.bytes||hash(entry.body)!==entry.sha256)fail('resource response integrity');
      JSON.parse(entry.body);
      if(!allowOriginals&&existsSync(within(dir,file)))fail('unremoved resource original');
      logical.push(file);
    }
  }
  if(ids.size!==source.vins.size+source.features.size||[...source.vins].some(id=>!ids.has(`VEHICLE:${id}`))||[...source.features.keys()].some(id=>!ids.has(`FEATURE:${id}`)))fail('resource canonical ID coverage');
  if(logical.length!==index.logicalFiles||new Set(logical).size!==logical.length)fail('resource count or filename collision');
  return logical;
}
export function packResources(dir:string) {
  if(existsSync(join(dir,RESOURCE_INDEX)))return {logical:resourceLogicalFiles(dir).length,idempotent:true};
  const source=canonical(dir),groups=new Map<string,{kind:ResourcePacket['kind'];id:string;files:string[]}>();
  for(const file of readdirSync(dir)){
    const target=resourceRequest(file);if(!target)continue;
    if(!validSource(target,source))fail(`unknown canonical source: ${file}`);
    const key=`${target.kind}:${target.id}`,group=groups.get(key)??{kind:target.kind,id:target.id,files:[]};group.files.push(file);groups.set(key,group);
  }
  if(!groups.size)return {logical:0,idempotent:true};
  if(groups.size!==source.vins.size+source.features.size)fail('missing canonical resource group');
  for(const group of groups.values())if(JSON.stringify([...group.files].sort())!==JSON.stringify(expectedFiles(group.kind,group.id,source)))fail('missing canonical resource query');
  const index:ResourceIndex={version:RESOURCE_VERSION,logicalFiles:0,packets:[]};
  const originals:{file:string;sha256:string}[]=[],packets:{file:string;body:string}[]=[];
  for(const [key,group] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
    const packet:ResourcePacket={version:RESOURCE_VERSION,kind:group.kind,id:group.id,responses:Object.create(null)};
    for(const file of group.files.sort()){
      const raw=bytes(dir,file),body=raw.toString('utf8');if(!Buffer.from(body).equals(raw))fail('invalid UTF-8');JSON.parse(body);
      packet.responses[file]={body,bytes:raw.length,sha256:hash(raw)};originals.push({file,sha256:hash(raw)});
    }
    const file=resourcePacketFile(hash(key)),body=JSON.stringify(packet),length=Buffer.byteLength(body);
    if(length>PAGES_MAX_FILE_BYTES)fail('resource packet exceeds 25MiB');
    packets.push({file,body});index.packets.push({kind:group.kind,id:group.id,file,bytes:length,sha256:hash(body),files:group.files});
  }
  const packetDir=within(dir,RESOURCE_DIR);if(existsSync(packetDir)&&!lstatSync(packetDir).isDirectory())fail('invalid packet directory');mkdirSync(packetDir,{recursive:true});
  for(const p of packets){const path=within(dir,p.file);if(existsSync(path)&&readFileSync(path,'utf8')!==p.body)fail('unrelated resource packet');writeFileSync(path,p.body);}
  index.logicalFiles=originals.length;
  const temp=within(dir,RESOURCE_INDEX+'.tmp');if(existsSync(temp))fail('unfinished index');writeFileSync(temp,JSON.stringify(index));renameSync(temp,within(dir,RESOURCE_INDEX));
  resourceLogicalFiles(dir,true);
  for(const original of originals)if(hash(bytes(dir,original.file))!==original.sha256)fail('original changed before removal');
  for(const original of originals)unlinkSync(within(dir,original.file));
  return {logical:resourceLogicalFiles(dir).length,idempotent:false};
}
