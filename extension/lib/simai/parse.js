// simai の譜面本体を読み、拍の位置つきのノーツ一覧にする。
// 拡張機能（content script）では globalThis.SimaiParse、Node では require() で使う。
(function (root) {
  'use strict';

  // スライドの形。長いものから順に試す（pp を p より先に）。
  const SLIDE_SHAPES = ['pp', 'qq', '-', '^', '<', '>', 'v', 'p', 'q', 's', 'z', 'w', 'V'];

  // 長さの書き方（simai 語の譜面書式 https://w.atwiki.jp/simai/pages/1002.html）:
  //   [n:m]        … m × 4 ÷ n 拍
  //   [bpm#n:m]    … BPM bpm での n 分 m 個
  //   [#秒]        … 秒で（ホールド）
  // スライドだけに使えるもの（星が動き出すまでの待ち時間も決める）:
  //   [bpm#秒]     … BPM bpm の 1 拍待って、秒かけて動く
  //   [待ち##秒] [待ち##n:m] [待ち##bpm#n:m] … 待ち時間を秒で
  // 返り値 { beats, bpm, sec, waitSec, waitBpm }。sec があれば beats より先に使う
  const DUR_RE = /^(?:(\d+(?:\.\d+)?)##)?(?:(\d+(?:\.\d+)?)#)?(?:(\d+):(\d+)|(\d+(?:\.\d+)?))$/;
  function parseDuration(body, warn, slide) {
    const d = { beats: 0, bpm: null, sec: null, waitSec: null, waitBpm: null };
    let m;
    if ((m = /^#(\d+(?:\.\d+)?)$/.exec(body))) { d.sec = Number(m[1]); return d; }
    if ((m = DUR_RE.exec(body)) && (m[3] || (slide && m[5] != null && (m[1] || m[2])))) {
      if (m[1] && !slide) { warn(`ホールドに待ち時間 [${body}] は書けません`); return d; }
      if (m[3]) d.beats = (Number(m[4]) * 4) / Number(m[3]);
      else d.sec = Number(m[5]);
      if (m[2]) d.bpm = Number(m[2]);
      if (slide) {
        if (m[1]) d.waitSec = Number(m[1]);
        else if (m[2]) d.waitBpm = Number(m[2]);
      }
      if (d.sec != null && m[2]) d.bpm = null; // [bpm#秒] の bpm は待ち時間だけに使う
      return d;
    }
    warn(`未対応の長さ [${body}]`);
    return d;
  }

  // 長さを書かないホールド（3h, Ch）は [1280:1]（書式のページより）
  const SHORT_HOLD = () => ({ beats: 4 / 1280, bpm: null, sec: null, waitSec: null, waitBpm: null });

  // タッチ: A1〜A8, B1〜B8, C / C1 / C2, D1〜D8, E1〜E8。末尾の f は演出の印、h[..] はタッチホールド。
  const TOUCH_RE = /^([ABDE])([1-8])|^(C)([12])?/;

  function parseTouch(src, warn) {
    const m = TOUCH_RE.exec(src);
    const note = { kind: 'touch', area: m[1] || m[3], pos: m[2] ? Number(m[2]) : null, firework: false, hold: null, isBreak: false, isEx: false };
    let rest = src.slice(m[0].length);
    while (rest.length) {
      const c = rest[0];
      if (c === 'f') { note.firework = true; rest = rest.slice(1); }
      else if (c === 'b') { note.isBreak = true; rest = rest.slice(1); }
      else if (c === 'x') { note.isEx = true; rest = rest.slice(1); }
      else if (c === 'h') { note.kind = 'touchHold'; rest = rest.slice(1); }
      else if (c === '[' && note.kind === 'touchHold' && !note.hold) {
        // Chf[1:1] のように h と [長さ] の間に f が入ってもよい
        const d = /^\[([^\]]*)\]/.exec(rest);
        if (!d) { warn(`タッチホールドの長さが読めない（${src}）`); break; }
        note.hold = parseDuration(d[1], warn);
        rest = rest.slice(d[0].length);
      } else { warn(`タッチの読めない文字 "${rest}"（${src}）`); break; }
    }
    if (note.kind === 'touchHold' && !note.hold) note.hold = SHORT_HOLD();
    return [note];
  }

  // 位置ボタンから始まるノーツ（タップ・ホールド・スライド）。
  // 印（どの順で書いてもよい）: b BREAK, x EX, $ 星形, $$ 回る星形, @ スライドの始点を丸いタップに,
  // ? 星なしスライド（動く星はフェードイン）, ! 星なしスライド（動き出すまで星を出さない）
  function parseButton(src, warn) {
    const notes = [];
    let i = 0;
    const pos = Number(src[i++]);
    const head = { kind: 'tap', pos, isBreak: false, isEx: false, star: false, spin: false, starless: false };
    let dollars = 0, plain = false, starMode = null;

    const marks = () => {
      while (i < src.length && 'bx$?!@'.includes(src[i])) {
        const c = src[i++];
        if (c === 'b') head.isBreak = true;
        else if (c === 'x') head.isEx = true;
        else if (c === '$') dollars++;
        else if (c === '@') plain = true;
        else { head.starless = true; starMode = c; }
      }
    };
    marks();

    // ホールド（7bxh[2:1] のように印が h の前後どちらにあってもよい）
    if (src[i] === 'h') {
      i++;
      marks();
      head.kind = 'hold';
      head.hold = SHORT_HOLD();
      const d = /^\[([^\]]*)\]/.exec(src.slice(i));
      if (d) { head.hold = parseDuration(d[1], warn); i += d[0].length; }
      marks();
      if (dollars) warn(`ホールドに $ は付けられません（${src}）`);
      if (i < src.length) warn(`ホールドの後ろに読めない文字 "${src.slice(i)}"（${src}）`);
      notes.push(head);
      return notes;
    }
    head.star = dollars >= 1;
    head.spin = dollars >= 2;

    // スライド（* で同じ始点の軌道を続ける）
    const tracks = [];
    let rest = src.slice(i);
    let first = true;
    while (rest.length) {
      if (!first) {
        if (rest[0] !== '*') break;
        rest = rest.slice(1);
      }
      const t = parseTrack(rest, pos, warn, src);
      if (!t) break;
      tracks.push(t.track);
      rest = rest.slice(t.used);
      first = false;
    }
    if (rest.length) warn(`読めない文字 "${rest}"（${src}）`);

    if (tracks.length) {
      // スライドの始点は星形（@ なら丸いタップ）。1 つの星から 2 本以上出るときは EACH 扱い
      head.star = !plain;
      head.slideHead = true;
      head.multiSlide = tracks.length >= 2;
      for (const t of tracks) {
        t.starMode = starMode;
        t.multiSlide = head.multiSlide;
        notes.push(t);
      }
    } else if (head.starless || plain) {
      warn(`? ! @ はスライドの始点にだけ付けます（${src}）`);
      head.starless = false;
    }
    if (!head.starless) notes.unshift(head);
    return notes;
  }

  // 1 本の軌道: 形と点を 1 回以上（例 -6-1、V28）、続けて [長さ]、最後に b / x。
  // 連結スライドは区切りごとに長さを書いてもよい（1-4[2:1]q7[2:1]-2[1:1]）。そのときは全部に書く
  function parseTrack(s, startPos, warn, whole) {
    let i = 0;
    const segments = [];
    let perSegment = 0;
    while (i < s.length) {
      const shape = SLIDE_SHAPES.find((sh) => s.startsWith(sh, i));
      if (!shape) break;
      i += shape.length;
      const n = shape === 'V' ? 2 : 1; // V は折れる点と終点の 2 つ
      const pts = s.slice(i, i + n);
      if (!new RegExp(`^[1-8]{${n}}$`).test(pts)) { warn(`スライドの点が読めない（${whole}）`); return null; }
      const seg = { shape, points: pts.split('').map(Number) };
      segments.push(seg);
      i += n;
      // 後ろにまだ形が続く [長さ] は、その区切りだけの長さ
      const d = /^\[([^\]]*)\]/.exec(s.slice(i));
      if (d && SLIDE_SHAPES.some((sh) => s.startsWith(sh, i + d[0].length))) {
        seg.duration = parseDuration(d[1], warn, true);
        perSegment++;
        i += d[0].length;
      }
    }
    if (!segments.length) return null;
    const track = { kind: 'slide', start: startPos, segments, end: segments[segments.length - 1].points.slice(-1)[0], duration: null, isBreak: false, isEx: false };
    const d = /^\[([^\]]*)\]/.exec(s.slice(i));
    if (d) { track.duration = parseDuration(d[1], warn, true); i += d[0].length; }
    else { warn(`スライドの長さがない（${whole}）`); track.duration = parseDuration('1:0', () => {}, true); }
    if (perSegment) {
      if (perSegment !== segments.length - 1) warn(`連結スライドの長さは全部の区切りに書きます（${whole}）`);
      else {
        segments[segments.length - 1].duration = track.duration;
        track.perSegment = true;
        // 星が動き出すまでの待ち時間は、最初の区切りの書き方で決める
        track.duration = Object.assign({}, track.duration, { waitSec: segments[0].duration.waitSec, waitBpm: segments[0].duration.waitBpm });
      }
    }
    while (i < s.length && 'bx'.includes(s[i])) {
      if (s[i] === 'b') track.isBreak = true; else track.isEx = true;
      i++;
    }
    return { track, used: i };
  }

  // 疑似 EACH（1`2）: ` の後ろは 0.001 秒ずつ遅らせる。同時ではないので EACH（黄色）にならない
  const PSEUDO_EACH_SEC = 0.001;

  // 1 つの区切り（カンマの間）の中身をノーツにする。
  function parseGroup(src, warn) {
    const notes = [];
    src.split('`').forEach((each, k) => {
      for (const part of each.split('/')) {
        const p = part.trim();
        if (!p) continue;
        const got = [];
        // 18 のような数字だけの並び → それぞれ単独のタップ
        if (/^[1-8]{2,}$/.test(p)) {
          for (const c of p) got.push({ kind: 'tap', pos: Number(c), isBreak: false, isEx: false, star: false, spin: false, starless: false });
        } else if (/^[1-8]/.test(p)) {
          got.push(...parseButton(p, warn));
        } else if (TOUCH_RE.test(p)) {
          got.push(...parseTouch(p, warn));
        } else {
          warn(`読めないノーツ "${p}"`);
        }
        for (const n of got) n.delaySec = k * PSEUDO_EACH_SEC;
        notes.push(...got);
      }
    });
    return notes;
  }

  function gcd(a, b) {
    while (b) [a, b] = [b, a % b];
    return a;
  }

  // 本体。返り値:
  //   notes      … { kind, beat, measure, beatInMeasure, srcIndex, ... } の時刻順の一覧
  //   bpmEvents  … [{ beat, bpm }]
  //   endBeat    … E の位置（拍）
  //   cells      … 区切り（カンマの間）ごとの { beat, start, end }。start・end は text の中の文字の位置
  //   counts     … 公式と見比べる数
  //   warnings   … 未対応の記法など
  function parse(text) {
    const warnings = [];
    const notes = [];
    const bpmEvents = [];
    let beat = 0;
    let divisor = 4; // {n}
    let endBeat = null;
    let srcIndex = 0;
    // 拍の位置は分数（num / den）で積み上げる。{96} などで浮動小数の誤差がたまらないようにするため。
    let num = 0, den = 1;
    let extra = 0; // {#秒} で進んだ拍
    let stepSec = null; // {#秒} の秒（{n} に戻すと null）
    let bpm = null; // いまの BPM（{#秒} を拍に直すため）

    // ヘッダー行（&title= など）は v0.1 では読まない
    if (/^\s*&/m.test(text)) warnings.push('&で始まるヘッダー行は読みません。譜面本体だけを貼ってください');

    // || 以降はコメント。同じ長さの空白にして、区切りの位置（srcIndex）が元の文字の位置のままになるようにする
    const body = text.replace(/\|\|[^\n]*/g, (m) => ' '.repeat(m.length));
    const cells = body.split(',');
    const cellList = []; // 区切りごとの { beat, start, end }（元の文字の位置）。再生中に「いまどこか」を出すのに使う
    let offset = 0;

    for (const raw of cells) {
      srcIndex = offset;
      offset += raw.length + 1;
      let s = raw.replace(/\s+/g, '');
      const warn = (msg) => warnings.push(`${msg}（${s || '空'}・${(beat / 4 + 1).toFixed(2)} 小節目付近）`);

      // 先頭の (BPM) と {刻み} を順に読む
      for (;;) {
        let m;
        if ((m = /^\((\d+(?:\.\d+)?)\)/.exec(s))) {
          bpmEvents.push({ beat, bpm: Number(m[1]) });
          s = s.slice(m[0].length);
          bpm = Number(m[1]);
        } else if ((m = /^\{(\d+(?:\.\d+)?)\}/.exec(s))) {
          divisor = Number(m[1]);
          stepSec = null;
          s = s.slice(m[0].length);
        } else if ((m = /^\{#(\d+(?:\.\d+)?)\}/.exec(s))) {
          stepSec = Number(m[1]); // これ以降、カンマ 1 つが stepSec 秒
          s = s.slice(m[0].length);
        } else break;
      }

      if (s === 'E') { endBeat = beat; break; }
      cellList.push({ beat, start: srcIndex, end: srcIndex + raw.length });

      if (s) {
        const measure = Math.floor(beat / 4 + 1e-9) + 1;
        const beatInMeasure = beat - (measure - 1) * 4;
        for (const n of parseGroup(s, warn)) {
          n.beat = beat;
          n.measure = measure;
          n.beatInMeasure = beatInMeasure;
          n.srcIndex = srcIndex;
          notes.push(n);
        }
      }
      if (stepSec != null) {
        // {#秒}: その時の BPM で拍に直して足す（分数にはできないので別に積む）
        extra += (stepSec * (bpm || 120)) / 60;
        beat = num / den + extra;
        continue;
      }
      // 4 ÷ divisor を足す。{2.5} のような小数は 10 のべき乗で分数にする
      const scale = 10 ** ((String(divisor).split(".")[1] || "").length);
      const dNum = Math.round(divisor * scale);
      num = num * dNum + 4 * scale * den;
      den = den * dNum;
      const g = gcd(num, den);
      num /= g; den /= g;
      beat = num / den + extra;
    }

    if (!bpmEvents.length) warnings.push('先頭に (BPM) がありません');
    if (endBeat === null) { warnings.push('終わりの E がありません'); endBeat = beat; }

    return { notes, bpmEvents, endBeat, cells: cellList, counts: countNotes(notes), warnings };
  }

  // 公式と同じ数え方:
  //   スライドの始点の星はタップ 1 つ、軌道はスライド 1 つ。
  //   タッチホールドはホールドに数える（リザルトでも HOLD。書式のページより）。
  //   BREAK の付いたものは、元の種類ではなく Break に数える。
  function countNotes(notes) {
    const c = { total: 0, tap: 0, hold: 0, slide: 0, touch: 0, break: 0 };
    for (const n of notes) {
      if (n.isBreak) c.break++;
      else if (n.kind === 'tap') c.tap++;
      else if (n.kind === 'hold' || n.kind === 'touchHold') c.hold++;
      else if (n.kind === 'slide') c.slide++;
      else if (n.kind === 'touch') c.touch++;
      c.total++;
    }
    return c;
  }

  const api = { parse, countNotes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SimaiParse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
