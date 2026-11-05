// Exact UI keys only. Authentication storage, cookies and server data are untouched.
(function () {
  var button = document.getElementById('reset-ui'), result = document.getElementById('recovery-result');
  button.addEventListener('click', function () {
    try {
      ['fp.state.v2', 'fp.twin.v1', 'ff.learn.v1'].forEach(function (key) { localStorage.removeItem(key); });
      result.textContent = 'UI 설정 3개를 초기화했습니다. 플랫폼을 다시 열어 주세요.';
      button.disabled = true;
    } catch (_) {
      result.textContent = '설정 초기화를 완료하지 못했습니다. Chrome의 사이트 저장소 접근 설정을 확인해 주세요.';
    }
  });
})();
