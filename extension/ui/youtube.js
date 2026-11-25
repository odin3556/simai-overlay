// YouTube のページの作りに依存する部分は、すべてここにまとめる。
// YouTube 側が変わって動かなくなったら、まずここを直す。
(function (root) {
  'use strict';

  function findPlayer() {
    return document.querySelector('#movie_player');
  }

  function findVideo() {
    const p = findPlayer();
    return (p && p.querySelector('video.html5-main-video')) || null;
  }

  // 広告中は #movie_player に ad-showing が付く（2026-10-31 に確認）
  function isAdShowing() {
    const p = findPlayer();
    return !!p && p.classList.contains('ad-showing');
  }

  function currentVideoId() {
    try {
      return new URL(location.href).searchParams.get('v');
    } catch (e) {
      return null;
    }
  }

  // ページ内の移動（別の動画へ）が終わったときに呼ぶ
  function onNavigate(fn) {
    window.addEventListener('yt-navigate-finish', fn);
  }

  root.SimaiYouTube = { findPlayer, findVideo, isAdShowing, currentVideoId, onNavigate };
})(globalThis);
