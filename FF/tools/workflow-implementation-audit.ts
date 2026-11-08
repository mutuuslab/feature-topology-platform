// Source inventory, not a completion score. A declared route or generic acceptance cannot prove a native domain action.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';
import { ROUTES } from '@ff/contracts';
import { FF } from './lib.ts';

function files(root:string):string[]{return readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(root,e.name)):/\.tsx?$/.test(e.name)?[join(root,e.name)]:[]);}
const pathOf=(file:string)=>relative(join(FF,'..'),file).replaceAll('\\','/');
function literal(node:ts.Node|undefined):string|undefined{return node&&ts.isStringLiteralLike(node)?node.text:undefined;}
function decorators(node:ts.Node){return ts.canHaveDecorators(node)?ts.getDecorators(node)??[]:[];}
function callOf(decorator:ts.Decorator){return ts.isCallExpression(decorator.expression)?decorator.expression:undefined;}
function endpoints(){
 const map=new Map<string,{file:string;line:number;handler:string;methodSource:string}[]>();
 for(const file of files(join(FF,'backend','src'))){
  const text=readFileSync(file,'utf8'),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
  for(const cls of source.statements.filter(ts.isClassDeclaration)){
   const controller=decorators(cls).map(callOf).find(c=>c?.expression.getText(source)==='Controller');
   if(!controller)continue;const prefix=literal(controller.arguments[0]);if(prefix===undefined)continue;
   for(const method of cls.members.filter(ts.isMethodDeclaration))for(const decorator of decorators(method)){
    const call=callOf(decorator);if(!call)continue;const verb=call.expression.getText(source).toUpperCase();
    if(!['GET','POST','PUT','PATCH','DELETE'].includes(verb))continue;
    const tail=call.arguments.length?literal(call.arguments[0]):'';if(tail===undefined)continue;
    const path='/'+[prefix,tail].filter(Boolean).join('/').replace(/^\/+|\/+$/g,'');
    const key=`${verb} ${path}`,entry={file:pathOf(file),line:source.getLineAndCharacterOfPosition(method.getStart(source)).line+1,handler:method.name.getText(source),methodSource:method.getText(source)};
    map.set(key,[...(map.get(key)??[]),entry]);
   }
  }
 }
 return map;
}

export function auditWorkflowImplementation(){
 const doc=JSON.parse(readFileSync(join(FF,'..','docs','65-workflows','out','workflows.json'),'utf8'));
 const source=endpoints(),frontend=files(join(FF,'frontend','src')).filter(f=>!f.includes('__tests__')).map(file=>({file:pathOf(file),text:readFileSync(file,'utf8')}));
 const testFiles=files(join(FF,'backend','test')).concat(files(join(FF,'frontend','src','__tests__'))).map(file=>({file:pathOf(file),text:readFileSync(file,'utf8')}));
 const activities=doc.processes.flatMap((p:any)=>p.activities.map((a:any)=>({
  id:a.id,processId:p.id,name:a.name,raci:a.raci,inputs:a.inputs,outputs:a.outputs,next:a.next,
  implementationStatus:'NATIVE_ACCEPTANCE_REVIEW_REQUIRED',
  sourceModel:`docs/65-workflows/model/processes/${p.id}.yaml`,
  screens:a.platform.screens,
  routes:a.platform.actions.map((name:string)=>{
   const route=ROUTES.find(r=>r.name===name);
   if(!route)return {name,status:'DECLARATION_MISSING'};
   const native=source.get(`${route.method} ${route.path}`)??[];
   const textRefs=(text:string)=>text.includes(`'${name}'`)||text.includes(`"${name}"`);
   return {name,method:route.method,path:route.path,roles:route.roles??[],bodySchema:!!route.body,controllerSources:native.map(({methodSource:_s,...r})=>r),frontendSources:frontend.filter(f=>textRefs(f.text)).map(f=>f.file),testCandidates:testFiles.filter(f=>textRefs(f.text)||f.text.includes(a.id)).map(f=>f.file),status:native.length?'CONTROLLER_FOUND_NOT_SEMANTICALLY_ACCEPTED':'CONTROLLER_SOURCE_REVIEW_REQUIRED'};
  }),
  remaining:['native business result and canonical entity binding','activity-specific guard and required WP acceptance','team and stakeholder harness review'],
 })));
 const products=new Map<string,any>();
 for(const p of doc.processes)for(const wp of p.workProducts){
  const entry=products.get(wp.key)??{key:wp.key,name:wp.name,content:wp.content,producers:[],consumers:[],status:'CANONICAL_OUTPUT_ACCEPTANCE_REVIEW_REQUIRED'};
  entry.producers=[...new Set([...entry.producers,...activities.filter((a:any)=>a.outputs.includes(wp.key)).map((a:any)=>a.id)])];
  entry.consumers=[...new Set([...entry.consumers,...activities.filter((a:any)=>a.inputs.includes(wp.key)).map((a:any)=>a.id)])];
  products.set(wp.key,entry);
 }
 return {schema:1,scope:'Source inventory only; route existence and generic workflow review do not imply native business completion.',counts:{processes:doc.processes.length,activities:activities.length,products:products.size,departments:doc.departments.length},genericExecution:{source:'FF/backend/src/workflows/workflow-execution.service.ts',ui:'/procedures/work',tests:['FF/backend/test/d04/workflow-execution.spec.ts','FF/frontend/src/__tests__/workflowExecution.test.tsx'],limitations:['96KiB serialized request limit including fields and base64 attachments; three files maximum; no large-file upload implementation','source observations verify stored JSON bytes, not external file integrity or native approval','ALM/P13 resolver requires their own source migrations and integration tests']},activities,products:[...products.values()]};
}
if(process.argv[1]?.endsWith('workflow-implementation-audit.ts')){
 const output=join(FF,'..','docs','65-workflows','out','implementation-coverage.json');
 mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(auditWorkflowImplementation(),null,2)+'\n');
 console.log(`workflow implementation inventory → ${output}`);
}
