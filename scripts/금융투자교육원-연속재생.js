/**
 * 금융투자교육원(kifin.or.kr) 강의 연속 재생 스크립트
 * ---------------------------------------------------------------------------
 * 강의실 메인(/usr/course/active/detail.do)의 **부모 창 콘솔**에 한 번 붙여넣으면,
 * 목록의 차시를 인덱스 순서대로 하나씩 열고 → 1.25배속으로 재생하고 →
 * "다음 페이지로 이동합니다" / "차시 학습이 완료되었습니다" 알림을 대신 눌러주고 →
 * 팝업이 닫히면 다음 차시를 여는 동작을 목록 끝까지 반복한다.
 *
 * 수유·이동 중처럼 손을 쓸 수 없을 때 오디오로 강의를 이어 듣기 위한 용도다.
 * 진도 위조 목적이 아니며, 사이트가 과정별로 허용하는 배속만 사용한다.
 *
 * 설정은 IIFE 맨 위 const 블록(SPEED / START / TAG)에서 바꾼다.
 *
 * 동작 원리
 * ---------------------------------------------------------------------------
 * 1) 부모 자동 새로고침 차단
 *    페이지 원본에 아래 스위치가 있다. refreshFlag='N'이면 팝업이 닫혀도 부모가
 *    새로고침되지 않아 이 스크립트가 끝까지 살아남는다.
 *      doRefresh = function () { if (refreshFlag == "Y") setTimeout("doRefreshTure()", 200); };
 *
 * 2) checkLearningCnt 수동 리셋
 *    doLearningRun()은 checkLearningCnt > 0이면 새 팝업을 열지 않는다. 이 값은
 *    원래 페이지 새로고침으로 0이 되는데, 1)에서 새로고침을 막았으므로 직접 0으로 되돌린다.
 *
 * 3) 진행 판단은 인덱스로
 *    새로고침을 막으면 DOM의 진도(%)·버튼 라벨이 갱신되지 않는다. 따라서 "안 본 영상
 *    찾기"가 아니라 목록 인덱스를 하나씩 전진시키는 방식으로 다음 차시를 결정한다.
 *
 * 사전 준비 (필수)
 * ---------------------------------------------------------------------------
 * 크롬 팝업 차단을 이 사이트에 허용할 것.
 *   주소창 왼쪽 자물쇠 → 사이트 설정 → 팝업 및 리디렉션 → 허용
 * 스크립트의 클릭은 사용자 제스처가 아니어서, 허용하지 않으면 두 번째 차시부터
 * window.open이 차단된다. 6초 안에 팝업이 안 열리면 안내를 남기고 멈춘다.
 *
 * 사용법
 * ---------------------------------------------------------------------------
 *   강의실 메인 → DevTools 콘솔(⌘⌥I) → 아래 전체 붙여넣기 → Enter
 *   배속 변경:   맨 위 SPEED 상수. 과정이 제공하지 않는 값이면 콘솔에 제공 배속 목록을 남긴다.
 *   중단:        kifinStop()
 *   목록 갱신:   doRefreshTure()      (또는 ⌘R)
 *
 * 알아둘 점
 * ---------------------------------------------------------------------------
 * - 진도 저장은 정상. 팝업이 닫히기 전에 endVideo()가 saveProgress()를 호출한다.
 *   막은 것은 부모 화면 갱신일 뿐 서버 기록과 무관하다.
 * - 부모 목록의 진도 숫자는 실행 중 갱신되지 않는다. 끝난 뒤 새로고침해서 확인할 것.
 * - 중간 퀴즈(quizList)가 있는 차시는 영상이 멈춘다. 직접 풀어야 하며 콘솔에 경고가 찍힌다.
 * - 제한진도율 초과·학습일 종료 등 부모 창 알림이 뜨면 즉시 멈추고 메시지를 남긴다.
 * - 시험·설문은 자동화 대상이 아니다.
 * - 크롬은 숨겨진 탭의 타이머를 늦춘다. 창은 화면에 보이게, 소리는 켜둘 것.
 */

(function () {
  'use strict';
  /* ----- 설정 ----- */
  const SPEED = '1.25';   // 재생 배속. 과정이 제공하는 값만 유효하다(.lst-speed 참고). 예: '1.0' | '1.25'
  const START = null;     // null = 첫 '학습하기'부터 / 0 = 1번 차시부터 전부 다시
  const TAG   = '[kifin]';
  /* ---------------- */

  const SPEED_NUM = parseFloat(SPEED);
  var warnedSpeed = false;

  var btns = [].slice.call(document.querySelectorAll('.step_div button[onclick*="doLearning"]'));
  if (!btns.length) { console.error(TAG, '강의 버튼 없음 — 강의실 메인에서 실행하세요'); return; }
  if (typeof window.jQuery !== 'function') { console.error(TAG, 'jQuery 없음 — 강의실 메인이 맞는지 확인하세요'); return; }

  window.refreshFlag = 'N';                      // 부모 자동 새로고침 차단
  var _open = window.open, lastWin = null;       // 팝업 핸들 확보
  window.open = function () { var w = _open.apply(window, arguments); if (w) lastWin = w; return w; };

  function label(b) {
    var d = b.closest('.step_div'), t = d && d.querySelector('.tit'), p = d && d.querySelector('.per');
    return (p ? p.textContent.trim() + ' ' : '') + (t ? t.textContent.trim() : '?');
  }

  var i = START;
  if (i === null) {
    i = btns.findIndex(function (b) { return b.textContent.trim() === '학습하기'; });
    if (i < 0) i = 0;
  }

  var phase = 'open', waited = 0, timer;

  function stop(why) {
    clearInterval(timer);
    window.refreshFlag = 'Y';
    window.open = _open;
    console.warn(TAG, '종료:', why);
    console.log(TAG, '목록 갱신: doRefreshTure()');
  }

  function drive(w) {
    var $ = w.jQuery; if (!$) return;
    var v = w.document.getElementById('tVideo');
    if (v && w.vidPlaySpeed && v.playbackRate < SPEED_NUM - 0.001) {
      w.vidPlaySpeed(SPEED);
      $('.btn-speed').text(SPEED + ' x');
      $('.lst-speed li').removeClass('active')
        .filter(':has(button[speed="' + SPEED + '"])').addClass('active');
      if (!warnedSpeed && !$('.lst-speed button[speed="' + SPEED + '"]').length) {
        warnedSpeed = true;
        console.warn(TAG, '   이 과정 배속 목록에 ' + SPEED + 'x 없음 — 제공 배속:',
          $('.lst-speed button').map(function () { return $(this).attr('speed'); }).get().join(', ') || '(없음)');
      }
    }
    $('.ui-dialog:visible').each(function () {
      var m = $(this).find('.ui-dialog-content p').text().trim();
      if (!/다음 페이지로 이동합니다|차시 학습이 완료되었습니다/.test(m)) return;
      $(this).find('.ui-dialog-buttonset button:last').click();
      console.log(TAG, '   확인:', m);
    });
    if ($('#popupOverlay:visible').length) console.warn(TAG, '   퀴즈 대기 — 직접 풀어주세요');
  }

  timer = setInterval(function () {
    var msg = '';
    window.jQuery('.ui-dialog:visible .alert-modal').each(function () {
      msg = window.jQuery(this).text().trim();
    });
    if (msg) { stop('부모 창 알림 → ' + msg); return; }

    if (phase === 'open') {
      if (i >= btns.length) { stop('전체 완료'); return; }
      console.log(TAG, '[' + (i + 1) + '/' + btns.length + ']', label(btns[i]));
      window.checkLearningCnt = 0;               // 새로고침 대신 직접 리셋
      lastWin = null;
      btns[i].click();
      waited = 0; phase = 'wait'; return;
    }

    if (phase === 'wait') {
      if (lastWin && !lastWin.closed) { phase = 'play'; return; }
      if (++waited > 20) stop('팝업이 안 열림 — 크롬 팝업 차단 허용 필요');
      return;
    }

    if (phase === 'play') {
      if (!lastWin || lastWin.closed) { i++; phase = 'open'; return; }
      try { drive(lastWin); } catch (e) {}
    }
  }, 300);

  window.kifinStop = function () { stop('사용자 요청'); };
  console.log(TAG, '총 ' + btns.length + '차시, ' + (i + 1) + '번째부터. 중단: kifinStop()');
})();
