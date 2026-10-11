/* FP-UL-P0-1.0 executable design examples. Not a production SDK, signer or authorization server. */
(()=>{'use strict';
const T='TRUE',F='FALSE',U='UNKNOWN';
function and3(a){return a.includes(F)?F:a.includes(U)?U:T;}
function or3(a){return a.includes(T)?T:a.includes(U)?U:F;}
function not3(a){return a===U?U:a===T?F:T;}
function decimalCompare(a,b){
 const re=/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
 if(typeof a!=='string'||typeof b!=='string'||a.length>64||b.length>64||!re.test(a)||!re.test(b))return null;
 function split(s){const p=s.split('.');return [BigInt(p[0]+(p[1]||'')),(p[1]||'').length];}
 let [aa,as]=split(a),[bb,bs]=split(b);const scale=Math.max(as,bs);aa*=10n**BigInt(scale-as);bb*=10n**BigInt(scale-bs);return aa<bb?-1:aa>bb?1:0;
}
function semverCompare(a,b){
 const r=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
 if(typeof a!=='string'||typeof b!=='string'||a.length>256||b.length>256)return null;
 const aa=a.match(r),bb=b.match(r);if(!aa||!bb)return null;
 for(const m of [aa,bb])if(m[4]?.split('.').some(x=>/^\d+$/.test(x)&&x.length>1&&x[0]==='0'))return null;
 for(let i=1;i<=3;i++){const x=BigInt(aa[i]),y=BigInt(bb[i]);if(x!==y)return x<y?-1:1;}
 if(!aa[4]&&!bb[4])return 0;if(!aa[4])return 1;if(!bb[4])return -1;
 const pa=aa[4].split('.'),pb=bb[4].split('.');
 for(let i=0;i<Math.max(pa.length,pb.length);i++){
  if(pa[i]===undefined)return -1;if(pb[i]===undefined)return 1;if(pa[i]===pb[i])continue;
  const an=/^\d+$/.test(pa[i]),bn=/^\d+$/.test(pb[i]);if(an&&bn)return BigInt(pa[i])<BigInt(pb[i])?-1:1;if(an!==bn)return an?-1:1;return pa[i]<pb[i]?-1:1;
 }return 0;
}
function time(s){
 if(typeof s!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(s))return null;
 const v=Date.parse(s);if(!Number.isFinite(v))return null;const canonical=s.includes('.')?s:s.replace('Z','.000Z');return new Date(v).toISOString()===canonical?v:null;
}
function constraint(rule,context){
 const item=context[rule.contextName];
 if(!item||item.quality!=='TRUSTED'||item.value===null||item.value===undefined)return U;
 let value=item.value,vals=rule.values;if(typeof value!=='string'||!Array.isArray(vals)||!vals.length||vals.some(x=>typeof x!=='string'))return U;
 value=value.normalize('NFC');vals=vals.map(x=>x.normalize('NFC'));
 if(rule.caseInsensitive){if(!['IN','NOT_IN','STR_CONTAINS','STR_STARTS_WITH','STR_ENDS_WITH'].includes(rule.operator)||[value,...vals].some(x=>/[^\x00-\x7F]/.test(x)))return U;value=value.toLowerCase();vals=vals.map(x=>x.toLowerCase());}
 let yes,cmp;
 switch(rule.operator){
  case 'IN':yes=vals.includes(value);break;
  case 'NOT_IN':yes=!vals.includes(value);break;
  case 'STR_CONTAINS':yes=vals.some(v=>value.includes(v));break;
  case 'STR_STARTS_WITH':yes=vals.some(v=>value.startsWith(v));break;
  case 'STR_ENDS_WITH':yes=vals.some(v=>value.endsWith(v));break;
  default:
   if(vals.length!==1)return U;
   if(rule.operator.startsWith('NUM_'))cmp=decimalCompare(value,vals[0]);
   else if(rule.operator.startsWith('SEMVER_'))cmp=semverCompare(value,vals[0]);
   else if(['DATE_AFTER','DATE_BEFORE'].includes(rule.operator)){const a=time(value),b=time(vals[0]);if(a===null||b===null)return U;cmp=a<b?-1:a>b?1:0;}
   else return U;
   if(cmp===null)return U;
   const op=rule.operator.split('_').at(-1);
   yes={EQ:cmp===0,GT:cmp>0,GTE:cmp>=0,LT:cmp<0,LTE:cmp<=0,AFTER:cmp>0,BEFORE:cmp<0}[op];if(yes===undefined)return U;
 }
 const result=yes?T:F;return rule.inverted?not3(result):result;
}
function decide({flagEnabled=true,valid=true,sourceDefaultUsed=false,mandatory=[],strategies=[]}){
 if(!valid||sourceDefaultUsed)return {decision:'HOLD',reason:'INVALID_RESULT',intent:false};
 const proposal=and3([flagEnabled?T:F,or3(strategies)]),out=and3([proposal,...mandatory]);
 return {decision:out===T?'ALLOW':out===F?'DENY':'HOLD',reason:out===U?'CONTEXT_UNKNOWN':out===F?'PREDICATE_DENIED':'POLICY_MATCH',intent:out===T};
}
function publishCheck(x){
 const reasons=[];
 if(!x.allowedRole)reasons.push('ACTION_DENIED');
 if(new Set([x.author,...(x.authorDelegates||[])]).has(x.approver)||(x.approverDelegates||[]).some(v=>[x.author,...(x.authorDelegates||[])].includes(v)))reasons.push('SELF_APPROVAL');
 if(x.candidateHash!==x.approvedHash)reasons.push('HASH_MISMATCH');
 if(x.sourceRevision!==x.approvedSourceRevision)reasons.push('SOURCE_DRIFT');
 if(!x.qualityPassed||!x.authorizationValid)reasons.push('APPROVAL_INCOMPLETE');
 if(!x.supported)reasons.push('UNSUPPORTED_RULE');
 if(x.maintenance)reasons.push('MAINTENANCE');
 if(x.sequence<=x.highestSequence)reasons.push('REPLAY');
 return {eligible:!reasons.length,reasons};
}
function aggregate(required,nodes,expected){
 if(new Set(required).size!==required.length)return {state:'UNKNOWN',confirmed:0,denominator:required.length,nodes:[],reason:'DUPLICATE_REQUIRED_NODE'};
 const results=required.map(nodeId=>{
  const reports=nodes.filter(n=>n.nodeId===nodeId),n=reports[0];
  if(!n)return {nodeId,state:'UNKNOWN',reason:'NO_REPORT'};
  if(reports.length!==1)return {nodeId,state:'UNKNOWN',reason:'UNREDUCED_REPORTS'};
  if(n.metricType!=='READBACK')return {nodeId,state:'UNKNOWN',reason:'ACK_ONLY'};
  if(n.publication!==expected.publication||n.policyHash!==expected.policyHash)return {nodeId,state:'UNKNOWN',reason:'OTHER_PUBLICATION'};
  if(!expected.featureVersion||n.featureVersion!==expected.featureVersion)return {nodeId,state:'UNKNOWN',reason:'OTHER_FEATURE_VERSION'};
  if(n.bootId!==expected.bootIds[nodeId])return {nodeId,state:'UNKNOWN',reason:'OTHER_BOOT'};
  if(!Number.isInteger(expected.minSequence[nodeId])||!Number.isInteger(n.sequence)||n.sequence<expected.minSequence[nodeId])return {nodeId,state:'UNKNOWN',reason:'OLD_SEQUENCE'};
  if(!Number.isFinite(n.ageMs)||!Number.isFinite(expected.maxAgeMs)||expected.maxAgeMs<0||n.ageMs<0||n.ageMs>expected.maxAgeMs)return {nodeId,state:'UNKNOWN',reason:'STALE_REPORT'};
  return {nodeId,state:n.observed===expected.desired?'CONFIRMED':'DIVERGED',reason:n.observed===expected.desired?'READBACK_MATCH':'STATE_MISMATCH'};
 });
 const known=results.filter(n=>n.state==='CONFIRMED').length;
 const state=!required.length?'UNKNOWN':results.some(n=>n.state==='DIVERGED')?'DIVERGED':known===required.length?'CONFIRMED':known?'PARTIAL':'UNKNOWN';
 return {state,confirmed:known,denominator:required.length,nodes:results};
}
function recover(latches,incident,feature,vehicle){return latches.filter(l=>!(l.incident===incident&&l.feature===feature&&l.vehicle===vehicle));}
async function cohortBucket(profileVersion,groupId,salt,targetingKey){
 if(!targetingKey)throw new Error('TARGETING_KEY_MISSING');
 const enc=new TextEncoder(),parts=[profileVersion,groupId,salt,targetingKey].map(x=>enc.encode(x.normalize('NFC')));
 const data=new Uint8Array(parts.reduce((n,x)=>n+4+x.length,0));let o=0;
 for(const p of parts){new DataView(data.buffer).setUint32(o,p.length,false);o+=4;data.set(p,o);o+=p.length;}
 const digest=await crypto.subtle.digest('SHA-256',data);return Number(new DataView(digest).getBigUint64(0,false)%10000n);
}
globalThis.FPP0={and3,or3,not3,decimalCompare,semverCompare,constraint,decide,publishCheck,aggregate,recover,cohortBucket,time};
})();
