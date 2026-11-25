// YouTube のページに入り、層とパネルを作って、動画の再生位置に合わせて描く。
// 時計は動画の「今の再生位置」だけ。自分の時計は持たない。
(function (root) {
  'use strict';

  const { parse } = root.SimaiParse;
  const { buildTimeline, eventsBetween, positionAt, locate } = root.SimaiTiming;
  const { DEFAULT_TOUCH, OLD_DEFAULT_TOUCH } = root.SimaiGeometry;
  const { lookaround, estimateFrame, DEFAULT_FLOW, tapApproach, touchApproach } = root.SimaiFlash;
  const YT = root.SimaiYouTube;
  const CD = root.SimaiCircleDetect;

  // 外部出力の動画の標準の円（OV3RCLOCK の動画で測った値）。位置合わせをしなくても、たいていこれで合う
  const DEFAULT_CALIB = { cx: 0.5, cy: 0.5, r: 0.445 };
  // speed / touchSpeed はゲームのハイスピ（タップ・タッチ）
  const DEFAULT_PLAYBACK = { flow: true, speed: DEFAULT_FLOW.speed, touchSpeed: DEFAULT_FLOW.touchSpeed, sound: false, volume: 0.5, soundOffsetMs: 0, hud: true };
  const DEFAULTS_KEY = 'defaults'; // 動画をまたいで使う設定（最後に合わせた円、流れ・音の設定）

  // 設定は chrome.storage に動画ごとに保存する（外へは送らない）
  const store = {
    async get(key) {
      if (!root.chrome || !chrome.storage) return null;
      const r = await chrome.storage.local.get(key);
      return r[key] || null;
    },
    async set(key, value) {
      if (!root.chrome || !chrome.storage) return;
      await chrome.storage.local.set({ [key]: value });
    },
    async remove(key) {
      if (!root.chrome || !chrome.storage) return;
      await chrome.storage.local.remove(key);
    },
  };

  const S = {
    active: false,
    videoId: null,
    simai: '',
    parsed: null,
    timeline: null,
    holds: [],
    slides: [],
    calib: null,
    first: null,
    touch: Object.assign({}, DEFAULT_TOUCH),
    show: true,
    guide: false,
    playback: Object.assign({}, DEFAULT_PLAYBACK),
    defaults: {},
    calibrating: false,
    calibSaved: false, // この動画の円が保存されているか（なければ自動で探す）
    detecting: false,
    checking: false, // 「再生して確かめる」の最中
    checkTick: 0,
    finding: false, // 「再生して自動で探す」の最中
    findTick: 0,
    drafting: false, // 「再生して下書きを作る」の最中
    draftBpm: 0,
    draftTick: 0,
    song: null, // ① で選んだ曲（OTOGE DB の 1 曲分）
    chartId: null, // ① で選んだ譜面（例 dx_mas）
    songResults: [],
    songDb: null, // 曲の情報の一覧（読み込んだら持っておく）
    frame: 1 / 60,
    diffs: [],
    lastMediaTime: null, // 最後に画面に出たコマの時刻
    video: null,
    player: null,
    rvfcId: null,
    rafId: null,
    panelTick: 0,
  };

  const overlay = new root.SimaiOverlay.Overlay();
  const sound = new root.SimaiSound.AnswerSound();
  const checker = new root.SimaiVerify.Checker();
  const scanner = new root.SimaiFirstDetect.LaneScanner();
  const draftScanner = new root.SimaiFirstDetect.LaneScanner();
  const slideScanner = new root.SimaiSlideDetect.SlideScanner(); // 下書き: スライドの軌道を見るコマ
  const touchScanner = new root.SimaiTouchDetect.TouchScanner(); // 下書き: タッチを見るコマ
  const D = root.SimaiDraft;
  const SDB = root.SimaiSongDB;
  const panel = new root.SimaiPanel.Panel({
    load: (text) => { loadSimai(text); save(); render(); },
    resetVideo: () => resetVideo(),
    calibrate: () => startCalibration(),
    autoCircle: () => autoCircle(),
    searchSong: (q) => searchSong(q),
    guessSong: () => guessSong(false),
    pickSong: (i) => selectSong(S.songResults[i], null),
    pickChart: (id) => { S.chartId = id; showSong(); persist(); },
    findFirst: () => findFirst(),
    draft: (bpm) => draft(bpm),
    useDraft: (text) => useDraft(text),
    copyDraft: (text) => { navigator.clipboard.writeText(text).then(() => panel.setDraftStatus('コピーしました'), () => panel.setDraftStatus('コピーできませんでした。下書きの欄を選んでコピーしてください')); },
    playCheck: () => playCheck(),
    applyFix: () => { const r = checker.result(); if (r.sure && r.best) nudge(r.best); },
    resetCircle: () => { calibration.stop(); S.calib = Object.assign({}, DEFAULT_CALIB); save(); saveDefaults(); render(); },
    setFirstNow: () => setFirstNow(),
    nudge: (n) => nudge(n),
    setShow: (on) => { S.show = on; render(); },
    setGuide: (on) => { S.guide = on; render(); },
    setTouch: (area, v) => { if (v > 0) { S.touch[area] = v; save(); render(); } },
    setFlow: (on) => setPlayback({ flow: on }),
    setSpeed: (v) => { if (v >= 1 && v <= 10) setPlayback({ speed: v }); },
    setTouchSpeed: (v) => { if (v >= 1 && v <= 10) setPlayback({ touchSpeed: v }); },
    setSound: (on) => { if (on) sound.enable(); else sound.reset(); setPlayback({ sound: on }); },
    setHud: (on) => setPlayback({ hud: on }),
    jumpToNow: () => jumpToNow(),
    setVolume: (v) => { sound.setVolume(v); setPlayback({ volume: v }); },
    setSoundOffset: (ms) => { sound.offset = (ms || 0) / 1000; sound.reset(); setPlayback({ soundOffsetMs: ms || 0 }); },
    close: () => deactivate(),
  });

  function setPlayback(p) {
    Object.assign(S.playback, p);
    if ('speed' in p || 'touchSpeed' in p) resetCheck();
    saveDefaults();
    render();
  }

  function nudge(n) {
    if (S.first == null) return;
    S.first += n * S.frame;
    panel.setFirst(S.first);
    sound.reset();
    save();
    render();
  }

  const calibration = new root.SimaiCalibration.Calibration(
    overlay,
    (calib, step) => {
      if (calib) S.calib = calib;
      const hints = {
        center: '円の中心をクリックしてください',
        edge: '円のふち（白い線の上）をクリックしてください',
        adjust: '矢印キーで中心、+ / − で半径を 1px ずつ（Shift で 10px）。クリックで中心からやり直し。Enter で終わる',
      };
      panel.setCalibStatus(hints[step]);
      render();
    },
    (calib) => {
      S.calibrating = false;
      if (calib) S.calib = calib;
      panel.setCalibStatus('');
      S.calibSaved = true;
      save();
      saveDefaults();
      render();
    }
  );

  // ---- 保存と読み込み ----

  function storageKey(id) {
    return `video:${id}`;
  }

  async function loadSettings(id) {
    S.defaults = (await store.get(DEFAULTS_KEY)) || {};
    S.playback = Object.assign({}, DEFAULT_PLAYBACK, S.defaults.playback || {});
    delete S.playback.approach; // 以前は秒で持っていた（いまはハイスピから出す）
    S.playback.sound = false; // 音はボタンを押してから（ブラウザの決まり）
    sound.setVolume(S.playback.volume);
    sound.offset = S.playback.soundOffsetMs / 1000;
    panel.setPlayback(S.playback);

    const v = (id && (await store.get(storageKey(id)))) || {};
    S.simai = v.simai || '';
    S.song = v.song || null;
    S.chartId = v.chartId || null;
    // 円は、この動画で合わせたもの → 最後に合わせたもの → 標準、の順に使う
    S.calib = v.calib || S.defaults.calib || Object.assign({}, DEFAULT_CALIB);
    S.calibSaved = !!v.calib;
    S.first = typeof v.first === 'number' ? v.first : null;
    const oldDefault = v.touch && Object.keys(OLD_DEFAULT_TOUCH).every((k) => v.touch[k] === OLD_DEFAULT_TOUCH[k]);
    S.touch = Object.assign({}, DEFAULT_TOUCH, oldDefault ? {} : v.touch || {});
    loadSimai(S.simai);
    panel.setText(S.simai);
    panel.setFirst(S.first);
    panel.setTouch(S.touch);
    panel.resetSong();
    if (S.song) { S.songResults = [S.song]; panel.setSongResults(S.songResults, 0); showSong(); }
  }

  // simai・円・first が変わったら、それまでの重なりの数えは使えない
  function save() {
    resetCheck();
    persist();
  }

  // 「この動画をリセット」: この動画で保存した物（simai・first・曲・円）と下書き・重なりの数えを消し、
  // 開いたばかりの状態に戻す。動画をまたいで使う設定（ハイスピ・音・最後に合わせた円）は残す
  async function resetVideo() {
    if (S.checking) { S.video && S.video.pause(); setChecking(false); }
    if (S.finding) { S.finding = false; panel.setFinding(false); }
    if (S.drafting) { S.drafting = false; S.draftHidden = false; panel.setDrafting(false); }
    if (S.video && !S.video.paused) S.video.pause();
    calibration.stop();
    if (S.videoId) await store.remove(storageKey(S.videoId));
    S.simai = '';
    S.song = null;
    S.chartId = null;
    S.songResults = [];
    S.first = null;
    S.calib = S.defaults.calib || Object.assign({}, DEFAULT_CALIB);
    S.calibSaved = false;
    S.touch = Object.assign({}, DEFAULT_TOUCH);
    scanner.reset();
    draftScanner.reset();
    slideScanner.reset();
    touchScanner.reset();
    loadSimai('');
    resetCheck();
    panel.setText('');
    panel.setFirst(null);
    panel.setFirstStatus('');
    panel.setTouch(S.touch);
    panel.resetSong();
    panel.setDraft('');
    panel.setDraftStatus('');
    panel.setLoadNote('この動画の設定を消しました。① から選び直してください');
    render();
  }

  // 動画ごとの設定を保存する（曲を選んだだけのときは、重なりの数えは消さない）
  function persist() {
    if (!S.videoId) return;
    store.set(storageKey(S.videoId), { simai: S.simai, calib: S.calib, first: S.first, touch: S.touch, song: S.song, chartId: S.chartId });
  }

  // ---- 曲の情報（① ）----

  // 曲の一覧を background から受け取る。cacheOnly: しまってある物だけ使う（自分からは読みに行かない）
  async function songDb(cacheOnly) {
    if (S.songDb) return S.songDb;
    if (!root.chrome || !chrome.runtime) return null;
    const res = await chrome.runtime.sendMessage({ type: 'songdb', cacheOnly }).catch((e) => ({ error: String(e.message || e) }));
    if (!res || res.error) {
      if (!cacheOnly) panel.setSongStatus(`曲の情報を読めませんでした（${res ? res.error : '返事がない'}）。拡張機能を「更新」してから、もう一度押してください`);
      return null;
    }
    if (res.stale) panel.setSongStatus('OTOGE DB に届かなかったので、前に読んだ曲の情報を使います');
    S.songDb = res.songs;
    return S.songDb;
  }

  async function searchSong(q) {
    if (!q.trim()) { panel.setSongStatus('曲名・読み・アーティストを入れてください'); return; }
    panel.setSongStatus('探しています…');
    const db = await songDb(false);
    if (!db) return;
    S.songResults = SDB.search(db, q);
    panel.setSongResults(S.songResults, 0);
    if (!S.songResults.length) { panel.setSongStatus(`「${q}」は見つかりませんでした`); return; }
    panel.setSongStatus(S.songResults.length > 1 ? `${S.songResults.length} 曲見つかりました。一覧から選べます` : '');
    selectSong(S.songResults[0], null);
  }

  // 動画のタイトルから曲と譜面を当てる。quiet: 新しい動画を開いたとき（しまってある曲の情報だけ使い、外れても何も言わない）
  async function guessSong(quiet) {
    const db = await songDb(quiet);
    if (!db) return;
    const title = document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube\s*$/, '');
    const g = SDB.guessFromTitle(db, title);
    if (!g) {
      if (!quiet) panel.setSongStatus('動画のタイトルから曲が分かりませんでした。曲名を入れて「探す」を押してください');
      return;
    }
    S.songResults = [g.song];
    panel.setSongResults(S.songResults, 0);
    selectSong(g.song, g.chart && g.chart.id);
    panel.setSongStatus(`動画のタイトルから「${g.song.title}」を選びました。違っていれば、曲名を入れて「探す」で選び直してください`);
  }

  // 曲を選ぶ。譜面は chartId、なければ今の難易度 → でらっくす MASTER → MASTER → 一番上の難易度
  function selectSong(song, chartId) {
    if (!song) return;
    const list = SDB.charts(song);
    const prev = S.chartId;
    const pick = list.find((c) => c.id === chartId) || list.find((c) => c.id === prev) || list.find((c) => c.id === 'dx_mas') || list.find((c) => c.diff === 'mas') || list[list.length - 1];
    S.song = song;
    S.chartId = pick ? pick.id : null;
    showSong();
    persist();
  }

  function currentChart() {
    return S.song ? SDB.charts(S.song).find((c) => c.id === S.chartId) || null : null;
  }

  // 選んだ曲をパネルに出し、⑥ の BPM に入れる
  function showSong() {
    if (!S.song) { panel.setSongInfo(null); return; }
    panel.setCharts(SDB.charts(S.song), S.chartId);
    const bpm = SDB.parseBpm(S.song.bpm);
    panel.setSongInfo({ song: S.song, chart: currentChart(), bpm });
    if (bpm) panel.setBpm(bpm.main, true);
  }

  function saveDefaults() {
    S.defaults = { calib: S.calib, playback: S.playback };
    store.set(DEFAULTS_KEY, S.defaults);
  }

  function loadSimai(text) {
    S.simai = text || '';
    if (!S.simai.trim()) {
      S.parsed = null;
      S.timeline = null;
      S.holds = [];
      S.slides = [];
    } else {
      S.parsed = parse(S.simai);
      S.timeline = buildTimeline(S.parsed);
      S.holds = S.timeline.events.filter((e) => e.kind === 'hold' || e.kind === 'touchHold');
      S.slides = S.timeline.events.filter((e) => e.kind === 'slide');
    }
    sound.setEvents(S.timeline ? S.timeline.events : []);
    panel.setParsed(S.parsed);
    if (S.parsed && S.parsed.bpmEvents.length) panel.setBpm(S.parsed.bpmEvents[0].bpm);
  }

  // ---- 時刻 ----

  // 画面に出ているコマの時刻。シーク直後など、まだ新しいコマが出ていなければ currentTime。
  function videoTime() {
    if (!S.video) return 0;
    return S.lastMediaTime != null ? S.lastMediaTime : S.video.currentTime;
  }

  function setFirstNow() {
    if (!S.timeline || !S.timeline.events.length) {
      panel.setCalibStatus('先に simai を読み込んでください');
      return;
    }
    // first = いまの再生位置 − 最初のノーツの拍の位置から出した秒数
    S.first = videoTime() - S.timeline.events[0].time;
    panel.setFirst(S.first);
    panel.setFirstStatus('');
    save();
    render();
  }

  // ---- 描画 ----

  function flowSettings() {
    return {
      on: S.playback.flow,
      approach: tapApproach(S.playback.speed),
      touchApproach: touchApproach(S.playback.touchSpeed),
      appear: DEFAULT_FLOW.appear,
    };
  }

  function render() {
    if (!S.active || !S.video) return;
    overlay.layout();
    const ad = YT.isAdShowing();
    overlay.setVisible(S.show && !ad);
    if (!S.show || ad) return;

    const flow = flowSettings();
    const state = {
      calib: S.calib, touchRatios: S.touch, guide: S.guide || S.calibrating, frame: S.frame, flow, events: [], holding: [], t: 0,
      verdict: (e) => checker.verdict(e),
    };
    if (S.timeline && S.first != null) {
      const t = videoTime() - S.first;
      const w = lookaround(S.frame);
      const ahead = flow.on ? Math.max(w.after, flow.approach, flow.touchApproach) : w.after;
      state.t = t;
      state.events = eventsBetween(S.timeline.events, t - Math.max(w.before, 0.45), t + ahead); // 0.45 秒は ○ × を出す間
      // 流れるノーツのときは、まだ円に着いていないホールドも含める
      const lead = (h) => (!flow.on ? 0 : h.kind === 'touchHold' ? flow.touchApproach : flow.approach);
      state.holding = S.holds.filter((h) => h.time - lead(h) < t && t < h.endTime);
      state.sliding = S.slides.filter((s) => s.time - (flow.on ? flow.approach : 0) < t && t < s.endTime);
      state.slideEnds = S.slides.filter((s) => s.endTime <= t && t - s.endTime < 0.45); // 終わったスライドの ○ ×
      if (S.playback.sound && !S.video.paused) sound.update(t, S.video.playbackRate);
      const now = nowInfo(t);
      if (S.playback.hud) state.hud = now;
      if (++S.panelTick % 6 === 0 || S.video.paused) {
        panel.setPosition(positionAt(S.timeline.tempoMap, t));
        panel.setNow(now);
      }
    } else if (S.video.paused || ++S.panelTick % 30 === 0) {
      panel.setNow(null);
    }
    overlay.draw(state);
  }

  // いまの場所: 再生時間・譜面の時刻・小節と拍・simai の行と区切り（t は譜面の時刻）
  function nowInfo(t) {
    const pos = positionAt(S.timeline.tempoMap, t);
    const loc = S.parsed ? locate(S.simai, S.parsed.cells, pos.beat) : null;
    return Object.assign({ video: videoTime(), chart: t, measure: pos.measure, beat: pos.beatInMeasure + 1, line: 0, before: '', cell: '', after: '' }, loc || {});
  }

  // ② の欄で、いまの区切りを選ぶ（止めてから直すとき用）
  function jumpToNow() {
    if (!S.timeline || S.first == null) return;
    const now = nowInfo(videoTime() - S.first);
    if (!now.line) return;
    if (!S.video.paused) S.video.pause();
    panel.selectText(now.start, now.end);
  }

  // 動画の新しいコマが画面に出るたびに呼ばれる
  function onFrame(now, meta) {
    if (S.lastMediaTime != null) {
      const d = meta.mediaTime - S.lastMediaTime;
      if (d > 0 && S.diffs.push(d) > 240) S.diffs.shift();
      if (S.diffs.length % 30 === 0) {
        S.frame = estimateFrame(S.diffs, S.frame);
        panel.setFrame(S.frame);
      }
    }
    S.lastMediaTime = meta.mediaTime;
    if (S.checking && !S.video.paused && S.timeline && S.first != null) checkFrame(meta.mediaTime - S.first);
    if (S.finding && !S.video.paused) findFrame(meta.mediaTime);
    if (S.drafting && !S.video.paused) draftFrame(meta.mediaTime);
    render();
    S.rvfcId = S.video.requestVideoFrameCallback(onFrame);
  }

  // requestVideoFrameCallback が使えないときの代わり: 画面の更新ごとに currentTime を読む
  function onAnimationFrame() {
    render();
    S.rafId = requestAnimationFrame(onAnimationFrame);
  }

  const videoEvents = {
    pause: () => {
      sound.reset();
      if (S.checking) { setChecking(false); panel.setCheckResult(checker.result()); }
      if (S.finding) finishFind();
      if (S.drafting && !S.draftHidden) finishDraft();
      render();
    },
    seeking: () => {
      S.lastMediaTime = null;
      sound.reset();
      if (S.finding) scanner.reset(); // 途中で動かされたら、そこから数え直す
    },
    seeked: () => render(),
    ratechange: () => { sound.reset(); render(); },
    loadedmetadata: () => { S.lastMediaTime = null; render(); },
  };

  const resizeObserver = new ResizeObserver(() => render());

  function bindVideo() {
    const player = YT.findPlayer();
    const video = YT.findVideo();
    if (!player || !video) return false;
    if (video !== S.video) {
      unbindVideo();
      S.video = video;
      for (const [k, fn] of Object.entries(videoEvents)) video.addEventListener(k, fn);
      resizeObserver.observe(video);
      if ('requestVideoFrameCallback' in video) S.rvfcId = video.requestVideoFrameCallback(onFrame);
      else S.rafId = requestAnimationFrame(onAnimationFrame);
    }
    S.player = player;
    overlay.attach(player, video);
    return true;
  }

  function unbindVideo() {
    if (!S.video) return;
    for (const [k, fn] of Object.entries(videoEvents)) S.video.removeEventListener(k, fn);
    resizeObserver.unobserve(S.video);
    if (S.rvfcId != null && S.video.cancelVideoFrameCallback) S.video.cancelVideoFrameCallback(S.rvfcId);
    if (S.rafId != null) cancelAnimationFrame(S.rafId);
    S.rvfcId = S.rafId = null;
    S.video = null;
    S.lastMediaTime = null;
  }

  // ---- 重なりの確認 ----

  const grab = { canvas: document.createElement('canvas'), ctx: null };

  function resetCheck() {
    checker.reset();
    panel.setCheckResult(null);
  }

  function setChecking(on) {
    S.checking = on;
    panel.setChecking(on);
  }

  // 「再生して確かめる」: 譜面の始まる少し前から（すでに途中ならそこから）再生し、コマごとに数える
  function playCheck() {
    const v = S.video;
    if (!v) return;
    if (S.checking) {
      v.pause();
      setChecking(false);
      return;
    }
    if (!S.timeline || !S.timeline.events.length) { panel.setCalibStatus('先に ② で simai を読み込んでください'); return; }
    if (S.first == null) { panel.setCalibStatus('先に ④ で最初のノーツの時刻を決めてください'); return; }
    if (S.finding) { S.finding = false; panel.setFinding(false); }
    const start = S.first + S.timeline.events[0].time;
    const end = S.first + S.timeline.endTime;
    if (v.currentTime < start - 2 || v.currentTime > end) v.currentTime = Math.max(0, start - 1.5);
    S.show = true;
    panel.setToggles(S.show, S.guide);
    setChecking(true);
    v.play();
  }

  // いま画面に出ているコマを小さく写す: { img, c（img の画素の円）}。広告中などは null、読めなければ { error }
  function grabFrame() {
    const v = S.video;
    if (!v.videoWidth || YT.isAdShowing()) return null;
    const scale = Math.min(1, 360 / v.videoHeight);
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    if (grab.canvas.width !== w || grab.canvas.height !== h) {
      grab.canvas.width = w;
      grab.canvas.height = h;
      grab.ctx = grab.canvas.getContext('2d', { willReadFrequently: true });
    }
    grab.ctx.drawImage(v, 0, 0, w, h);
    try {
      return { img: grab.ctx.getImageData(0, 0, w, h), c: { cx: S.calib.cx * w, cy: S.calib.cy * h, r: S.calib.r * h } };
    } catch (e) {
      return { error: true };
    }
  }

  // いま画面に出ているコマを数える
  function checkFrame(t) {
    const g = grabFrame();
    if (!g) return;
    if (g.error) {
      setChecking(false);
      panel.setCalibStatus('この動画のコマは読めないので、重なりを数えられません');
      return;
    }
    checker.addFrame(g.img, g.c, t, S.frame, flowSettings(), S.timeline.events, S.touch);
    if (++S.checkTick % 15 === 0) {
      panel.setCheckResult(checker.result());
      // 動作確認用: ページに data-simai-debug があれば、ノーツごとの数えをページに書き出す
      if (document.documentElement.hasAttribute('data-simai-debug')) {
        const rows = [...checker.notes].map(([e, m]) => [+(e.time + S.first).toFixed(3), e.kind, e.pos, e.star ? 1 : 0, e.isBreak ? 1 : 0, e.isEx ? 1 : 0, +(m.lit / m.n).toFixed(2), m.n]);
        document.documentElement.setAttribute('data-simai-debug', JSON.stringify({ result: checker.result(), sums: [...checker.sum].map((s, i) => +(s / (checker.cnt[i] || 1)).toFixed(3)), rows }));
      }
    }
  }

  // ---- 最初のノーツの自動検出 ----

  // 「再生して自動で探す」: 動画の頭から再生し、8 本の線を流れてくるノーツを探す
  function findFirst() {
    const v = S.video;
    if (!v) return;
    if (S.finding) { finishFind(); return; }
    if (S.checking) setChecking(false);
    scanner.reset();
    S.findTick = 0;
    S.finding = true;
    panel.setFinding(true);
    panel.setFirstStatus('動画の頭から再生して、ノーツを探しています…');
    v.currentTime = 0;
    v.play();
  }

  function findFrame(tv) {
    const g = grabFrame();
    if (!g) return;
    if (g.error) {
      finishFind();
      panel.setFirstStatus('この動画のコマは読めないので、自動では探せません。止めて「いまが最初のノーツ」で決めてください');
      return;
    }
    scanner.addFrame(g.img, g.c, tv, flowSettings());
    if (++S.findTick % 15 !== 0) return;
    const fn = scanner.firstNote();
    if (!fn) {
      panel.setFirstStatus(`ノーツを探しています…（${tv.toFixed(1)} 秒）`);
      if (tv > 90) finishFind();
      return;
    }
    const events = S.timeline && S.timeline.events.length ? S.timeline.events : null;
    if (!events) {
      if (tv > fn.time + 1) finishFind();
      return;
    }
    panel.setFirstStatus(`最初のノーツが ${fn.time.toFixed(3)} 秒（位置 ${fn.lanes.join('・')}）に見えました。譜面と照らし合わせています…`);
    // 譜面と照らし合わせるのは、最初のノーツから 4 秒見てから。はっきりしなければ 15 秒まで見る
    if (tv < fn.time + 4) return;
    const m = scanner.matchChart(events, S.frame);
    if ((m && m.sure) || tv > fn.time + 15) finishFind();
  }

  // 探すのを終え、見つかった first を使う
  function finishFind() {
    S.finding = false;
    panel.setFinding(false);
    if (!S.video.paused) S.video.pause();
    const fn = scanner.firstNote();
    const events = S.timeline && S.timeline.events.length ? S.timeline.events : null;
    const m = fn && events ? scanner.matchChart(events, S.frame) : null;
    if (document.documentElement.hasAttribute('data-simai-debug')) {
      document.documentElement.setAttribute('data-simai-find', JSON.stringify({ firstNote: fn, match: m, frames: scanner.frames, skipped: scanner.skipped }));
    }
    if (!fn) {
      panel.setFirstStatus('ノーツが見つかりませんでした。③ の円と、細かい設定のハイスピが動画と合っているか確かめてください');
      return;
    }
    const seen = `${fn.time.toFixed(3)} 秒（位置 ${fn.lanes.join('・')}）`;
    if (!events) {
      applyFirst(fn.time);
      panel.setFirstStatus(`最初のノーツを ${seen} に見つけ、first にしました`);
    } else if (m && m.sure) {
      applyFirst(m.first);
      panel.setFirstStatus(`譜面の ${m.checked} ノーツと照らし合わせて、first を ${m.first.toFixed(3)} 秒にしました（最初に見えたノーツは ${seen}）。⑤ で確かめてください`);
    } else {
      applyFirst(fn.time - events[0].time);
      panel.setFirstStatus(`譜面とははっきり合わなかったので、最初に見えたノーツ ${seen} に合わせました。⑤ で確かめてください`);
    }
  }

  function applyFirst(first) {
    S.first = first;
    panel.setFirst(S.first);
    sound.reset();
    save();
    render();
  }

  // ---- 動画から下書き ----

  // 「再生して下書きを作る」: first の少し前から（first がなければ動画の頭から）最後まで再生し、コマを覚える
  function draft(bpm) {
    const v = S.video;
    if (!v) return;
    if (S.drafting) { finishDraft(); return; }
    if (S.checking) setChecking(false);
    if (S.finding) { S.finding = false; panel.setFinding(false); }
    draftScanner.reset();
    slideScanner.reset();
    touchScanner.reset();
    S.draftBpm = bpm > 0 ? bpm : null; // 空なら、拾ったノーツから推定する
    S.draftTick = 0;
    S.drafting = true;
    panel.setDrafting(true);
    panel.setDraft('');
    panel.setDraftStatus('再生しながらノーツを拾っています。途中で止めると、そこまでで下書きにします（PC が重いときは、YouTube の再生速度を 0.5 にすると確かになります）');
    v.currentTime = S.first != null ? Math.max(0, S.first - 1) : 0;
    v.play();
  }

  function draftFrame(tv) {
    const g = grabFrame();
    if (!g) return;
    if (g.error) {
      finishDraft();
      panel.setDraftStatus('この動画のコマは読めないので、下書きを作れません');
      return;
    }
    draftScanner.addFrame(g.img, g.c, tv, flowSettings());
    slideScanner.addFrame(g.img, g.c, tv);
    touchScanner.addFrame(g.img, g.c, tv, S.touch);
    if (++S.draftTick % 60 === 0) panel.setDraftStatus(`再生しながらノーツを拾っています…（${tv.toFixed(1)} 秒）。途中で止めると、そこまでで下書きにします`);
  }

  // 覚えたコマからノーツを拾い、simai の文字にする（動画が終わったとき・止めたとき）
  function finishDraft() {
    S.drafting = false;
    S.draftHidden = false;
    panel.setDrafting(false);
    if (!S.video.paused) S.video.pause();
    // ボタンのノーツ（タップ・ホールド・星）と、タッチ・タッチホールド
    const found = D.extractNotes(draftScanner).concat(touchScanner.extract()).sort((x, y) => x.time - y.time);
    if (!found.length) {
      panel.setDraftStatus('ノーツが見つかりませんでした。③ の円と、細かい設定のハイスピが動画と合っているか確かめてください');
      return;
    }
    // 曲が始まる前（タイトル画面など）と終わったあとにぽつんと拾ったノーツは捨てる。拍 0 の基準にすると、1/12 拍の丸めが全部ずれる
    const { notes, dropped, droppedEnd } = D.dropStrays(found);
    // BPM: 入っていなければ拾ったノーツから推定する。入っていても、推定とはっきり違えば知らせる（前の曲の値が残っていたなど）
    let bpmNote = '';
    const est = D.estimateBpm(notes);
    if (!S.draftBpm) {
      if (!est) { panel.setDraftStatus('BPM が分からず、ノーツも少ないので推定できませんでした。BPM を入れてからもう一度作ってください'); return; }
      S.draftBpm = est.bpm;
      panel.setBpm(est.bpm, true);
      bpmNote = `BPM は曲の情報になかったので、拾ったノーツから ${est.bpm} と推定しました（3 連符の多い曲は 1.5 倍に出ることがあります）。`;
    } else if (est && Math.abs(est.bpm / S.draftBpm - 1) > 0.01 && est.cost < D.writeCost(notes.map((x) => x.time), S.draftBpm) * 0.7) {
      bpmNote = `入っている BPM ${S.draftBpm} より、${est.bpm} の方がノーツの並びに合います。曲の BPM を確かめてください。`;
    }
    // 星から出るスライドの軌道（形・終点・流れる時間）
    const slides = root.SimaiSlideDetect.attachSlides(notes, slideScanner, 60 / S.draftBpm);
    // 拍 0 は ④ の first。決めていなければ、曲の始まりの最初のノーツ
    if (S.first == null) applyFirst(notes[0].time);
    const { text, count, shift } = D.toSimai(notes, S.draftBpm, S.first);
    const n = (f) => notes.filter(f).length;
    // 2 秒以上ノーツを拾っていない所（明るいコマを使わなかった・コマが読めなかったなど）
    const gaps = [];
    for (let i = 1; i < notes.length; i++) if (notes[i].time - notes[i - 1].time > 2) gaps.push(`${notes[i - 1].time.toFixed(1)}〜${notes[i].time.toFixed(1)} 秒`);
    const ms = Math.round(shift * 1000);
    // ① で選んだ曲があれば、先頭に曲の情報をコメントで書き、公式のノーツの数と見比べる
    const chart = currentChart();
    const comment = SDB.draftComment(S.song, chart);
    const out = comment ? `${comment}\n${text}` : text;
    let compare = '';
    if (chart && chart.notes.total) {
      const o = chart.notes;
      const tap = n((x) => x.kind === 'tap' && x.color !== 'break');
      const hold = n((x) => x.kind === 'hold' && x.color !== 'break');
      const brk = n((x) => x.color === 'break');
      compare = `公式のノーツの数と比べると（拾った / 公式）: タップ ${tap} / ${o.tap}・ホールド ${hold} / ${o.hold}・BREAK ${brk} / ${o.break}` +
        `（${[['スライド', o.slide], ['タッチ', o.touch]].filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`).join('・') || 'スライド・タッチ'} はまだ拾いません。途中で止めたときは少なくなります）。`;
    }
    const bpmInfo = S.song ? SDB.parseBpm(S.song.bpm) : null;
    if (bpmInfo && bpmInfo.changes) compare += 'この曲は途中で BPM が変わるので、変わった後の拍はずれます。';
    panel.setDraft(out);
    panel.setDraftStatus(`${count} ノーツを拾いました（タップ ${n((x) => x.kind === 'tap' && x.color !== 'star')}・ホールド ${n((x) => x.kind === 'hold')}・星 ${n((x) => x.color === 'star')}・BREAK ${n((x) => x.color === 'break')}・スライド ${slides}・タッチ ${n((x) => x.kind === 'touch')}・タッチホールド ${n((x) => x.kind === 'touchHold')}）。` +
      bpmNote +
      (dropped ? `曲が始まる前にぽつんと拾った ${dropped} ノーツ（${found[0].time.toFixed(1)} 秒など）は、タイトル画面などとみなして捨てました。` : '') +
      (droppedEnd ? `曲が終わったあとにぽつんと拾った ${droppedEnd} ノーツ（${found[found.length - 1].time.toFixed(1)} 秒など）も捨てました。` : '') +
      (ms ? `拾った時刻が first から ${Math.abs(ms)} ms ${ms < 0 ? '早かった' : '遅かった'}ので、拍に合わせました。` : '') +
      (draftScanner.skipped ? `明るすぎて使わなかったコマ ${draftScanner.skipped} / ${draftScanner.frames}。` : '') +
      (gaps.length ? `ノーツを拾えなかった所: ${gaps.join('、')}。` : '') +
      compare + '「② に入れて重ねる」で動画と重ねて確かめ、違う所を直してください');
    if (document.documentElement.hasAttribute('data-simai-debug')) {
      document.documentElement.setAttribute('data-simai-draft', JSON.stringify({ text: out, frames: draftScanner.frames, used: draftScanner.recs.length, skipped: draftScanner.skipped, shift }));
    }
  }

  function useDraft(text) {
    if (!text.trim()) return;
    panel.setText(text);
    loadSimai(text);
    save();
    render();
    panel.setDraftStatus('② に入れました。⑤「再生して確かめる」で、重ならないノーツ（×）を探して直してください');
  }

  // ---- 円の自動検出 ----

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const BRIGHT_SCENE = 0.12; // 白い点がこの割合より多いコマは、譜面の画面ではない

  // 動画のコマを小さな canvas に写し、白い判定線を探す。再生中なら何コマか重ねて、動くノーツを消す
  async function detectCircle() {
    const video = S.video;
    if (!video || video.readyState < 2 || !video.videoWidth) return { error: '動画がまだ読み込まれていません', retry: true };
    if (YT.isAdShowing()) return { error: '広告が終わってから押してください', retry: true };
    const scale = Math.min(1, 480 / video.videoHeight);
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const masks = [];
    const frames = video.paused ? 1 : 6;
    for (let i = 0; i < frames; i++) {
      if (i > 0) await wait(150);
      ctx.drawImage(video, 0, 0, w, h);
      let img;
      try {
        img = ctx.getImageData(0, 0, w, h);
      } catch (e) {
        return { error: 'この動画のコマは読めませんでした。「手で合わせる」で合わせてください' };
      }
      const mask = CD.whiteMask(img.data, w, h);
      // 曲の始まる前の明るい画面（タイトルなど）は使わない
      if (CD.whiteRatio(mask) <= BRIGHT_SCENE) masks.push(mask);
    }
    if (!masks.length) return { error: 'まだ譜面の画面ではないようです。ノーツが流れている所で「自動で探す」を押してください', retry: true };
    const ring = CD.detectRing(CD.combineMasks(masks, 0.6), w, h);
    if (!ring) return { error: '白い判定線が見つかりませんでした。「手で合わせる」で合わせてください' };
    // 割合で持つ（cx は幅、cy と r は高さに対する割合）
    return { calib: { cx: ring.cx / w, cy: ring.cy / h, r: ring.r / h } };
  }

  async function autoCircle() {
    if (S.calibrating || S.detecting) return { error: '' };
    S.detecting = true;
    panel.setCalibStatus('円を探しています…');
    const res = await detectCircle().finally(() => { S.detecting = false; });
    if (res.error) {
      panel.setCalibStatus(res.error);
      return res;
    }
    S.calib = res.calib;
    S.calibSaved = true;
    S.guide = true; // 合っているか見て確かめられるように
    panel.setToggles(S.show, S.guide);
    panel.setCalibStatus(`円を見つけました（中心 ${res.calib.cx.toFixed(3)}, ${res.calib.cy.toFixed(3)}、半径 ${res.calib.r.toFixed(3)}）。ずれていれば「手で合わせる」で直せます`);
    save();
    saveDefaults();
    render();
    return res;
  }

  // この動画の円がまだ保存されていなければ、自動で探す。動画の読み込みや広告を待って、何度か試す
  async function autoCircleIfNew() {
    const id = S.videoId;
    for (let i = 0; i < 30 && S.active && S.videoId === id && !S.calibSaved; i++) {
      const res = await autoCircle();
      if (!res.retry) return;
      await wait(1000);
    }
  }

  // ---- 位置合わせ ----

  function startCalibration() {
    if (!S.video) return;
    S.calibrating = true;
    S.show = true;
    panel.setToggles(S.show, S.guide);
    render();
    calibration.start(S.calib);
  }

  // ---- オン / オフ ----

  async function activate() {
    if (S.active) return;
    if (!bindVideo()) {
      alert('この画面では動画が見つかりませんでした。動画のページで押してください。');
      return;
    }
    S.active = true;
    S.videoId = YT.currentVideoId();
    // 保存済みの設定を読み終えてからパネルを出す（先に貼った simai が上書きされないように）
    await loadSettings(S.videoId);
    panel.setToggles(S.show, S.guide);
    panel.setFrame(S.frame);
    panel.mount();
    render();
    autoCircleIfNew();
    if (!S.song) guessSong(true); // 前に曲の情報を読んでいれば、動画のタイトルから曲を選んでおく
  }

  function deactivate() {
    if (!S.active) return;
    calibration.stop();
    S.active = false;
    unbindVideo();
    overlay.detach();
    panel.unmount();
  }

  function toggle() {
    if (S.active) deactivate(); else activate();
  }

  // 別の動画へ移動したら、層と設定を切り替える
  YT.onNavigate(async () => {
    if (!S.active) return;
    calibration.stop();
    const id = YT.currentVideoId();
    if (!id) { deactivate(); return; }
    if (!bindVideo()) return;
    if (id !== S.videoId) {
      S.videoId = id;
      S.diffs = [];
      await loadSettings(id);
      autoCircleIfNew();
      if (!S.song) guessSong(true);
    }
    render();
  });

  // [ ] で first を ±1 コマ、Shift を押しながら（{ }）で ±10 コマ。YouTube はこのキーを使っていない
  window.addEventListener('keydown', (ev) => {
    if (!S.active || S.calibrating || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = ev.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    const n = { '[': -1, ']': 1, '{': -10, '}': 10 }[ev.key];
    if (!n) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    nudge(n);
  }, true);

  document.addEventListener('fullscreenchange', () => {
    if (!S.active) return;
    panel.mount();
    render();
  });
  window.addEventListener('resize', () => render());

  // 下書きの最中にタブが隠れると、コマが 2 秒に 1 つほどしか来なくなり、その間のノーツをまるごと拾えない
  // （チエルカ／エソテリカで 19 秒の空白）。隠れたら一時停止し、戻ったら続きから拾う
  document.addEventListener('visibilitychange', () => {
    if (!S.drafting || !S.video) return;
    if (document.hidden) {
      if (S.video.paused) return;
      S.draftHidden = true;
      S.video.pause();
      panel.setDraftStatus('タブが隠れたので一時停止しました。このタブに戻ると、続きから拾います');
    } else if (S.draftHidden) {
      S.draftHidden = false;
      S.lastMediaTime = null;
      S.video.play();
      panel.setDraftStatus('再生しながらノーツを拾っています。途中で止めると、そこまでで下書きにします');
    }
  });

  if (root.chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'toggle') toggle();
    });
  }

  // 動作確認用（ページのコンソールからは見えない。拡張機能の content script の中だけ）
  root.SimaiOverlayApp = { toggle, activate, deactivate, state: S };
})(globalThis);
