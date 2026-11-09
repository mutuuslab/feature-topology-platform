/* Classic-script adapter for the explicitly labelled, serverless file:// replay package. */
(function () {
  'use strict';
  if (location.protocol !== 'file:') return;
  const manifest = globalThis.__FF_OFFLINE_MANIFEST__;
  if (!manifest || manifest.schema !== 'ff.offline.file/1') throw new Error('오프라인 데이터 목록을 읽지 못했습니다. ZIP 전체를 압축 해제하세요.');
  const NativeDate = Date;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const nativeOpen = window.open.bind(window);
  const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
  const scope = String(manifest.id || manifest.captureMetadata?.aggregateSha256 || manifest.frontendSourceCommit).slice(0, 32);
  const generationKey = 'ff.offline.generation.' + scope;
  let generation;
  try { generation = localStorage.getItem(generationKey); } catch { /* capability check below reports unavailable storage */ }
  if (!generation) {
    generation = crypto.randomUUID();
    try { localStorage.setItem(generationKey, generation); } catch { /* read-only browsing can still load captured data */ }
  }
  const clockKey = 'ff.offline.clock.' + scope + '.' + generation;
  const anchor = NativeDate.parse(manifest.referenceTime || manifest.captureMetadata?.referenceTime);
  if (!Number.isFinite(anchor)) throw new Error('오프라인 시연의 기준 시각이 없습니다.');
  let saved = anchor;
  try { saved = Math.max(anchor, Number(localStorage.getItem(clockKey)) || anchor); } catch { /* session only clock */ }
  const started = performance.now();
  const now = () => Math.floor(saved + performance.now() - started);
  function persistClock() {
    try {
      if (localStorage.getItem(generationKey) !== generation) return;
      localStorage.setItem(clockKey, String(Math.max(now(), Number(localStorage.getItem(clockKey)) || anchor)));
    } catch { /* does not turn an unavailable business store into successful persistence */ }
  }
  function ReplayDate(...args) {
    if (!new.target) return new NativeDate(now()).toString();
    return Reflect.construct(NativeDate, args.length ? args : [now()], new.target === ReplayDate ? NativeDate : new.target);
  }
  Object.setPrototypeOf(ReplayDate, NativeDate);
  ReplayDate.prototype = NativeDate.prototype;
  ReplayDate.now = now;
  globalThis.Date = ReplayDate;
  setInterval(persistClock, 1000);
  addEventListener('pagehide', persistClock);
  window.open = function (...args) { persistClock(); return nativeOpen(...args); };

  // The captured inputs stay immutable. Only this package's local overlay is namespaced.
  const dbName = 'ff-offline-' + scope + '-' + generation;
  const idbOpen = typeof IDBFactory === 'undefined' ? null : IDBFactory.prototype.open;
  const idbDelete = typeof IDBFactory === 'undefined' ? null : IDBFactory.prototype.deleteDatabase;
  if (idbOpen) {
    IDBFactory.prototype.open = function (name, ...args) { return idbOpen.call(this, name === 'ff-sim' ? dbName : name, ...args); };
    IDBFactory.prototype.deleteDatabase = function (name) { return idbDelete.call(this, name === 'ff-sim' ? dbName : name); };
  }
  const diagnostics = { mode: 'OFFLINE_REPLAY', requests: 0, loadedChunks: 0, verifiedBlobs: 0, missing: [], blockedNetwork: [], referenceTime: new NativeDate(anchor).toISOString(), wallOpenedAt: new NativeDate().toISOString(), database: dbName };
  globalThis.__FF_OFFLINE_DIAGNOSTICS__ = diagnostics;
  const report = (list, value) => { if (list.length < 200 && !list.includes(value)) list.push(value); };
  const parts = new Map(), chunks = new Map(), bytesCache = new Map(), objectUrls = new Map();
  globalThis.__FF_OFFLINE_REGISTER__ = (id, values) => {
    for (const [key, value] of Object.entries(values)) parts.set(key, value);
    diagnostics.loadedChunks++;
  };
  function loadChunk(id) {
    if (!chunks.has(id)) chunks.set(id, new Promise((resolve, reject) => {
      const relative = manifest.chunks[id];
      if (!relative || !/^data\/[a-zA-Z0-9._-]+\.js$/.test(relative)) return reject(new Error('Invalid offline chunk'));
      const script = document.createElement('script');
      script.src = new URL(relative, document.baseURI).href;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('데이터 파일을 읽지 못했습니다: ' + relative + '. ZIP 전체를 압축 해제하세요.'));
      document.head.append(script);
    }));
    return chunks.get(id);
  }
  function bytes(id) {
    if (!bytesCache.has(id)) bytesCache.set(id, (async () => {
      const item = manifest.blobs[id];
      if (!item) throw new Error('Missing offline blob');
      await Promise.all(item.parts.map(part => loadChunk(part.chunk)));
      const value = new Uint8Array(item.bytes);
      let offset = 0;
      for (const part of item.parts) {
        const encodedPart = parts.get(part.key);
        if (typeof encodedPart !== 'string') throw new Error('오프라인 데이터 조각이 누락됐습니다.');
        const rawPart = atob(encodedPart);
        if (offset + rawPart.length > value.byteLength) throw new Error('오프라인 데이터 조각 길이가 다릅니다.');
        for (let i = 0; i < rawPart.length; i++) value[offset + i] = rawPart.charCodeAt(i);
        offset += rawPart.length;
      }
      if (offset !== value.byteLength) throw new Error('오프라인 데이터 조각이 부족합니다.');
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (value.byteLength !== item.bytes || digest !== item.sha256) throw new Error('오프라인 데이터 길이 또는 SHA-256이 다릅니다. ZIP을 다시 압축 해제하세요.');
      diagnostics.verifiedBlobs++;
      return value;
    })());
    return bytesCache.get(id);
  }
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  function pathOf(input) {
    let value = String(input);
    if (/^(data|blob):/.test(value)) return null;
    if (/^https?:/i.test(value) || value.startsWith('//')) return null;
    let path;
    try { path = new URL(value, document.baseURI).pathname; } catch { return null; }
    const base = new URL('.', document.baseURI).pathname;
    const candidates = [value.replace(/^\.\//, '').split(/[?#]/)[0], path.startsWith(base) ? path.slice(base.length) : path.replace(/^\/+/, '')];
    for (const prefix of ['api-snapshot/', 'assets/', 'brand/', 'map/', 'models/', 'env/']) {
      const at = path.indexOf('/' + prefix);
      if (at >= 0) candidates.push(path.slice(at + 1));
    }
    for (const candidate of candidates) {
      for (const key of [candidate, (() => { try { return decodeURIComponent(candidate); } catch { return candidate; } })()]) {
        if (own(manifest.paths, key)) return key;
      }
    }
    return null;
  }
  async function assetUrl(path) {
    const id = manifest.paths[path];
    if (!objectUrls.has(id)) objectUrls.set(id, (async () => nativeCreateObjectURL(new Blob([await bytes(id)], { type: manifest.blobs[id].mime })))());
    return objectUrls.get(id);
  }
  globalThis.__FF_OFFLINE_ASSET_URL__ = async input => { const key = pathOf(input); if (!key) throw new Error('Bundled asset not found'); return assetUrl(key); };
  globalThis.fetch = async function (input, init) {
    const url = input instanceof Request ? input.url : String(input);
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (/^(blob|data):/.test(url)) return nativeFetch(input, init);
    if (url.includes('__auth/login')) return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    const key = pathOf(url);
    if (key && (method === 'GET' || method === 'HEAD')) {
      diagnostics.requests++;
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const id = manifest.paths[key], item = manifest.blobs[id];
      const value = await bytes(id);
      return new Response(method === 'HEAD' ? null : value.slice(), { status: 200, headers: { 'Content-Type': item.mime, 'Content-Length': String(item.bytes), 'X-FF-Offline': 'captured-input', 'X-Content-SHA256': item.sha256 } });
    }
    if (/^https?:|^\/\//i.test(url)) report(diagnostics.blockedNetwork, url);
    else report(diagnostics.missing, method + ' ' + url);
    return new Response(JSON.stringify({ error: { code: 'OFFLINE_NOT_CAPTURED', message: '이 오프라인 패키지에 요청 자료가 없습니다.', details: { url, method } } }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  };

  // Image loading does not use fetch. Resolve verified local bytes before assigning src, so WebGL sees a same-document Blob.
  const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  const nativeSetAttribute = Element.prototype.setAttribute;
  const imageRequests = new WeakMap();
  function imageSource(image, value) {
    const path = pathOf(value);
    if (!path) return false;
    const token = {};
    imageRequests.set(image, token);
    void assetUrl(path).then(url => { if (imageRequests.get(image) === token) src.set.call(image, url); }).catch(error => { report(diagnostics.missing, String(error)); image.dispatchEvent(new Event('error')); });
    return true;
  }
  if (src?.set && src?.get) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', { configurable: true, enumerable: src.enumerable, get: src.get, set(value) { if (!imageSource(this, value)) src.set.call(this, value); } });
    Element.prototype.setAttribute = function (name, value) {
      if (this instanceof HTMLImageElement && String(name).toLowerCase() === 'src' && imageSource(this, value)) return;
      return nativeSetAttribute.call(this, name, value);
    };
  }
  const workerSources = new Map();
  if (typeof Worker !== 'undefined') {
    const NativeWorker = Worker;
    globalThis.Worker = new Proxy(NativeWorker, { construct(Target, args) {
      let [url, options] = args;
      const key = pathOf(url);
      if (key && workerSources.has(key)) url = workerSources.get(key);
      return Reflect.construct(Target, [url, options]);
    } });
  }
  function tellParent(type, payload) { if (parent !== window) parent.postMessage({ type, ...payload }, '*'); }
  const nativeClose = window.close.bind(window);
  window.close = function () { if (parent !== window) tellParent('ff.file.close', {}); else nativeClose(); };
  // Plain return links should replace the shell rather than nest another shell inside its iframe.
  document.addEventListener('click', event => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!anchor || (anchor.target && anchor.target !== '_self') || parent === window) return;
    let url;
    try { url = new URL(anchor.href, document.baseURI); } catch { return; }
    if (url.protocol === 'file:' && new URL('.', url).href === new URL('.', document.baseURI).href && /\/(index|external|twin)\.html$/.test(url.pathname)) anchor.target = '_top';
  }, true);
  addEventListener('hashchange', () => tellParent('ff.file.route', { hash: location.hash }));
  for (const method of ['pushState', 'replaceState']) {
    const nativeHistory = history[method];
    history[method] = function (...args) {
      const result = Reflect.apply(nativeHistory, this, args);
      tellParent('ff.file.route', { hash: location.hash });
      return result;
    };
  }
  addEventListener('storage', event => {
    if (event.key === generationKey && event.newValue !== generation) location.reload();
  });
  globalThis.__FF_OFFLINE_RESTART__ = function () {
    persistClock();
    const oldName = dbName;
    localStorage.setItem(generationKey, crypto.randomUUID());
    try { localStorage.removeItem('ff.sim'); } catch { /* next database starts empty */ }
    if (idbDelete) {
      const request = idbDelete.call(indexedDB, oldName);
      request.onerror = () => { /* old open tabs may delay cleanup; the new session uses a distinct store */ };
    }
    location.reload();
  };
  addEventListener('message', event => {
    if (event.source !== parent || parent === window) return;
    if (event.data?.type === 'ff.file.route' && typeof event.data.hash === 'string' && /^#\//.test(event.data.hash) && location.hash !== event.data.hash) location.hash = event.data.hash;
    if (event.data?.type === 'ff.file.restart') globalThis.__FF_OFFLINE_RESTART__();
  });
  setInterval(() => tellParent('ff.file.clock', { iso: new NativeDate(now()).toISOString() }), 1000);
  tellParent('ff.file.route', { hash: location.hash });
  globalThis.__FF_OFFLINE_READY__ = (async () => {
    if (!globalThis.isSecureContext || !crypto?.subtle || !globalThis.indexedDB) throw new Error('최신 Chrome 또는 Edge에서 압축 해제한 index.html을 열어 주세요. 안전한 로컬 저장소가 필요합니다.');
    const eager = manifest.eager || [];
    await Promise.all(eager.map(id => bytes(id)));
    for (const [path, id] of Object.entries(manifest.paths)) {
      if (path === 'map/world-land.geojson') globalThis.__FF_OFFLINE_WORLD_LAND__ = JSON.parse(new TextDecoder().decode(await bytes(id)));
      if (/worker[^/]*\.(m?js)$/i.test(path) && eager.includes(id)) {
        const value = await bytes(id);
        let binary = '';
        for (let at = 0; at < value.length; at += 32768) binary += String.fromCharCode(...value.subarray(at, at + 32768));
        workerSources.set(path, 'data:application/javascript;base64,' + btoa(binary));
      }
    }
    return { scope, referenceTime: diagnostics.referenceTime };
  })();
  globalThis.__FF_OFFLINE_READY__.catch(error => {
    const detail = document.getElementById('boot-detail');
    if (detail) detail.textContent = String(error.message || error);
    tellParent('ff.file.failure', { message: String(error.message || error) });
  });
})();
