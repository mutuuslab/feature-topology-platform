// 등록 화면이 쓰는 분류 노드(refTaxonomy 응답의 일부)와 ASIL 선택지.
import { Asil } from '@ff/contracts';

export interface TaxonomyNodeLite {
  nodeId: string;
  level: 'DOMAIN' | 'CLUSTER' | 'COMPONENT';
  parentId: string | null;
  nameEn: string;
  nameKo?: string;
}

export const ASIL_VALUES = Asil.options;
