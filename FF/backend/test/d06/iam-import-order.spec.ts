// Fresh CJS processes expose initialization-order bugs hidden by a warm module cache.
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {HUMAN_ROLES,KILL_APPROVER_ROLES,REPORT_APPROVER_ROLES} from '@ff/contracts';

const dist=join(__dirname,'..','..','..','contracts','dist');
const probe=String.raw`
const path=require('node:path');
const [dist,first]=process.argv.slice(1);
require(path.join(dist,first));
const {ROUTES}=require(path.join(dist,'routes.js'));
const access=require(path.join(dist,'rules','access.js'));
const catalogue=require(path.join(dist,'rules','role-catalogue.js'));
const names=['readNotification','submitWorkflowActivity','completeProcedureActivity','createWorkflowCase','approveKill','rejectKill','approveRestore','rejectRestore'];
process.stdout.write(JSON.stringify({human:access.HUMAN_ROLES,report:access.REPORT_APPROVER_ROLES,kill:access.KILL_APPROVER_ROLES,sameExports:access.HUMAN_ROLES===catalogue.HUMAN_ROLES && access.KILL_APPROVER_ROLES===catalogue.KILL_APPROVER_ROLES && access.REPORT_APPROVER_ROLES===catalogue.REPORT_APPROVER_ROLES,roles:Object.fromEntries(names.map(name=>[name,ROUTES.find(route=>route.name===name)?.roles ?? null])),view:access.rolesView()}));
`;
const read=(first:string)=>JSON.parse(execFileSync(process.execPath,['-e',probe,dist,first],{encoding:'utf8'}));
describe('IAM initialization order is deterministic in built CommonJS',()=>{
 it('access-first and routes-first preserve identical role values, common route roles and IAM permissions',()=>{
  const access=read('rules/access.js'),routes=read('routes.js');expect(access).toEqual(routes);
  expect(access.sameExports).toBe(true);expect(access.human).toEqual(HUMAN_ROLES);
  expect(access.report).toEqual(REPORT_APPROVER_ROLES);expect(access.kill).toEqual(KILL_APPROVER_ROLES);
  for(const name of ['readNotification','submitWorkflowActivity','completeProcedureActivity','createWorkflowCase'])expect(access.roles[name],name).toEqual(HUMAN_ROLES);
  for(const name of ['approveKill','rejectKill','approveRestore','rejectRestore'])expect(access.roles[name],name).toEqual(KILL_APPROVER_ROLES);
  const auditor=access.view.find((role:any)=>role.role==='AUDITOR');expect(auditor.allowed).toEqual(expect.arrayContaining(['readNotification','submitWorkflowActivity']));
  expect(auditor.allowed).not.toContain('approveKill');expect(auditor.allowed).not.toContain('deployPolicy');
 });
});
