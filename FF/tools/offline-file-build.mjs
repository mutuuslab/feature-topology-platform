// Build a browser-openable directory. No HTTP listener, executable or installed application is created.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildOfflineUi } from './offline-file-ui-build.mjs';
import { buildOfflineData } from './offline-file-data.mjs';

const FF = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const scriptJson = value => JSON.stringify(value).replace(/</g, '\\u003c');

function shellRuntime(config) {
  'use strict';
  const frame = document.getElementById('platform');
  const loading = document.getElementById('loading');
  const clock = document.getElementById('clock');
  function setTime(iso) {
    clock.textContent = new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso));
    clock.dateTime = iso;
  }
  setTime(config.referenceTime);
  frame.src = './' + config.entry + (config.kind === 'main' ? (location.hash.startsWith('#/') ? location.hash : '#/') : location.search + location.hash);
  addEventListener('message', event => {
    if (event.source !== frame.contentWindow || !event.data) return;
    const data = event.data;
    if (data.type === 'ff.file.loaded') loading.hidden = true;
    if (data.type === 'ff.file.failure') { loading.hidden = false; loading.textContent = data.message; }
    if (data.type === 'ff.file.clock') setTime(data.iso);
    if (data.type === 'ff.file.route' && config.kind === 'main' && typeof data.hash === 'string' && data.hash.startsWith('#/')) history.replaceState(null, '', location.pathname + location.search + data.hash);
    if (data.type === 'ff.file.close') {
      window.close();
      setTimeout(() => { if (!window.closed) location.href = './index.html'; }, 100);
    }
  });
  addEventListener('hashchange', () => {
    if (config.kind === 'main' && location.hash.startsWith('#/')) frame.contentWindow.postMessage({ type: 'ff.file.route', hash: location.hash }, '*');
  });
  document.getElementById('restart').onclick = () => {
    if (confirm('이 ZIP의 시연 입력을 새 세션으로 초기화하고 기준 시각에서 다시 시작합니다. 같은 ZIP으로 연 다른 창에도 반영됩니다. 계속할까요?')) frame.contentWindow.postMessage({ type: 'ff.file.restart' }, '*');
  };
}

function wrapper({ entry, kind, referenceTime }) {
  const config = scriptJson({ entry, kind, referenceTime });
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Feature Platform · 오프라인 시연</title>
<style>*{box-sizing:border-box}html,body{height:100%;margin:0}body{font:13px/1.4 system-ui,"Malgun Gothic",sans-serif;background:#eef2f7;color:#182536}.bar{height:42px;display:flex;align-items:center;gap:10px;padding:0 12px;border-bottom:1px solid #ccd4df;background:#f8fafc}.bar strong{font-size:13px;white-space:nowrap}.mode{font-weight:600;color:#355273;white-space:nowrap}time{font-size:12px;color:#596b7e;white-space:nowrap}.spacer{flex:1}.bar button,.bar a{font:inherit;color:#253f5d;padding:4px 7px;border:1px solid #cad4e0;border-radius:5px;background:white;white-space:nowrap;text-decoration:none;cursor:pointer}iframe{display:block;width:100%;height:calc(100% - 42px);border:0;background:white}.loading{position:absolute;inset:42px 0 0;display:grid;place-content:center;text-align:center;gap:8px;background:#f8fafc;padding:20px}.loading small{color:#65778a}[hidden]{display:none!important}@media(max-width:600px){.bar{gap:5px;padding:0 6px}.bar strong{display:none}.mode{font-size:12px}time{font-size:11px}.bar button,.bar a{padding:4px 5px;font-size:11px}}</style></head>
<body><header class="bar"><strong>Feature Platform</strong><span class="mode">오프라인 시연</span><time id="clock" title="시연 기준 시각 — 창을 닫아 둔 시간은 진행하지 않습니다"></time><span class="spacer"></span><a href="./사용안내.html" target="_blank" rel="noopener">사용 안내</a><button id="restart" type="button">새 시연</button></header>
<div id="loading" class="loading"><b>화면과 내장 데이터를 불러오고 있습니다</b><small>처음 열 때 잠시 걸릴 수 있습니다. 서버·포트 설정은 필요 없습니다.</small></div>
<iframe id="platform" title="Feature Platform" allow="clipboard-write; fullscreen"></iframe>
<script>(${shellRuntime.toString()})(${config});</script></body></html>`;
}

function guide(capture, source) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Feature Platform 사용 안내</title><style>body{max-width:850px;margin:40px auto;padding:0 22px;font:16px/1.75 system-ui,"Malgun Gothic",sans-serif;color:#182536;background:#f8fafc}h1{font-size:27px}h2{font-size:19px;margin-top:30px}code{background:#e9edf3;padding:2px 5px}a{color:#235a99}.note{border-left:3px solid #7092b8;padding:10px 18px;background:white}small{color:#596b7e;overflow-wrap:anywhere}</style></head><body>
<h1>Feature Platform · 오프라인 시연</h1><p>ZIP을 <b>전부 압축 해제</b>한 뒤 <a href="./index.html"><code>index.html</code></a>을 더블클릭하세요. 최신 Chrome 또는 Edge에서 바로 열립니다. 설치·명령어·서버·포트 설정은 필요 없습니다.</p>
<h2>로그인과 화면</h2><p>ID <code>ff</code> / 비밀번호 <code>ff</code>로 로그인합니다. 팀별 업무, Feature DB, Feature 등록, 표준 검토, 배포·모니터링, A/B·Shadow 테스트와 가상 연계 화면을 사용할 수 있습니다. <a href="./twin.html?view=vehicle">3D 차량 화면</a>도 별도로 열 수 있습니다.</p>
<h2>저장과 다운로드</h2><p>등록·수정·승인·첨부는 이 브라우저의 로컬 시연 저장소에 보관합니다. 같은 폴더의 연계 화면도 같은 시연 상태를 사용합니다. 파일 다운로드는 브라우저가 처리합니다. ZIP이나 폴더를 옮기기 전에 필요한 산출물을 내보내세요. 다른 PC나 브라우저로 입력 내용이 자동 이전되지는 않습니다.</p>
<h2>실행 가능한 SW 파일 흐름</h2><p>SW 전달 화면에서 실행 시험용 SW를 만들고 업로드한 뒤, 작성자와 다른 승인 역할로 승인합니다. 연결한 Feature·SW·VIN·Flag 조건을 확인해 실제 파일을 다운로드할 수 있습니다. 파일 바이트와 SHA-256을 검사합니다. 차량 ECU 설치를 수행하는 프로그램은 아닙니다.</p>
<h2>시연 기준 시각</h2><p class="note">상단에 표시한 시연 시각은 자료의 캡처 시점에서 출발하고, 창을 열어 둔 동안 진행합니다. 닫아 둔 시간은 건너뜁니다. <b>현재 실차나 외부 서비스의 상태를 조회하는 화면이 아닙니다.</b> 원본 서명·판정·관측 시각은 그대로 두고 당시 자료로 절차를 재생합니다. ‘새 시연’은 이 ZIP의 시연 입력을 초기 상태로 시작합니다.</p>
<p>기준 자료: Feature Version ${capture.counts?.featureVersions ?? '—'}개 · 상품 Version ${capture.counts?.productVersions ?? '—'}개 · 차량 ${capture.counts?.vehicles ?? '—'}대. 기준 시각 ${escapeHtml(capture.referenceTime)}. 차량으로부터의 수신·적용 확인이 없는 항목은 ‘미확인’ 또는 Safe Default로 표시하며, 확인 완료로 바꾸지 않습니다.</p>
<h2>외부 연계와 별도 작업</h2><p>CodeBeamer·JIRA·GitHub 화면과 변경 흐름은 내장 시연 자료로 동작합니다. 오프라인 입력을 실제 회사 서비스로 전송하지 않습니다. 연결 서비스가 필요한 협력사 작성·검수 등은 사용 제한 사유를 표시하며 완료로 기록하지 않습니다. SW 개발비의 구매 담당자 Needs 추가 반영본과 Figma 잔여 설계는 별도 작업입니다.</p>
<h2>화면이 열리지 않을 때</h2><p>ZIP 안에서 미리보기로 실행하지 말고 폴더 전체를 먼저 압축 해제하세요. <code>index.html</code> 옆의 JS 파일과 <code>data</code> 폴더를 함께 유지하세요. 브라우저의 로컬 저장소를 차단한 모드에서는 첨부·승인을 보관할 수 없습니다. 파일 손상 안내가 보이면 ZIP을 다시 압축 해제하세요.</p>
<small>화면 원천 ${escapeHtml(source)}<br>기준 자료 원천 ${escapeHtml(capture.applicationSourceCommit)} · 원본 서명 유지 · 로컬 시연</small></body></html>`;
}

function bootScript(entry) {
  return `(function(){'use strict';Promise.resolve(globalThis.__FF_OFFLINE_READY__).then(function(){const script=document.createElement('script');script.src=${scriptJson('./' + entry)};script.onload=function(){if(parent!==window)parent.postMessage({type:'ff.file.loaded'},'*')};script.onerror=function(){throw new Error('프로그램 파일을 읽지 못했습니다. ZIP 전체를 압축 해제하세요.')};document.head.append(script)}).catch(function(error){if(parent!==window)parent.postMessage({type:'ff.file.failure',message:String(error.message||error)},'*');const root=document.getElementById('root');if(root)root.textContent=String(error.message||error)})})();\n`;
}

export async function buildOfflineFile({ snapshotDir, captureManifest, outDir, uiDir } = {}) {
  if (!snapshotDir || !captureManifest || !outDir) throw new Error('snapshotDir, captureManifest and outDir are required');
  const output = resolve(outDir);
  if (existsSync(output)) throw new Error('Use a new output directory; existing packages are never overwritten');
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: FF, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: FF, encoding: 'utf8' }).trim();
  const capture = typeof captureManifest === 'string' ? JSON.parse(readFileSync(resolve(captureManifest), 'utf8')) : captureManifest;
  mkdirSync(output, { recursive: true });
  const uiSource = uiDir ? resolve(uiDir) : output;
  const ui = uiDir ? JSON.parse(readFileSync(join(uiSource, 'offline-ui-build.json'), 'utf8')) : await buildOfflineUi({ outDir: output });
  if (uiDir) cpSync(uiSource, output, { recursive: true });
  writeFileSync(join(output, 'release.json'), JSON.stringify({ commit: source, builtAt: new Date().toISOString(), mode: 'static', offline: true }));
  // Archive the immutable captured inputs and assets before adding wrappers and diagnostics.
  const archive = buildOfflineData({ snapshotDir: resolve(snapshotDir), publicDir: join(FF, 'frontend/public'), uiDir: output, outDir: output, captureManifest: capture, frontendSourceCommit: source });
  writeFileSync(join(output, 'offline-runtime.js'), readFileSync(join(FF, 'tools/offline-file-runtime.js')));
  const modes = [
    { html: 'platform.html', script: 'app-main.js', wrapper: 'index.html', kind: 'main' },
    { html: 'external-app.html', script: 'app-external.js', wrapper: 'external.html', kind: 'external' },
    { html: 'twin-app.html', script: 'app-twin.js', wrapper: 'twin.html', kind: 'twin' },
  ];
  for (const mode of modes) {
    let html = readFileSync(join(output, mode.html), 'utf8');
    const boot = 'offline-start-' + mode.kind + '.js';
    const escaped = mode.script.replaceAll('.', '\\.');
    const match = new RegExp('<script\\b[^>]*\\bsrc=["\'][^"\']*' + escaped + '["\'][^>]*>\\s*</script>', 'i');
    if (!match.test(html)) throw new Error('Cannot locate standalone script: ' + mode.script);
    html = html.replace(match, '<script defer src="./' + boot + '"></script>');
    writeFileSync(join(output, boot), bootScript(mode.script));
    writeFileSync(join(output, mode.html), html);
    writeFileSync(join(output, mode.wrapper), wrapper({ entry: mode.html, kind: mode.kind, referenceTime: capture.referenceTime }));
  }
  // A short Korean guide is available both as HTML and plain text beside index.html.
  writeFileSync(join(output, '사용안내.html'), guide(capture, source));
  writeFileSync(join(output, 'README.txt'), '\uFEFFFeature Platform 오프라인 시연\r\n\r\n1. ZIP 전체를 압축 해제하세요.\r\n2. index.html을 더블클릭해 최신 Chrome 또는 Edge에서 여세요.\r\n3. ID ff / 비밀번호 ff\r\n\r\n설치·서버·포트 설정은 필요 없습니다.\r\n자세한 안내는 사용안내.html을 여세요.\r\n시연 시각과 데이터는 캡처 기준이며 현재 실차/외부 서비스 조회가 아닙니다.\r\n');
  const inventory = [];
  const walk = path => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Package symlink refused');
      if (entry.isDirectory()) walk(file);
      else { const bytes = readFileSync(file); inventory.push({ path: relative(output, file).split(sep).join('/'), bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }); }
    }
  };
  walk(output);
  const report = { schema: 'ff.offline.package/1', frontendSourceCommit: source, sourceDirty: !!dirty, applicationCaptureSource: capture.applicationSourceCommit, captureToolCommit: capture.captureToolCommit, referenceTime: capture.referenceTime, mode: 'FILE_BROWSER_REPLAY', serverRequired: false, executableIncluded: false, ui, archive: archive.stats, files: inventory.length, bytes: inventory.reduce((n, f) => n + f.bytes, 0) };
  writeFileSync(join(output, 'package-info.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(output, 'checksums.sha256'), inventory.map(f => `${f.sha256}  ${f.path}`).join('\n') + '\n');
  return { output, ...report };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const args = process.argv.slice(2), opts = {};
  const names = { '--snapshot': 'snapshotDir', '--capture-manifest': 'captureManifest', '--out': 'outDir', '--ui': 'uiDir' };
  for (let i = 0; i < args.length; i += 2) { if (!names[args[i]] || !args[i + 1]) throw new Error('Usage: --snapshot <dir> --capture-manifest <json> --out <new-directory> [--ui <prebuilt-ui>]'); opts[names[args[i]]] = args[i + 1]; }
  console.log(JSON.stringify(await buildOfflineFile(opts), null, 2));
}
