/**
 * 기준 화면 (MENU 1.3 · 7 업무 그룹 / 30 화면 / 186 상세 영역).
 *
 * 레거시 데모 화면을 흉내내지 않고, 기준 패키지의 화면 정의서(screen-UIxx.json)를
 * 그대로 읽어서 보여준다. 목록·상세·편집을 각각 만들지 않고 한 화면에서
 * "정의 → 상세 영역 → 작업/API/상태/역할" 순으로 읽게 한다.
 * 근거: FP-DETAILED-1.1 · SPEC_NAV_RULE(‘S 번호는 배치 ID’) · SPEC_STATUS_RULE(‘부분≠완료’).
 */
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  SPEC_BASELINE, SPEC_COUNTS, SPEC_GROUP_BY_ID, SPEC_INVARIANTS, SPEC_MENU_BASELINE,
  SPEC_NAV_RULE, SPEC_ROLE_BY_KEY, SPEC_SCREEN_BY_ID, SPEC_SHARED_CONTEXT, SPEC_STATUS_RULE,
} from '../data/specNav';
import type { SpecAction, SpecArea, SpecScreenDetail } from '../data/specTypes';
import {
  SPEC_MENU, SPEC_MENU_ITEM, SPEC_ROLE_HOME, specAreaPath, specScreenPath, screensOfOwner,
} from '../data/specMenu';
import { areaSvgUrl, loadAssetManifest, loadScreenDetail } from '../data/specIa';
import type { SpecAssetManifest } from '../data/specIa';
import { implementedLinks } from '../data/uiLinks';
import { useAsync } from '../hooks/useAsync';
import { roleLabel, roleMeta, roleName } from '../data/refdata';

/* ------------------------------------------------------------------ */
/* 작은 표현 조각                                                       */
/* ------------------------------------------------------------------ */

/** 역할 키 → 기준 홈 화면 ID (specMenu.SPEC_ROLE_HOME 의 경로에서 ID만 뽑는다) */
const ROLE_HOME_SCREEN: Record<string, string> = Object.fromEntries(
  Object.entries(SPEC_ROLE_HOME).map(([k, v]) => [k, v.replace('/ui/', '')]),
);

/** 기준 상태 문구 → 색 토큰. 문구가 곧 판정이고 색은 보조 수단일 뿐이다. */
function toneOf(text: string | undefined): string {
  const v = text || '';
  if (v.includes('완료') || v.includes('충족') || v.includes('통과') || v.includes('반영')) return 'var(--pass)';
  if (v.includes('부분') || v.includes('진행') || v.includes('필요') || v.includes('예정')) return 'var(--pending)';
  if (v.includes('미구현') || v.includes('미착수') || v.includes('없')) return 'var(--muted)';
  return 'var(--info)';
}

function Badge({ text }: { text: string | undefined }) {
  if (!text) return null;
  return <span className="badge" style={{ background: toneOf(text), marginRight: 4 }}>{text}</span>;
}

function Chips({ items, mono }: { items: string[] | undefined; mono?: boolean }) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return <span className="muted small">없음</span>;
  return (
    <div className="row" style={{ gap: 6 }}>
      {list.map((x, i) => (
        <span key={`${x}-${i}`} className={mono ? 'pill mono' : 'pill'}>{x}</span>
      ))}
    </div>
  );
}

function Sub({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="card">
      <b>{title}</b>
      {note ? <div className="muted small mt">{note}</div> : null}
      <div className="mt">{children}</div>
    </div>
  );
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="kv">
      {rows.map(([k, v], i) => (
        <div key={`${k}-${i}`} style={{ display: 'contents' }}>
          <div>{k}</div>
          <div>{v}</div>
        </div>
      ))}
    </div>
  );
}

function List({ items }: { items: string[] | undefined }) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return <span className="muted small">없음</span>;
  return (
    <ol style={{ margin: 0, paddingLeft: 18 }}>
      {list.map((x, i) => <li key={i} className="small" style={{ marginBottom: 2 }}>{x}</li>)}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* 상세 영역                                                            */
/* ------------------------------------------------------------------ */

function ActionTable({ actions, areaId }: { actions: SpecAction[]; areaId: string }) {
  if (!actions.length) return <span className="muted small">없음</span>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Action</th><th>의도</th><th>대상 객체</th><th>API</th><th>권한</th><th>허용 역할</th><th>실패</th>
          </tr>
        </thead>
        <tbody>
          {actions.map((a) => (
            <tr key={`${areaId}-${a.id}`}>
              <td>
                <div>{a.label}</div>
                <div className="mono small muted">{a.id} · {a.type}</div>
              </td>
              <td className="small">{a.intent || a.opens || '-'}</td>
              <td className="mono small">{a.canonicalObject || '-'}</td>
              <td className="mono small">
                {a.api?.method} {a.api?.path}
                <div className="muted">{a.api?.schema}</div>
                <div className="muted">{a.api?.status}</div>
              </td>
              <td className="mono small">{a.permission || '-'}</td>
              <td className="small">{(a.roles || []).map((r) => roleLabel(r)).join(', ') || '-'}</td>
              <td className="small">
                {(a.errors || []).join(', ') || '-'}
                {a.idempotency ? <div className="muted">{a.idempotency}</div> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AreaPanel({ screen, area, manifest }: { screen: SpecScreenDetail; area: SpecArea; manifest?: SpecAssetManifest | null }) {
  const svg = areaSvgUrl(area.id, manifest);
  return (
    <>
      <div className="card">
        <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
          <b style={{ fontSize: 15 }}>{area.id} {area.name}</b>
          <Badge text={area.type} />
          <Badge text={area.placement} />
          <span className="pill">{area.editable ? '편집 가능' : '조회 전용'}</span>
          <span className="pill">영역 구현 {area.implementationStatus}</span>
        </div>
        <div className="muted small mt">{area.layout || area.layoutName || '-'} · 화면 {screen.id} · 앵커 {area.anchor || '-'}</div>
        <div className="row mt">
          <div style={{ flex: '1 1 420px', minWidth: 320 }}>
            <Rows rows={[
              ['목적', screen.goal],
              ['영역 설명', area.domainDetail || '-'],
              ['공통 탭', <Chips key="tabs" items={area.detailTabs} />],
              ['배치', `${area.placement} · ${area.layoutName || '-'}`],
              ['경로', <span className="mono" key="route">{area.route || '-'}</span>],
              ['적용 범위', <span className="mono" key="sc">{SPEC_SHARED_CONTEXT.join(' · ')}</span>],
            ]} />
          </div>
          <div style={{ flex: '1 1 320px', minWidth: 260 }}>
            <a href={svg} target="_blank" rel="noreferrer" title="첫 화면 원본 열기">
              <img src={svg} alt={`${area.id} 첫 화면`}
                style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 6, background: '#fff' }} />
            </a>
            <div className="muted small mt">첫 화면(UI {SPEC_MENU_BASELINE}) · 클릭하면 원본 SVG를 엽니다</div>
          </div>
        </div>
      </div>

      <div className="row">
        <div className="card" style={{ flex: '1 1 380px', minWidth: 320 }}>
          <b>작업 ({area.tasks.length})</b>
          <div className="mt"><List items={area.tasks} /></div>
        </div>
        <div className="card" style={{ flex: '1 1 380px', minWidth: 320 }}>
          <b>업무 규칙</b>
          <div className="mt">
            <Chips items={area.rules} />
            {area.defaultRules ? <div className="muted small mt">기본 규칙: {area.defaultRules}</div> : null}
            {area.stateRule ? <div className="muted small">상태 규칙: {area.stateRule}</div> : null}
          </div>
          <b style={{ display: 'block', marginTop: 14 }}>인수 조건 {area.acceptanceId ? <span className="mono small muted">{area.acceptanceId}</span> : null}</b>
          <div className="mt"><List items={area.acceptanceCriteria} /></div>
        </div>
      </div>

      <div className="card">
        <b>역할 정책</b>
        <div className="muted small" style={{ marginBottom: 6 }}>
          기준 패키지의 영역별 서술 정책이며, 화면 상단의 역할 선택과 별개로 항상 적용된다.
        </div>
        <Rows rows={[
          ['조회', area.rolePolicy?.read || '-'],
          ['편집', area.rolePolicy?.edit || '-'],
          ['승인', area.rolePolicy?.approve || '-'],
          ['원천 쓰기', area.rolePolicy?.sourceWrite || '-'],
        ]} />
      </div>

      <div className="row">
        <div className="card" style={{ flex: '1 1 340px', minWidth: 300 }}>
          <b>필수·응답 컬럼</b>
          <div className="muted small mt">필수 컬럼</div>
          <Chips items={area.columns} mono />
          <div className="muted small mt">응답 컬럼 ({area.responseColumns?.length || 0})</div>
          <Chips items={(area.responseColumns || []).slice(0, 24)} mono />
          {(area.responseColumns || []).length > 24
            ? <div className="muted small">… 외 {(area.responseColumns || []).length - 24}개</div> : null}
          <div className="muted small mt">응답 메타데이터</div>
          <Chips items={area.responseMetadata} mono />
          {area.responseSelection ? <div className="muted small mt">선택: {area.responseSelection}</div> : null}
          {area.responseEmpty ? <div className="muted small">빈 응답: {area.responseEmpty}</div> : null}
        </div>
        <div className="card" style={{ flex: '1 1 340px', minWidth: 300 }}>
          <b>API 계약</b>
          <div className="mt">
            <Rows rows={[
              ['읽기', <span className="mono" key="r">{area.readApi?.profile ? `[${area.readApi.profile}] ` : ''}{area.readApi?.method} {area.readApi?.path}</span>],
              ['프로젝션', <span className="mono" key="p">{area.readApi?.projection || '-'}</span>],
              ['상태', <span className="mono" key="s">{area.readApi?.status || '-'}</span>],
              ['요청 스키마', <span className="mono" key="i">{area.inputSchemaId || '-'}</span>],
              ['응답 스키마', <span className="mono" key="o">{area.responseSchemaId || '-'}</span>],
            ]} />
          </div>
          {Object.keys(area.readApi?.query || {}).length ? (
            <>
              <div className="muted small mt">쿼리</div>
              <Chips items={Object.entries(area.readApi.query).map(([k, v]) => `${k}=${v}`)} mono />
            </>
          ) : null}
          <div className="muted small mt">선행 의존 ({area.readDependencies?.length || 0})</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Method</th><th>Path</th><th>목적</th></tr></thead>
              <tbody>
                {(area.readDependencies || []).map((d, i) => (
                  <tr key={i}><td className="mono small">{d.method}</td><td className="mono small">{d.path}</td><td className="small">{d.purpose}</td></tr>
                ))}
                {!(area.readDependencies || []).length ? <tr><td colSpan={3} className="muted small">없음</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Sub title={`업무 명령과 Action (${(area.actions || []).length})`} note="행 단위 버튼은 여기 정의된 Action·Command만 노출한다.">
        <ActionTable actions={area.actions || []} areaId={area.id} />
        {(area.businessCommands || []).length ? (
          <div className="table-wrap mt">
            <table>
              <thead><tr><th>Command</th><th>역할</th><th>전이</th><th>가드</th><th>API</th><th>인수</th></tr></thead>
              <tbody>
                {(area.businessCommands || []).map((c) => (
                  <tr key={c.id}>
                    <td>{c.label}<div className="mono small muted">{c.id}</div></td>
                    <td className="small">{c.role}</td>
                    <td className="small">{(c.fromStates || []).join(' | ') || '-'} → <b>{c.toState || '-'}</b></td>
                    <td className="small">{c.guard || '-'}</td>
                    <td className="mono small">{c.api || '-'}<div className="muted">{c.payloadSchema || ''}</div></td>
                    <td className="mono small">{c.acceptanceId || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Sub>

      <div className="row">
        <div className="card" style={{ flex: '1 1 360px', minWidth: 300 }}>
          <b>입력 스키마 ({area.inputFields?.length || 0})</b>
          <div className="mono small muted">{area.inputSchemaId || '-'}</div>
          <div className="table-wrap mt">
            <table>
              <thead><tr><th>속성</th><th>원천</th><th>필수 단계</th><th>설명</th></tr></thead>
              <tbody>
                {(area.inputFields || []).slice(0, 40).map((f) => (
                  <tr key={f.id}><td className="mono small">{f.id}</td><td className="small">{f.sourceType}</td><td className="small">{f.requiredStage}</td><td className="small">{f.description}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {(area.inputFields?.length || 0) > 40 ? <div className="muted small mt">… 외 {(area.inputFields?.length || 0) - 40}개</div> : null}
        </div>
        <div className="card" style={{ flex: '1 1 360px', minWidth: 300 }}>
          <b>편집 필드 ({area.editFields?.length || 0})</b>
          <div className="table-wrap mt">
            <table>
              <thead><tr><th>속성</th><th>라벨</th><th>입력</th><th>필수</th><th>원천</th></tr></thead>
              <tbody>
                {(area.editFields || []).map((f) => (
                  <tr key={f.key}>
                    <td className="mono small">{f.key}</td><td className="small">{f.label}</td>
                    <td className="small">{f.type}</td><td className="small">{f.required ? '필수' : '-'}</td>
                    <td className="small">{f.origin}</td>
                  </tr>
                ))}
                {!(area.editFields || []).length ? <tr><td colSpan={5} className="muted small">없음</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Sub title="상태 9종 처리" note={`기준 상태 ${SPEC_COUNTS.states}종 · 입력 보존은 재입력 필요 여부를 뜻한다.`}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>상태</th><th>동작</th><th>입력 보존</th></tr></thead>
            <tbody>
              {(area.states || []).map((s) => (
                <tr key={s.state}>
                  <td><b>{s.state}</b></td>
                  <td className="small">{s.behavior}</td>
                  <td className="small">{s.inputPreserved ? '보존' : '보존 안 함'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Sub>

      <div className="row">
        <div className="card" style={{ flex: '1 1 340px', minWidth: 300 }}>
          <b>아키텍처 연결</b>
          <div className="mt">
            <Rows rows={[
              ['Core 소유', area.coreOwner || '-'],
              ['Core', area.coreName || '-'],
              ['게이트웨이 Core', area.gatewayCore || '-'],
              ['Canonical 객체', <span className="mono" key="c">{area.canonicalObject || '-'}</span>],
              ['모듈', <span className="mono" key="m">{area.module || '-'}</span>],
            ]} />
          </div>
          <div className="muted small mt">참조</div>
          <Chips items={area.references} mono />
        </div>
        <div className="card" style={{ flex: '1 1 340px', minWidth: 300 }}>
          <b>설계·구현 상태</b>
          <div className="mt">
            <Rows rows={[
              ['설계', <Badge key="d" text={area.designStatus} />],
              ['구현', <span key="i"><Badge text={area.implementationStatus} />{area.previousCoverage?.coverage ? <span className="muted small">이전 {area.previousCoverage.coverage}</span> : null}</span>],
              ['연계', <Badge key="g" text={area.integrationStatus} />],
              ['검증', <Badge key="v" text={area.verificationStatus} />],
              ['프로토타입', <Badge key="p" text={area.prototypeStatus} />],
              ['커버리지', <span key="c">{area.coverage || '-'}</span>],
            ]} />
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 기준 화면 페이지                                                     */
/* ------------------------------------------------------------------ */

export function SpecScreen() {
  const { uiId = '', areaId } = useParams();
  const navigate = useNavigate();
  const nav = SPEC_SCREEN_BY_ID[uiId];
  const detail = useAsync(() => (nav ? loadScreenDetail(uiId) : Promise.reject(new Error(`기준에 없는 화면 ID입니다: ${uiId}`))), [uiId]);
  const manifest = useAsync(() => loadAssetManifest(), []);

  if (!nav) {
    return (
      <div>
        <div className="breadcrumb">기준 화면 ▸ {uiId}</div>
        <h1 className="page-title">기준에 없는 화면</h1>
        <p className="page-sub">MENU {SPEC_MENU_BASELINE} 의 화면 ID는 UI01~UI30 입니다. <Link to="/ui">기준 메뉴</Link>에서 다시 선택하세요.</p>
      </div>
    );
  }

  const group = SPEC_GROUP_BY_ID[nav.group];
  const owner = SPEC_ROLE_BY_KEY[nav.owner];
  const links = implementedLinks(uiId).links;
  const screen = detail.data;
  const areas = screen?.areas || [];
  const activeId = areaId || screen?.defaultSubmenu || nav.defaultSubmenu;
  const area = areas.find((a) => a.id === activeId) || areas[0];

  return (
    <div>
      <div className="breadcrumb">
        {group?.name || nav.group} ▸ {uiId} {nav.name}
      </div>
      <h1 className="page-title">{uiId} {nav.name}</h1>
      <p className="page-sub">
        {group?.name} · 담당 {owner ? `${owner.label}(${owner.name})` : nav.owner} · 유형 {nav.kind} · 기준 {SPEC_BASELINE} / MENU {SPEC_MENU_BASELINE}
      </p>

      <div className="kpis">
        <div className="kpi"><div className="v">{screen?.counts.areas ?? nav.areaIds.length}</div><div className="l">상세 영역</div></div>
        <div className="kpi"><div className="v">{screen?.counts.tasks ?? '-'}</div><div className="l">Task</div></div>
        <div className="kpi"><div className="v">{screen?.counts.actions ?? '-'}</div><div className="l">Action</div></div>
        <div className="kpi"><div className="v">{nav.acceptance.length}</div><div className="l">화면 인수 조건</div></div>
        <div className="kpi"><div className="v">{links.length}</div><div className="l">연결 구현 화면</div></div>
      </div>

      <div className="row">
        <div className="card" style={{ flex: '1 1 420px', minWidth: 320 }}>
          <b>화면 정의</b>
          <div className="mt">
            <Rows rows={[
              ['목적', nav.goal],
              ['정상 흐름', nav.done || '-'],
              ['예외 처리', nav.exception || '-'],
              ['담당 역할', owner ? `${owner.label} · ${owner.name} (${owner.group})` : nav.owner],
              ['기본 상세 영역', <span className="mono" key="d">{nav.defaultSubmenu || '-'}</span>],
              ['목록/상세/편집/확인', <span className="mono" key="l">{[nav.listScreenId, nav.detailScreenId, nav.editScreenId, nav.confirmScreenId].filter(Boolean).join(' · ') || '-'}</span>],
              ['설계 상태', <Badge key="ds" text={nav.designStatus} />],
              ['구현 상태', <Badge key="is" text={nav.implementationStatus} />],
              ['제품 검증', <span key="pv">{nav.productVerification}</span>],
            ]} />
          </div>
          <div className="muted small mt">필수 컬럼</div>
          <Chips items={nav.columns} mono />
          <div className="muted small mt">설계 원천</div>
          <Chips items={nav.sourceRefs} mono />
        </div>
        <div className="card" style={{ flex: '1 1 320px', minWidth: 280 }}>
          <b>화면 인수 조건</b>
          <div className="mt"><List items={nav.acceptance} /></div>
          <b style={{ display: 'block', marginTop: 14 }}>연결 구현 화면</b>
          <div className="muted small">기준 화면을 데모 구현으로 확인할 때 쓰는 경로입니다.</div>
          <div className="mt">
            {links.length ? links.map((l) => (
              <div key={l.path} style={{ marginBottom: 4 }}>
                <Link to={l.path}>{l.label}</Link> <span className="mono small muted">{l.path}</span>
              </div>
            )) : <span className="muted small">연결된 데모 화면이 없습니다.</span>}
          </div>
        </div>
      </div>

      {detail.loading ? <div className="card muted">기준 화면 데이터를 읽는 중…</div> : null}
      {detail.error ? (
        <div className="card">
          <b style={{ color: 'var(--fail)' }}>기준 화면 데이터를 읽지 못했습니다</b>
          <div className="small mt">{String(detail.error.message || detail.error)}</div>
          <div className="muted small mt">화면 상세 JSON은 public/spec/data/screen-{uiId}.json 입니다. 배포본에 함께 올라갔는지 확인하세요.</div>
        </div>
      ) : null}

      {screen ? (
        <>
          <div className="card">
            <b>상세 영역 {screen.counts.areas}개</b>
            <div className="muted small">S 번호는 이번 개정의 설계 배치 ID이며 별도 최상위 화면이 아니다 — 표·탭·패널 구현을 허용한다.</div>
            <div className="tabs" style={{ marginTop: 10 }}>
              {screen.areas.map((a) => (
                <button key={a.id} className={a.id === area?.id ? 'active' : ''}
                  onClick={() => navigate(specAreaPath(uiId, a.id))}>{a.id} {a.name}</button>
              ))}
            </div>
          </div>
          {area ? <AreaPanel screen={screen} area={area} manifest={manifest.data} /> : null}

          {screen.legacyForm?.length ? (
            <Sub title={`레거시 폼 입력 매핑 (${screen.legacyForm.length})`} note="기존 데모 폼을 기준 속성으로 옮길 때의 대응표입니다.">
              <div className="table-wrap">
                <table>
                  <thead><tr><th>키</th><th>라벨</th><th>입력</th><th>필수</th></tr></thead>
                  <tbody>
                    {screen.legacyForm.map((f) => (
                      <tr key={f.key}><td className="mono small">{f.key}</td><td className="small">{f.label}</td><td className="small">{f.input}</td><td className="small">{f.required ? '필수' : '-'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Sub>
          ) : null}

          {screen.unleashItems?.length ? (
            <Sub title={`이 화면의 구현 작업 항목 (${screen.unleashItems.length})`} note="기준 패키지의 화면별 미착수·부분 항목 목록입니다.">
              <div className="table-wrap">
                <table>
                  <thead><tr><th>ID</th><th>항목</th><th>우선순위</th><th>변경 위치</th><th>테스트</th></tr></thead>
                  <tbody>
                    {screen.unleashItems.map((u) => (
                      <tr key={u.id}>
                        <td className="mono small">{u.id}</td><td className="small">{u.title}</td>
                        <td className="small">{u.priority}</td><td className="mono small">{u.location}</td>
                        <td className="small">{u.testId} {u.test}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Sub>
          ) : null}

          <div className="card muted small">
            {SPEC_NAV_RULE} {SPEC_STATUS_RULE}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 기준 화면 목록 (/ui)                                                 */
/* ------------------------------------------------------------------ */

export function SpecScreenIndex() {
  return (
    <div>
      <div className="breadcrumb">기준 화면 ▸ 전체</div>
      <h1 className="page-title">기준 화면 전체</h1>
      <p className="page-sub">
        MENU {SPEC_MENU_BASELINE} — {SPEC_COUNTS.groups} 업무 그룹 · {SPEC_COUNTS.screens} 화면 · {SPEC_COUNTS.submenus} 상세 영역 ·
        Task {SPEC_COUNTS.tasks} · FRI {SPEC_COUNTS.FRI} · OPA {SPEC_COUNTS.OPA} · 상태 {SPEC_COUNTS.states} · Core {SPEC_COUNTS.cores}
      </p>
      <div className="kpis">
        {SPEC_MENU.map((g) => (
          <div className="kpi" key={g.id}>
            <div className="v">{g.items.length}</div>
            <div className="l">{g.icon} {g.ko}</div>
          </div>
        ))}
      </div>
      {SPEC_MENU.map((g) => (
        <div className="card" key={g.id}>
          <b>{g.icon} {g.ko}</b> <span className="mono small muted">{g.id}</span>
          <div className="muted small">화면 {g.items.length}개 · 공통 기반: {SPEC_INVARIANTS.knowledgeFoundation}</div>
          <div className="table-wrap mt">
            <table>
              <thead><tr><th>화면</th><th>담당 역할</th><th>유형</th><th>설계</th><th>구현</th><th>연결 구현 화면</th></tr></thead>
              <tbody>
                {g.items.map((it) => {
                  const s = SPEC_SCREEN_BY_ID[it.id];
                  const ls = implementedLinks(it.id).links;
                  return (
                    <tr key={it.id}>
                      <td><Link to={specScreenPath(it.id)}>{it.id} {it.ko}</Link></td>
                      <td className="small">{roleMeta(it.owner) ? `${roleLabel(it.owner)} · ${roleName(it.owner)}` : it.owner}</td>
                      <td className="small">{it.kind}</td>
                      <td><Badge text={s?.designStatus} /></td>
                      <td><Badge text={s?.implementationStatus} /></td>
                      <td className="small">{ls.length ? ls.map((l) => <Link key={l.path} to={l.path} style={{ marginRight: 8 }}>{l.label}</Link>) : <span className="muted">없음</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="card">
        <b>역할별 착지 화면</b>
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>역할</th><th>기준 홈</th><th>담당 화면</th><th>범위</th></tr></thead>
            <tbody>
              {Object.values(SPEC_ROLE_BY_KEY).map((r) => {
                const home = ROLE_HOME_SCREEN[r.key];
                return (
                  <tr key={r.key}>
                    <td>{r.label} · {r.name}</td>
                    <td>{home ? <Link to={specScreenPath(home)}>{home}</Link> : '-'}</td>
                    <td className="small">{screensOfOwner(r.key).join(', ') || '-'}</td>
                    <td className="small mono">{r.scopes.join(' · ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

