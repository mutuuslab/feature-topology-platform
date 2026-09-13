/**
 * 기준 아키텍처 (FP-DETAILED-1.1).
 *
 * 4 Plane · 49 Core · C01 상세설계 R01~R19 · SW 상세설계 · 품질 속성 · 설계 기준 ·
 * 등록 워크플로와 오류 계약 · FRI/OPA 사전 · API 표면을 한 곳에서 읽는다.
 * 화면 단위 정의는 /ui/UIxx 에, 여기서는 그 정의가 기대는 상위 계약만 다룬다.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  SPEC_BASELINE, SPEC_COUNTS, SPEC_DATE, SPEC_INVARIANTS, SPEC_LEVELS, SPEC_P0_BASELINE,
  SPEC_REGISTRY_CONTRACT, SPEC_RULES, SPEC_STATES, SPEC_TOPOLOGY_RELATIONS, SPEC_UNRESOLVED,
} from '../data/specNav';
import {
  SPEC_API_SURFACE, SPEC_C01_ACCEPTANCE, SPEC_C01_DECISIONS, SPEC_C01_SECTIONS, SPEC_CLOSURE,
  SPEC_COMMAND_PATH, SPEC_CORES, SPEC_DESIGN_BASELINES, SPEC_ERRORS, SPEC_FRI_AREA_MAP,
  SPEC_MENU_SECTIONS, SPEC_P1_PROFILES, SPEC_PLANES, SPEC_PLANE_NOTE, SPEC_QUALITY_ATTRS,
  SPEC_SW_SECTIONS,
} from '../data/specArch';
import type { SpecDocSection } from '../data/specTypes';
import { SPEC_FRI_GROUPS, SPEC_FRI_PHASE_POLICY, SPEC_FRI_PHASES, SPEC_OPA_OBJECTS, SPEC_R0_REQUIRED } from '../data/specFri';
import { loadFieldDictionary } from '../data/specIa';
import { useAsync } from '../hooks/useAsync';

function DocSection({ section }: { section: SpecDocSection }) {
  return (
    <div className="card">
      <b>{section.id} {section.title}</b> <span className="mono small muted">{section.doc}</span>
      {section.blocks.map((b, i) => b.kind === 'p'
        ? <p key={i} className="small" style={{ margin: '8px 0 0' }}>{b.text}</p>
        : (
          <div className="table-wrap mt" key={i}>
            <table>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (r === 0 ? <th key={c}>{cell}</th> : <td key={c} className="small">{cell}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

const TABS = [
  ['overview', '4 Plane과 경계'],
  ['cores', `Core ${SPEC_CORES.length}`],
  ['c01', `C01 상세설계 ${SPEC_C01_SECTIONS.length}`],
  ['sw', `SW·Menu 설계 ${SPEC_SW_SECTIONS.length + SPEC_MENU_SECTIONS.length}`],
  ['quality', '품질 속성과 기준'],
  ['closure', '등록 워크플로·오류'],
  ['fri', 'FRI·OPA 사전'],
  ['api', 'API 표면'],
] as const;

export function SpecArchitecture() {
  const [tab, setTab] = useState<string>('overview');
  const [plane, setPlane] = useState<string>('all');
  const fields = useAsync(() => loadFieldDictionary(), []);
  const cores = plane === 'all' ? SPEC_CORES : SPEC_CORES.filter((c) => SPEC_PLANES.some((p) => p.name === plane && p.cores.some((pc) => pc.id === c.id)));

  return (
    <div>
      <div className="breadcrumb">기준 ▸ 아키텍처</div>
      <h1 className="page-title">기준 아키텍처와 상세설계</h1>
      <p className="page-sub">
        {SPEC_BASELINE} · 기준일 {SPEC_DATE} · 4 Plane(Knowledge Foundation은 다섯 번째 Plane이 아님) ·
        Core {SPEC_COUNTS.cores} · 등록 사전 {SPEC_P0_BASELINE}
      </p>

      <div className="kpis">
        <div className="kpi"><div className="v">{SPEC_PLANES.length}</div><div className="l">Plane</div></div>
        <div className="kpi"><div className="v">{SPEC_CORES.length}</div><div className="l">Core</div></div>
        <div className="kpi"><div className="v">{SPEC_C01_SECTIONS.length}</div><div className="l">C01 요구 섹션</div></div>
        <div className="kpi"><div className="v">{SPEC_C01_ACCEPTANCE.length}</div><div className="l">C01 인수 조건</div></div>
        <div className="kpi"><div className="v">{SPEC_FRI_GROUPS.length}</div><div className="l">등록 속성 영역</div></div>
        <div className="kpi"><div className="v">{SPEC_OPA_OBJECTS.length}</div><div className="l">운영 객체</div></div>
      </div>

      <div className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="card">
            <b>Plane 경계</b>
            <div className="muted small">공식 {SPEC_PLANES.length}개 Plane 고정. {SPEC_PLANE_NOTE}</div>
            <div className="row mt">
              {SPEC_PLANES.map((p) => (
                <div className="card" key={p.name} style={{ flex: '1 1 300px', minWidth: 260, marginBottom: 0 }}>
                  <b>{p.name}</b>
                  <div className="small mt">산출: {p.produces}</div>
                  <div className="muted small">계약: {p.contract}</div>
                  <div className="muted small">Core {p.cores.length}개</div>
                  <div className="mt">
                    {p.cores.map((c) => (
                      <div key={c.id} className="small"><span className="mono">{c.id}</span> {c.name}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <b>불변 조건</b>
            <div className="kv mt">
              <div>공식 Plane</div><div>{SPEC_INVARIANTS.planes.join(' · ')}</div>
              <div>Knowledge Foundation</div><div>{SPEC_INVARIANTS.knowledgeFoundation}</div>
              <div>Core</div><div>{SPEC_INVARIANTS.cores}</div>
              <div>화면</div><div>{SPEC_INVARIANTS.screens}</div>
              <div>등록 속성(FRI)</div><div>{SPEC_INVARIANTS.registryFields}</div>
              <div>운영 속성(OPA)</div><div>{SPEC_INVARIANTS.operationalFields}</div>
              <div>Topology 관계</div><div>{SPEC_INVARIANTS.topologyRelations}</div>
              <div>설계 층위</div><div>{SPEC_LEVELS.join(' ▸ ')}</div>
            </div>
          </div>
          <div className="card">
            <b>Topology 관계 {SPEC_TOPOLOGY_RELATIONS.length}종</b>
            <div className="row mt" style={{ gap: 6 }}>
              {SPEC_TOPOLOGY_RELATIONS.map((r) => <span className="pill mono" key={r}>{r}</span>)}
            </div>
          </div>
          <div className="card">
            <b>미해결·주입 대기</b>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {SPEC_UNRESOLVED.map((u, i) => <li key={i} className="small">{u}</li>)}
            </ul>
          </div>
        </>
      )}

      {tab === 'cores' && (
        <>
          <div className="card">
            <b>Core 책임 배정 ({cores.length})</b>
            <div className="muted small">정본 소유와 협업 경계. 다른 Core의 정본을 직접 수정하지 않고 command/event로 요청한다.</div>
            <div className="mt">
              <select value={plane} onChange={(e) => setPlane(e.target.value)}>
                <option value="all">전체 Plane</option>
                {SPEC_PLANES.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>Core</th><th>이름</th><th>정본 배정</th><th>협업</th></tr></thead>
                <tbody>
                  {cores.map((c) => (
                    <tr key={c.id}>
                      <td className="mono">{c.id}</td><td>{c.name}</td>
                      <td className="small">{c.allocation}</td><td className="small">{c.collaboration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'c01' && (
        <>
          <div className="card">
            <b>Registry 계약 요약</b>
            <div className="kv mt">
              <div>SW 기준</div><div>{SPEC_REGISTRY_CONTRACT.swVersion}</div>
              <div>섹션</div><div className="mono">{SPEC_REGISTRY_CONTRACT.section}</div>
              <div>상태 필드</div><div className="mono">{SPEC_REGISTRY_CONTRACT.stateField}</div>
              <div>정의 상태</div><div className="mono">{SPEC_REGISTRY_CONTRACT.definitionStates.join(' → ')}</div>
              <div>상태 주의</div><div>{SPEC_REGISTRY_CONTRACT.stateNote}</div>
              <div>Topology</div><div className="mono">{SPEC_REGISTRY_CONTRACT.topologyVersion}</div>
              <div>ID 정책</div><div>{SPEC_REGISTRY_CONTRACT.idPolicy}</div>
              <div>CSV 역할</div><div>{SPEC_REGISTRY_CONTRACT.csvRole}</div>
            </div>
          </div>
          <div className="card">
            <b>기준 규칙 {SPEC_RULES.length}건 · 공통 상태 {SPEC_STATES.length}종</b>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>규칙</th><th>제목</th><th>내용</th><th>원천</th></tr></thead>
                <tbody>
                  {SPEC_RULES.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.id}</td><td className="small">{r.title}</td>
                      <td className="small">{r.text}</td><td className="small muted">{r.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="muted small mt">상태: {SPEC_STATES.map((s) => s.label).join(' · ')}</div>
          </div>
          {SPEC_C01_SECTIONS.map((s) => <DocSection key={s.id} section={s} />)}
          <div className="row">
            <div className="card" style={{ flex: '1 1 380px', minWidth: 320 }}>
              <b>C01 인수 조건 ({SPEC_C01_ACCEPTANCE.length})</b>
              <div className="table-wrap mt">
                <table>
                  <thead><tr><th>ID</th><th>입력</th><th>기대</th></tr></thead>
                  <tbody>
                    {SPEC_C01_ACCEPTANCE.map((a) => (
                      <tr key={a.id}><td className="mono small">{a.id}</td><td className="small">{a.input}</td><td className="small">{a.expected}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card" style={{ flex: '1 1 300px', minWidth: 280 }}>
              <b>남은 결정 ({SPEC_C01_DECISIONS.length})</b>
              <div className="table-wrap mt">
                <table>
                  <thead><tr><th>결정</th><th>계약</th><th>연결</th></tr></thead>
                  <tbody>
                    {SPEC_C01_DECISIONS.map((d) => (
                      <tr key={d.id}><td className="mono small">{d.id}</td><td className="small">{d.contract}</td><td className="small muted">{d.link}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'sw' && (
        <>
          {SPEC_SW_SECTIONS.map((s) => <DocSection key={s.id} section={s} />)}
          {SPEC_MENU_SECTIONS.map((s) => <DocSection key={s.id} section={s} />)}
        </>
      )}

      {tab === 'quality' && (
        <>
          <div className="card">
            <b>품질 속성 ({SPEC_QUALITY_ATTRS.length})</b>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>ID</th><th>속성</th><th>조건</th><th>관련 Core</th><th>검증</th></tr></thead>
                <tbody>
                  {SPEC_QUALITY_ATTRS.map((q) => (
                    <tr key={q.id}>
                      <td className="mono small">{q.id}</td><td className="small">{q.attribute}</td>
                      <td className="small">{q.condition}</td><td className="mono small">{q.cores}</td>
                      <td className="small">{q.verification}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <b>설계 기준 ({SPEC_DESIGN_BASELINES.length})</b>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>기준</th><th>내용</th></tr></thead>
                <tbody>
                  {SPEC_DESIGN_BASELINES.map((b) => (
                    <tr key={b.id}><td className="small">{b.id}</td><td className="small">{b.criterion}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'closure' && (
        <>
          <div className="card">
            <b>설계 폐쇄 상태</b>
            <div className="kv mt">
              <div>OpenAPI 오퍼레이션</div><div>{SPEC_CLOSURE.openApiOperations}</div>
              <div>타입 지정 요청</div><div>{SPEC_CLOSURE.typedRequestCount}</div>
              <div>설계 상태</div><div className="mono">{SPEC_CLOSURE.designStatus}</div>
              <div>검토 상태</div><div className="mono">{SPEC_CLOSURE.reviewStatus}</div>
              <div>운영 승인</div><div className="mono">{SPEC_CLOSURE.productionApproval}</div>
              <div>런타임 검증</div><div className="mono">{SPEC_CLOSURE.runtimeValidation}</div>
            </div>
          </div>
          <div className="card">
            <b>등록 워크플로 ({SPEC_CLOSURE.workflow.length})</b>
            <div className="muted small">정의 상태 전이와 가드. 화면은 이 계약을 그대로 노출해야 한다.</div>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>ID</th><th>From</th><th>Action</th><th>To</th><th>Guard</th></tr></thead>
                <tbody>
                  {SPEC_CLOSURE.workflow.map((w) => (
                    <tr key={w.id}>
                      <td className="mono small">{w.id}</td>
                      <td className="mono small">{(w.from || []).join(' | ')}</td>
                      <td className="small"><b>{w.action}</b></td>
                      <td className="mono small">{w.to}</td>
                      <td className="small">{w.guard}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <b>오류 계약 ({SPEC_ERRORS.length})</b>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>Status</th><th>Reason</th><th>설명</th></tr></thead>
                <tbody>
                  {SPEC_ERRORS.map((e) => (
                    <tr key={e.status}><td className="mono">{e.status}</td><td className="mono small">{e.reason}</td><td className="small">{e.description}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'fri' && (
        <>
          <div className="card">
            <b>등록 단계와 필수 항목</b>
            <div className="muted small">{SPEC_FRI_PHASE_POLICY}</div>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>단계</th><th>의미</th><th>필수 후보 수</th><th>R0 고정 필수</th></tr></thead>
                <tbody>
                  {SPEC_FRI_PHASES.map((p) => (
                    <tr key={p.phase}>
                      <td className="mono">{p.phase}</td><td className="small">{p.label}</td>
                      <td>{p.fields.length}</td>
                      <td className="mono small">{p.phase === 'R0' ? SPEC_R0_REQUIRED.join(' ') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <b>등록 속성 영역 ({SPEC_FRI_GROUPS.length})</b>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>영역</th><th>제목</th><th>Owner</th><th>저장</th><th>C01 위치</th></tr></thead>
                <tbody>
                  {SPEC_FRI_GROUPS.map((g) => {
                    const area = SPEC_FRI_AREA_MAP.find((m) => m.area.startsWith(g.id));
                    return (
                      <tr key={g.id}>
                        <td className="mono">{g.id}</td><td>{g.title}</td>
                        <td className="small">{g.owner}</td><td className="small mono">{g.storage}</td>
                        <td className="small mono">{area?.location || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <b>운영 속성 객체 ({SPEC_OPA_OBJECTS.length})</b>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>객체</th><th>속성 수</th><th>속성 ID</th></tr></thead>
                <tbody>
                  {SPEC_OPA_OBJECTS.map((o) => (
                    <tr key={o.object}><td>{o.object}</td><td>{o.count}</td><td className="small mono">{o.fields.slice(0, 12).join(' ')}{o.fields.length > 12 ? ' …' : ''}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <b>속성 사전 전체 ({fields.data ? `${fields.data.fri.length} FRI · ${fields.data.opa.length} OPA · ${fields.data.objects.length} 객체` : '읽는 중…'})</b>
            <div className="muted small">속성 단위 정의·필수 단계·원천은 화면 정의서에서 해당 영역을 열면 함께 표시된다. 상세 속성은 여기서 검색한다.</div>
            {fields.error ? <div className="small" style={{ color: 'var(--fail)' }}>{String(fields.error.message || fields.error)}</div> : null}
            {fields.data ? (
              <>
                <div className="row mt">
                  <div style={{ flex: '1 1 460px', minWidth: 320 }}>
                    <div className="muted small">FRI (등록 정보) {fields.data.fri.length}건 중 상위 60</div>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>ID</th><th>라벨</th><th>영역</th><th>단계</th><th>필수</th><th>저장</th></tr></thead>
                        <tbody>
                          {fields.data.fri.slice(0, 60).map((f) => (
                            <tr key={f.id}>
                              <td className="mono small">{f.id}</td><td className="small">{f.label}</td>
                              <td className="small">{f.group}</td><td className="mono small">{f.phase}</td>
                              <td className="small">{f.required}</td><td className="small">{f.storage}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div style={{ flex: '1 1 400px', minWidth: 300 }}>
                    <div className="muted small">OPA (운영 속성) {fields.data.opa.length}건 중 상위 40</div>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>ID</th><th>객체</th><th>라벨</th><th>필수 단계</th><th>구간</th></tr></thead>
                        <tbody>
                          {fields.data.opa.slice(0, 40).map((f) => (
                            <tr key={f.id}>
                              <td className="mono small">{f.id}</td><td className="small">{f.object}</td>
                              <td className="small">{f.label}</td><td className="small">{f.requiredStage}</td>
                              <td className="mono small">{f.section}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
          <div className="card">
            <b>미착수 구현 항목 (P1) {SPEC_P1_PROFILES.length}건</b>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>ID</th><th>이름</th><th>제목</th><th>화면</th><th>변경</th></tr></thead>
                <tbody>
                  {SPEC_P1_PROFILES.map((p) => (
                    <tr key={p.id}>
                      <td className="mono small">{p.id}</td><td className="small">{p.name}</td>
                      <td className="small">{p.title}</td><td className="mono small">{p.menuId}</td>
                      <td className="small">{p.change}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'api' && (
        <>
          <div className="card">
            <b>API 표면</b>
            <div className="kv mt">
              <div>Operations</div><div className="mono">{SPEC_API_SURFACE.operations}</div>
              <div>P0</div><div className="mono">{SPEC_API_SURFACE.p0}</div>
              <div>UI 상세</div><div className="mono">{SPEC_API_SURFACE.detail}</div>
              <div>명령 경로</div><div className="mono">{SPEC_COMMAND_PATH}</div>
              <div>상태</div><div>{SPEC_API_SURFACE.state}</div>
            </div>
          </div>
          <div className="card">
            <b>화면에서 API 계약 보기</b>
            <div className="small mt">각 화면의 상세 영역마다 읽기 API·입력 스키마·Action별 method/path/오류가 정의되어 있다. 기준 화면 목록에서 시작하세요.</div>
            <div className="mt"><Link to="/ui">기준 화면 전체 (30)</Link></div>
          </div>
        </>
      )}
    </div>
  );
}
