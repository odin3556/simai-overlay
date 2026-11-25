// アンサー音。叩く時刻に短い音を鳴らす。音はすべてこの中で作る（公式の効果音は使わない）。
// 動画の再生位置を時計にし、少し先までの音を Web Audio の時刻に直して予約する。
(function (root) {
  'use strict';

  const LOOKAHEAD = 0.15; // 何秒先まで予約するか（動画の時間で）

  class AnswerSound {
    constructor() {
      this.ctx = null;
      this.gain = null;
      this.volume = 0.5;
      this.offset = 0; // 秒。正なら遅らせる
      this.hits = []; // [{ time, isBreak }]（譜面の時刻、同じ時刻は 1 つ）
      this.next = 0; // 次に予約する hits の位置
      this.lastT = null;
      this.pending = [];
    }

    // AudioContext は、ボタンなどを押した流れの中でないと音が出ないことがある
    enable() {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.gain = this.ctx.createGain();
        this.gain.gain.value = this.volume;
        this.gain.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    setVolume(v) {
      this.volume = v;
      if (this.gain) this.gain.gain.value = v;
    }

    // 時刻表（events）から、鳴らす時刻の一覧を作る。スライドの軌道とホールドの終わりは鳴らさない
    setEvents(events) {
      const map = new Map();
      for (const e of events || []) {
        if (e.kind === 'slide') continue;
        const key = Math.round(e.time * 1e6);
        const h = map.get(key) || { time: e.time, isBreak: false };
        if (e.isBreak) h.isBreak = true;
        map.set(key, h);
      }
      this.hits = [...map.values()].sort((a, b) => a.time - b.time);
      this.reset();
    }

    // 一時停止・シークのとき。予約済みの音を止め、次の位置を探し直す
    reset() {
      for (const n of this.pending) {
        try { n.stop(); } catch (e) { /* もう鳴り終わった */ }
      }
      this.pending = [];
      this.lastT = null;
    }

    // 再生中、新しいコマが出るたびに呼ぶ。t = 譜面の時刻（秒）、rate = 再生速度
    update(t, rate) {
      if (!this.ctx || this.ctx.state !== 'running' || !this.hits.length) return;
      // 戻った・大きく飛んだときは探し直す
      if (this.lastT == null || t < this.lastT - 0.01 || t > this.lastT + 0.5) {
        this.reset();
        this.next = lowerBound(this.hits, t);
      }
      this.lastT = t;
      const now = this.ctx.currentTime;
      while (this.next < this.hits.length && this.hits[this.next].time <= t + LOOKAHEAD * rate) {
        const h = this.hits[this.next++];
        const when = now + (h.time - t) / rate + this.offset;
        if (when < now - 0.03) continue; // 間に合わなかった音は鳴らさない
        this.click(Math.max(now, when), h.isBreak);
      }
      this.pending = this.pending.filter((n) => n._end > now);
    }

    click(when, isBreak) {
      const ctx = this.ctx;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, when);
      env.gain.linearRampToValueAtTime(isBreak ? 1 : 0.7, when + 0.002);
      env.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
      env.connect(this.gain);
      for (const f of isBreak ? [1320, 1980] : [1760]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = f;
        osc.connect(env);
        osc.start(when);
        osc.stop(when + 0.07);
        osc._end = when + 0.07;
        this.pending.push(osc);
      }
    }
  }

  function lowerBound(hits, t) {
    let lo = 0, hi = hits.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (hits[mid].time < t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  root.SimaiSound = { AnswerSound };
})(globalThis);
