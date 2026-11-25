// 拍の位置を秒に直す。BPM が途中で変わるときは、区間ごとに秒を積み上げる。
// 秒は「譜面の始まり（拍 0）」からの値。動画の時刻にするには first を足す。
(function (root) {
  'use strict';

  // bpmEvents: [{ beat, bpm }]（拍の順）から、拍→秒の変換表を作る。
  function buildTempoMap(bpmEvents) {
    const events = bpmEvents.length ? bpmEvents.slice().sort((a, b) => a.beat - b.beat) : [{ beat: 0, bpm: 120 }];
    const map = [];
    let sec = 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (i > 0) {
        const prev = map[map.length - 1];
        sec = prev.sec + ((e.beat - prev.beat) * 60) / prev.bpm;
      }
      // 同じ拍に BPM が 2 回書かれたら、後のほうを使う
      if (map.length && map[map.length - 1].beat === e.beat) map.pop();
      map.push({ beat: e.beat, bpm: e.bpm, sec });
    }
    return map;
  }

  function segmentAt(map, beat) {
    let s = map[0];
    for (const m of map) {
      if (m.beat <= beat) s = m; else break;
    }
    return s;
  }

  function beatToSec(map, beat) {
    const s = segmentAt(map, beat);
    return s.sec + ((beat - s.beat) * 60) / s.bpm;
  }

  function secToBeat(map, sec) {
    let s = map[0];
    for (const m of map) {
      if (m.sec <= sec) s = m; else break;
    }
    return s.beat + ((sec - s.sec) * s.bpm) / 60;
  }

  // 長さ（拍）を秒にする。[bpm#n:m] のように BPM が書かれていれば、それを使う。
  function durationToSec(map, startBeat, duration) {
    if (duration && duration.sec != null) return duration.sec; // [#秒] [bpm#秒] [待ち##秒]
    if (!duration || !duration.beats) return 0;
    if (duration.bpm) return (duration.beats * 60) / duration.bpm;
    return beatToSec(map, startBeat + duration.beats) - beatToSec(map, startBeat);
  }

  // parse() の結果に秒を付けた「時刻表」を作る。
  //   time    … 叩く時刻（秒、first なし）
  //   endTime … ホールドの終わり／スライドの終わり（秒）
  // スライドの軌道は、星を叩いてから 1 拍待って動き出す（simai の決まり）。
  // 待ち時間は [待ち##…] なら秒で、[bpm#…] ならその BPM の 1 拍。
  // 連結スライドで区切りごとに長さがあれば segTimes に区切りごとの秒を入れる（星は区切りごとの速さで進む）。
  // 疑似 EACH（1`2）の delaySec は時刻に足す。
  function buildTimeline(parsed) {
    const map = buildTempoMap(parsed.bpmEvents);
    const events = parsed.notes.map((n) => {
      const time = beatToSec(map, n.beat) + (n.delaySec || 0);
      const e = Object.assign({}, n, { time, endTime: time });
      if (n.kind === 'hold' || n.kind === 'touchHold') {
        e.endTime = time + durationToSec(map, n.beat, n.hold);
      } else if (n.kind === 'slide') {
        const d = n.duration;
        const wait = d.waitSec != null ? d.waitSec : d.waitBpm ? 60 / d.waitBpm : beatToSec(map, n.beat + 1) - beatToSec(map, n.beat);
        e.slideStart = time + wait;
        const moveFrom = secToBeat(map, e.slideStart - (n.delaySec || 0));
        if (n.perSegment) {
          e.segTimes = n.segments.map((s) => durationToSec(map, moveFrom, s.duration));
          e.endTime = e.slideStart + e.segTimes.reduce((a, b) => a + b, 0);
        } else {
          e.endTime = e.slideStart + durationToSec(map, moveFrom, d);
        }
      }
      return e;
    });
    events.sort((a, b) => a.time - b.time);
    markEach(events);
    return { tempoMap: map, events, endTime: beatToSec(map, parsed.endBeat) };
  }

  // 同時押し: 同じ時刻に、スライドの軌道以外のノーツが 2 つ以上あるもの（黄色で描く）
  function markEach(events) {
    const count = new Map();
    const key = (e) => Math.round(e.time * 1e6);
    for (const e of events) if (e.kind !== 'slide') count.set(key(e), (count.get(key(e)) || 0) + 1);
    // 1 つの星から 2 本以上出るスライド（1-4[4:3]*-6[8:5]）も EACH（書式のページより）
    for (const e of events) e.isEach = e.kind !== 'slide' && (count.get(key(e)) >= 2 || !!e.multiSlide);
    // 同時押しの星から出る軌道も黄色で描く（動画で確かめた）。isEach は数えに使うので、別の印にする
    for (const e of events) if (e.kind === 'slide') e.eachSlide = count.get(key(e)) >= 2 || !!e.multiSlide;
  }

  // 時刻順の一覧から、[from, to] に入る最初の位置を二分探索で探す。
  function lowerBound(events, t) {
    let lo = 0, hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid].time < t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  function eventsBetween(events, from, to) {
    const out = [];
    for (let i = lowerBound(events, from); i < events.length && events[i].time <= to; i++) out.push(events[i]);
    return out;
  }

  // 「いまの小節・拍」（パネル表示用）。秒は first を引いた値を渡す。
  function positionAt(map, sec) {
    const beat = secToBeat(map, sec);
    const measure = Math.floor(beat / 4) + 1;
    return { beat, measure, beatInMeasure: beat - (measure - 1) * 4 };
  }

  // 「いま simai のどこか」（再生中に出す用）。text: simai の文字、cells: parse() の cells、beat: いまの拍。
  // 返り値: { line（1 から）, start, end（いまの区切りの文字の位置）, before, cell, after（いまの行を区切りの前・区切り・後ろに分けた文字）}。
  // 最初の区切りより前なら null
  function locate(text, cells, beat) {
    if (!cells || !cells.length || beat < cells[0].beat - 1e-9) return null;
    let lo = 0, hi = cells.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cells[mid].beat <= beat + 1e-9) lo = mid; else hi = mid - 1;
    }
    // 同じ拍の区切りが続くとき（{#秒} を使わない限りないが念のため）は最後のもの
    const c = cells[lo];
    // 区切りの頭の改行やコメント（|| から行の終わりまで）は飛ばして、文字のある所からを区切りとする
    let start = c.start;
    for (;;) {
      while (start < c.end && /\s/.test(text[start])) start++;
      if (!text.startsWith('||', start)) break;
      const nl = text.indexOf('\n', start);
      start = nl < 0 ? c.end : Math.min(nl, c.end);
    }
    const end = Math.max(start, c.end);
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', start);
    if (lineEnd < 0) lineEnd = text.length;
    const cellEnd = Math.min(end + 1, lineEnd); // 区切りの後ろのカンマまで含める
    let line = 1;
    for (let i = 0; i < lineStart; i++) if (text.charCodeAt(i) === 10) line++;
    return {
      line, start, end: cellEnd,
      before: text.slice(lineStart, start),
      cell: text.slice(start, cellEnd),
      after: text.slice(cellEnd, lineEnd),
    };
  }

  const api = { buildTempoMap, beatToSec, secToBeat, durationToSec, buildTimeline, lowerBound, eventsBetween, positionAt, locate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SimaiTiming = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
