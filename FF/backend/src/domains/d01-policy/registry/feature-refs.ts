// Feature ↔ 기준 기능(Feature DB) 연결 검증(30-95 §5.3·§6.2·§6.3·§5.4) — 등록·초안 수정·새 Version이 같은 판정을 쓴다.
//  · 막음: 연결 없음·대표 없음(400 REFDB_LINK_REQUIRED), 없는 기준 행·폐기(RETIRED) 행(400), 대표 ASIL과 다른데 사유 없음(400),
//          같은 국가·차종·트림에 같은 대표 기준 행(409 REFDB_DUPLICATE_IN_SCOPE — 확인·사유가 있으면 허용)
//  · 경고(막지 않음): 요청 중·검토 필요·폐기 예정 행, 선행 기준 행(requires)이 같은 범위 어떤 Feature에도 없음
// refVersion은 연결 당시 Feature DB 발행 버전 — 이미 있던 연결은 그 버전을 그대로 둔다(기준 행이 바뀌어도 Feature 값을 자동으로 바꾸지 않는다).
import { Injectable, type PipeTransform } from '@nestjs/common';
import {
  CreateFeatureBody,
  featureRefsProblems,
  REF_STATUS_POLICY,
  type Asil,
  type AsilDeviation,
  type FeatureRefLink,
  type FeatureRefLinkInput,
  type FeatureRefRow,
  type FeatureVersionRow,
  type RefStatus,
} from '@ff/contracts';
import { DomainError } from '../../../kernel/errors';
import { RefdbRepository } from '../refdb/refdb.repository';
import { FeatureRepo } from '../repos';

/** 기준 행을 가져온 발행 버전이 아직 없을 때(빈 DB, 시드 전) — 엑셀 가져옴 버전 */
const FALLBACK_RELEASE = 'v1.3';

export type RefWarningCode = 'REF_STATUS' | 'REF_PREREQUISITE' | 'REF_DUPLICATE_CONFIRMED' | 'REF_DUPLICATE';
export interface RefWarning {
  code: RefWarningCode;
  refId: string;
  message: string;
  /** REF_STATUS — 경고를 낸 기준 행 상태 */
  status?: RefStatus;
}

export interface FeatureScope {
  country: string;
  vehicleModel: string;
  trim: string;
}

export interface RefLinkRequest {
  featureRefs: readonly FeatureRefLinkInput[] | undefined;
  /** 이전 연결(초안 수정·새 Version) — 같은 기준 행은 refVersion을 잇는다 */
  previous?: readonly FeatureRefLink[];
  asil: Asil;
  asilDeviation?: AsilDeviation;
  scope: FeatureScope;
  /** 자기 Feature(초안 수정·새 Version)는 중복·선행 판정에서 뺀다 */
  featureId?: string;
  /** reject — 409(등록), warn — 경고만(초안 수정·새 Version: 확인 칸이 없고 이미 등록된 Feature) */
  duplicate: 'reject' | 'warn';
  confirmDuplicate?: boolean;
  duplicateReason?: string;
}

export interface RefLinkResult {
  featureRefs: FeatureRefLink[];
  primary: FeatureRefRow;
  /** 대표 ASIL과 같으면 undefined */
  asilDeviation: AsilDeviation | undefined;
  warnings: RefWarning[];
  /** 같은 범위에서 같은 대표 기준 행을 쓰는 다른 Feature(확인하고 등록했을 때 감사에 남긴다) */
  duplicates: { featureId: string; version: string; name: string }[];
}

export const linkRequired = (details?: unknown) =>
  new DomainError('REFDB_LINK_REQUIRED', '기준 기능(Feature DB)을 연결하세요 — 대표(PRIMARY) 기준 행이 하나 있어야 등록할 수 있습니다. 맞는 행이 없으면 Feature DB에 추가를 요청하세요.', details);

/**
 * POST /api/features 본문 — 계약 CreateFeatureBody 그대로 검증하되, 연결이 없거나 대표가 없으면 VALIDATION 대신 REFDB_LINK_REQUIRED.
 * (화면은 이 코드로 1단계 '기준 기능 고르기'로 돌려보낸다)
 */
export function parseCreateFeature(input: unknown): CreateFeatureBody {
  const r = CreateFeatureBody.safeParse(input);
  if (r.success) return r.data;
  const issues = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  const refs = (input as { featureRefs?: unknown } | null)?.featureRefs;
  const noPrimary = !Array.isArray(refs) || refs.length === 0 || !refs.some((l) => (l as { role?: unknown } | null)?.role === 'PRIMARY');
  if (noPrimary && r.error.issues.some((i) => i.path[0] === 'featureRefs')) throw linkRequired(issues);
  throw new DomainError('VALIDATION', '입력값을 확인하세요.', issues);
}

export class CreateFeaturePipe implements PipeTransform<unknown, CreateFeatureBody> {
  transform(value: unknown): CreateFeatureBody {
    return parseCreateFeature(value);
  }
}

/** 기준 행의 규제·표준 조항 — 등록 때 따로 주지 않으면 대표 행에서 미리 채운다(§6.3, 요구사항 ID가 아님) */
export const regulationsOf = (ref: FeatureRefRow): string[] => [ref.definition?.regulations ?? '', ref.sourceDetail].map((s) => s.trim()).filter(Boolean);

@Injectable()
export class FeatureRefLinker {
  constructor(
    private readonly refdb: RefdbRepository,
    private readonly features: FeatureRepo,
  ) {}

  /** 지금 발행 버전(연결의 refVersion) */
  currentRelease(): string {
    return this.refdb.latestRelease()?.release ?? FALLBACK_RELEASE;
  }

  /** 연결 검증 — 막는 위반은 DomainError, 나머지는 경고. 읽기만 하므로 트랜잭션 밖에서 먼저 부른다 */
  resolve(req: RefLinkRequest): RefLinkResult {
    const links = req.featureRefs ?? [];
    const problems = featureRefsProblems(links);
    if (!links.length || !links.some((l) => l.role === 'PRIMARY')) throw linkRequired({ field: 'featureRefs', problems });
    if (problems.length) throw new DomainError('VALIDATION', problems.join(' '), { field: 'featureRefs', problems });

    const rows = new Map<string, FeatureRefRow>();
    const unknown: string[] = [];
    for (const l of links) {
      const row = this.refdb.getRef(l.refId);
      if (row) rows.set(l.refId, row);
      else unknown.push(l.refId);
    }
    if (unknown.length) throw new DomainError('VALIDATION', `Feature DB에 없는 기준 행입니다: ${unknown.join(', ')} — 검색해서 고르거나 추가를 요청하세요.`, { field: 'featureRefs', refIds: unknown });

    const retired = links.filter((l) => rows.get(l.refId)!.status === 'RETIRED');
    if (retired.length)
      throw new DomainError(
        'VALIDATION',
        retired.map((l) => `기준 행 ${l.refId}은(는) ${REF_STATUS_POLICY.RETIRED.ko} 상태라 연결할 수 없습니다 — ${REF_STATUS_POLICY.RETIRED.hint}`).join(' '),
        { field: 'featureRefs', refIds: retired.map((l) => l.refId), replacedBy: Object.fromEntries(retired.map((l) => [l.refId, rows.get(l.refId)!.replacedBy])) },
      );

    const primaryLink = links.find((l) => l.role === 'PRIMARY')!;
    const primary = rows.get(primaryLink.refId)!;
    const asilDeviation = this.asilDeviationFor(primary, req.asil, req.asilDeviation);

    const warnings: RefWarning[] = [];
    for (const l of links) {
      const row = rows.get(l.refId)!;
      const policy = REF_STATUS_POLICY[row.status];
      if (!policy.warn) continue;
      const extra = row.status === 'REVIEW' && row.adminMemo ? ` (관리 메모: ${row.adminMemo})` : row.status === 'DEPRECATED' && row.replacedBy ? ` 대체 행: ${row.replacedBy}` : '';
      warnings.push({ code: 'REF_STATUS', refId: l.refId, status: row.status, message: `기준 행 ${l.refId}은(는) ${policy.ko} 상태입니다 — ${policy.hint}${extra}` });
    }

    // 같은 범위의 다른 Feature — 폐기된 Feature는 뺀다
    const inScope = this.features
      .all()
      .filter((f) => f.featureId !== req.featureId && f.lifecycle !== 'RETIRED' && f.country === req.scope.country && f.vehicleModel === req.scope.vehicleModel && f.trim === req.scope.trim);

    const duplicates = this.duplicatesOf(primary.refId, inScope);
    if (duplicates.length) {
      const list = duplicates.map((d) => `${d.featureId}@${d.version} ${d.name}`).join(', ');
      if (req.duplicate === 'reject' && !(req.confirmDuplicate && req.duplicateReason?.trim()))
        throw new DomainError(
          'REFDB_DUPLICATE_IN_SCOPE',
          `같은 국가·차종·트림에 대표 기준 행 ${primary.refId}을(를) 쓰는 Feature가 이미 있습니다: ${list}. 같은 기능의 변형(하드웨어 차이 등)이면 확인하고 사유를 적어 다시 등록하세요.`,
          { refId: primary.refId, features: duplicates, hint: 'confirmDuplicate: true와 duplicateReason을 함께 보내면 등록합니다.' },
        );
      warnings.push({
        code: req.duplicate === 'reject' ? 'REF_DUPLICATE_CONFIRMED' : 'REF_DUPLICATE',
        refId: primary.refId,
        message: `같은 범위에 대표 기준 행 ${primary.refId}을(를) 쓰는 Feature가 있습니다: ${list}${req.duplicate === 'reject' ? ` — 확인 사유: ${req.duplicateReason!.trim()}` : ''}`,
      });
    }

    // 선행 기준 행(§5.4) — 같은 범위 어떤 Feature에도(이 Feature 연결 포함) 없으면 경고. Feature 간 의존관계는 자동으로 만들지 않는다
    const linkedInScope = new Set<string>(links.map((l) => l.refId));
    for (const f of inScope) for (const l of f.featureRefs ?? []) linkedInScope.add(l.refId);
    for (const l of links) {
      const missing = rows.get(l.refId)!.requires.filter((r) => !linkedInScope.has(r));
      for (const r of missing) warnings.push({ code: 'REF_PREREQUISITE', refId: l.refId, message: `기준 행 ${l.refId}의 선행 기준 행 ${r}을(를) 같은 국가·차종·트림의 어떤 Feature도 쓰지 않습니다 — 선행 기능 Feature가 필요한지 확인하세요.` });
    }

    const release = this.currentRelease();
    const prev = new Map((req.previous ?? []).map((l) => [l.refId, l.refVersion]));
    // 대표가 먼저 — 저장 순서를 일정하게
    const ordered = [primaryLink, ...links.filter((l) => l !== primaryLink)];
    const featureRefs: FeatureRefLink[] = ordered.map((l) => ({ refId: l.refId, role: l.role, refVersion: prev.get(l.refId) ?? release }));
    return { featureRefs, primary, asilDeviation, warnings, duplicates };
  }

  /**
   * ASIL이 대표 행의 대표 ASIL과 다르면 사유 필수 — 기능안전 담당자 G2 검토 대상(§6.3).
   * 같으면 사유를 버린다(남겨 두면 G2에 거짓 검토 표시가 뜬다).
   */
  asilDeviationFor(primary: FeatureRefRow, asil: Asil, deviation: AsilDeviation | undefined): AsilDeviation | undefined {
    if (asil === primary.asilRep) return undefined;
    if (!deviation || deviation.from !== primary.asilRep || deviation.to !== asil)
      throw new DomainError('VALIDATION', `ASIL ${asil}이(가) 대표 기준 행 ${primary.refId}의 대표 ASIL ${primary.asilRep}과(와) 다릅니다 — 사유(asilDeviation: from ${primary.asilRep}, to ${asil}, reason)를 입력하세요. 기능안전 담당자가 G2에서 검토합니다.`, {
        field: 'asilDeviation',
        from: primary.asilRep,
        to: asil,
        refId: primary.refId,
      });
    return deviation;
  }

  /** 저장된 연결의 대표 기준 행(없으면 undefined — 연결 도입 전 시드) */
  primaryOf(f: Pick<FeatureVersionRow, 'featureRefs'>): FeatureRefRow | undefined {
    const p = f.featureRefs?.find((l) => l.role === 'PRIMARY');
    return p ? this.refdb.getRef(p.refId) : undefined;
  }

  /** 연결 색인 갱신 — feature_version 저장과 같은 트랜잭션에서 */
  saveLinks(f: Pick<FeatureVersionRow, 'featureId' | 'version' | 'featureRefs'>) {
    this.refdb.replaceLinks(f.featureId, f.version, f.featureRefs ?? []);
  }

  /** 같은 범위에서 이 기준 행을 대표로 쓰는 Feature(Feature ID마다 최신 버전 하나) — 저장 문서와 연결 색인을 함께 본다 */
  private duplicatesOf(refId: string, inScope: readonly FeatureVersionRow[]) {
    const indexed = new Set(this.refdb.usersOf(refId).filter((u) => u.role === 'PRIMARY').map((u) => `${u.featureId}@${u.version}`));
    const byId = new Map<string, FeatureVersionRow>();
    for (const f of inScope) {
      const primary = f.featureRefs?.some((l) => l.role === 'PRIMARY' && l.refId === refId) || indexed.has(`${f.featureId}@${f.version}`);
      if (primary) byId.set(f.featureId, f); // all()은 버전 오름차순 — 마지막이 최신
    }
    return [...byId.values()].map((f) => ({ featureId: f.featureId, version: f.version, name: f.name }));
  }
}
