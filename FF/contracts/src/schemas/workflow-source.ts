/** A database observation verifies record presence and its current bytes, never an external file or domain approval. */
export interface WorkflowSourceObservation {
  kind:'FEATURE'|'GATE'|'EVIDENCE'|'ANALYSIS'|'POLICY'|'BASELINE'|'ALM_ITEM'|'SUPPLIER_ARTIFACT'|'SUPPLIER_PACKAGE';
  id:string;
  revision:string|null;
  state:string|null;
  recordHash:string;
  observedAt:string;
  record:Record<string,unknown>;
  verification:'RECORD_OBSERVED';
}
export interface WorkflowSourceView {
  targetRef:string;
  status:'RESOLVED'|'DECLARED';
  items:WorkflowSourceObservation[];
  unavailable:string[];
  limitation:string;
}
