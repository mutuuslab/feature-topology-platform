import { readdirSync,readFileSync,writeFileSync } from 'node:fs';
import { join,relative } from 'node:path';
import ts from 'typescript';
import { expect,it } from 'vitest';
import { ROUTES } from '@ff/contracts';
import { WORKFLOW_EXECUTION_MODEL } from '../../../contracts/src/generated/workflow-execution-model';
import { simReady,simHandled } from '../api/sim';

it('inventories exposed screen mutations and workflow actions against actual offline handlers',async()=>{
 await simReady();const root=join(__dirname,'../screens'),references=new Map<string,string[]>();
 const add=(name:string,file:string)=>references.set(name,[...new Set([...(references.get(name)??[]),file])]);
 const walk=(dir:string)=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const p=join(dir,entry.name);if(entry.isDirectory())walk(p);else if(/\.tsx?$/.test(p)){const sf=ts.createSourceFile(p,readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);const visit=(n:ts.Node)=>{if(ts.isCallExpression(n)&&n.expression.getText(sf)==='useApiMutation'&&n.arguments[0]&&ts.isStringLiteralLike(n.arguments[0]))add(n.arguments[0].text,relative(root,p));ts.forEachChild(n,visit);};visit(sf);}}};walk(root);
 const visit=(value:unknown):void=>{if(!value||typeof value!=='object')return;const row=value as Record<string,unknown>;if(Array.isArray(row.actions))for(const name of row.actions)if(typeof name==='string')add(name,'WORKFLOW:'+(row.id??'unknown'));Object.values(row).forEach(v=>{if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);});};visit(WORKFLOW_EXECUTION_MODEL);
 const mutations=ROUTES.filter(r=>r.method!=='GET'),missing=mutations.filter(r=>references.has(r.name)&&!simHandled(r.name)).map(r=>({name:r.name,method:r.method,path:r.path,references:references.get(r.name)}));
 if(process.env.FF_OFFLINE_MUTATION_REPORT)writeFileSync(process.env.FF_OFFLINE_MUTATION_REPORT,JSON.stringify({totalMutations:mutations.length,referenced:references.size,missing},null,2));
 expect(missing).toEqual([]);
});
