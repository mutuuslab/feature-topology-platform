import { createHash } from 'node:crypto';
import { canonicalJson, type WorkflowSourceObservation, type WorkflowSourceView } from '@ff/contracts';
import type { Db } from '../kernel/db';

const LIMITATION='정본 레코드의 존재·현재 내용 해시만 조회했습니다. 외부 파일 내용·개인 서명·원천 승인 유효성은 각 원천 기능에서 별도로 확인하세요.';

/** Read-only allowlist; no caller SQL, no arbitrary network fetch, no approval or case state change. */
export function workflowSources(db:Db,targetRef:string,at:string):WorkflowSourceView {
  const match=/^(FEAT-\d+)@([0-9]+\.[0-9]+\.[0-9]+)$/.exec(targetRef);
  const view:WorkflowSourceView={targetRef,status:'DECLARED',items:[],unavailable:[],limitation:LIMITATION};
  if(!match)return view;
  const [,featureId,version]=match;
  const exists=(name:string)=>db.dialect==='postgres'
    ? !!db.get('SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=?',name)
    : !!db.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",name);
  const add=(kind:WorkflowSourceObservation['kind'],table:string,sql:string,params:string[])=>{
    if(!exists(table)){view.unavailable.push(kind);return;}
    for(const row of db.all<{source_id:string;doc:string;revision?:string|number;state?:string}>(sql,...params)){
      const record=JSON.parse(row.doc) as Record<string,unknown>;
      view.items.push({kind,id:row.source_id,revision:row.revision!==undefined?String(row.revision):null,state:row.state??null,recordHash:createHash('sha256').update(canonicalJson(record)).digest('hex'),observedAt:at,record,verification:'RECORD_OBSERVED'});
    }
  };
  add('FEATURE','feature_version','SELECT feature_id AS source_id,version AS revision,lifecycle AS state,doc FROM feature_version WHERE feature_id=? AND version=?',[featureId,version]);
  if(!view.items.length)return view;
  view.status='RESOLVED';
  add('GATE','gate_record','SELECT gate_record_id AS source_id,status AS state,doc FROM gate_record WHERE feature_id=? AND feature_version=? ORDER BY gate_record_id LIMIT 200',[featureId,version]);
  add('EVIDENCE','evidence','SELECT e.evidence_ref AS source_id,e.doc FROM evidence e JOIN gate_record g ON g.gate_record_id=e.gate_record_id WHERE g.feature_id=? AND g.feature_version=? ORDER BY e.evidence_ref LIMIT 200',[featureId,version]);
  add('ANALYSIS','analysis_record','SELECT record_id AS source_id,kind AS state,doc FROM analysis_record WHERE feature_id=? AND feature_version=? ORDER BY record_id LIMIT 200',[featureId,version]);
  add('POLICY','policy','SELECT policy_id AS source_id,revision,status AS state,doc FROM policy WHERE feature_id=? AND feature_version=? ORDER BY policy_id LIMIT 200',[featureId,version]);
  add('BASELINE','baseline','SELECT baseline_id AS source_id,version AS revision,doc FROM baseline WHERE feature_id=? AND version=? ORDER BY baseline_id LIMIT 200',[featureId,version]);
  // Optional integrated domains remain unavailable until their own source migrations are installed.
  add('ALM_ITEM','alm_item','SELECT item_key AS source_id,revision,status AS state,doc FROM alm_item WHERE feature_id=? ORDER BY item_key LIMIT 200',[featureId]);
  add('SUPPLIER_PACKAGE','supplier_package','SELECT package_id AS source_id,version AS revision,status AS state,doc FROM supplier_package WHERE feature_id=? AND feature_version=? ORDER BY package_id LIMIT 200',[featureId,version]);
  if(exists('supplier_package'))add('SUPPLIER_ARTIFACT','supplier_artifact','SELECT a.record_id AS source_id,a.doc FROM supplier_artifact a JOIN supplier_package p ON p.package_id=a.package_id WHERE p.feature_id=? AND p.feature_version=? ORDER BY a.record_id LIMIT 200',[featureId,version]);
  else view.unavailable.push('SUPPLIER_ARTIFACT');
  return view;
}
