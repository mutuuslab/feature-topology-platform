// Runs independently of React. Never records error messages, query strings or stored values.
(function () {
  var root = document.getElementById('root'), box = document.getElementById('boot-recovery');
  var state = document.getElementById('boot-state'), detail = document.getElementById('boot-detail'), failed = false;
  function check() {
    box.hidden = !!(root.firstElementChild || root.textContent.trim());
    if (!box.hidden && failed) state.textContent = '화면을 시작하지 못했습니다. 복구 안내에서 다시 시도해 주세요.';
  }
  function fail(event) {
    failed = true;
    var error = event.error || event.reason || {}, name = /^(TypeError|SyntaxError|ReferenceError|RangeError)$/.test(error.name) ? error.name : '초기화 오류';
    var file = String(event.filename || (event.target && event.target.src) || '').match(/\/(?:assets\/([A-Za-z0-9._-]{1,90}\.js)|src\/(main\.tsx))(?:[?#]|$)/);
    detail.textContent = name + (file ? ' · ' + (file[1] || file[2]) : '');
    check();
  }
  window.addEventListener('error', fail, true);
  window.addEventListener('unhandledrejection', fail);
  if (window.MutationObserver) new MutationObserver(check).observe(root, { childList: true, subtree: true });
  else window.setInterval(check, 1000);
  window.setTimeout(function () { failed = true; check(); }, 8000);
  check();
})();
