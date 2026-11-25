// 動画の映像部分にぴったり重なる透明な層と、そこへの描画。
// 図形はすべて自作。動画のノーツが下に透けて見えるよう、輪郭で描く。
(function (root) {
  'use strict';

  const G = root.SimaiGeometry;
  const F = root.SimaiFlash;

  // 色は後から変えられるよう、ここにまとめる（maimai でらっくすの色分けに寄せる）
  const COLORS = {
    tap: '#ff6fb1', // タップ・ホールド: ピンク
    star: '#4fc3ff', // スライドの始点: 青
    touch: '#4fc3ff', // タッチ: 青
    each: '#ffd84a', // 同時押し: 黄
    break: '#ff8a2a', // BREAK: オレンジ
    ex: '#ffffff', // EX: 白く光る縁
    guide: '#ff4fa3',
    ok: '#6be38a', // 重なりの確認: 重なった
    ng: '#ff4040', // 重なりの確認: 重ならなかった
  };
  const MARK_SEC = 0.45; // ○ × を出しておく秒数
  const HUD_SIDE = 24; // 動画の左上に出す行で、いまの区切りの前後に出す文字の数
  const RAINBOW = ['#ff5a5a', '#ffd84a', '#5ae07a', '#4fc3ff']; // タッチホールドの 4 つの三角
  const CHEVRON_GAP = 0.08; // スライドの矢印の間隔（判定線の半径に対する割合）
  const CHEVRON_SIZE = 0.06; // スライドの矢印の腕の長さ（動画の矢印は星とほぼ同じ幅の帯。以前の 0.035 では半分以下だった）
  const TOUCH_FAR = 0.072; // タッチの三角: 寄り始める前の、中心からの距離（判定線の半径に対する割合）
  const TOUCH_NEAR = 0.03; // タッチの三角: 寄りきったときの距離
  const S = root.SimaiSlide;
  const SN = root.SimaiSensors;

  class Overlay {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'simai-overlay-layer';
      this.ctx = this.canvas.getContext('2d');
      this.w = 0; // 映像部分の大きさ（CSS px）
      this.h = 0;
      this.player = null;
      this.video = null;
      this._key = '';
    }

    attach(player, video) {
      this.player = player;
      this.video = video;
      if (this.canvas.parentNode !== player) player.appendChild(this.canvas);
      this._key = '';
      this.layout();
    }

    detach() {
      this.canvas.remove();
      this.player = null;
      this.video = null;
    }

    // 層の位置と大きさを、video 要素の中の映像部分（黒帯を除く）に合わせる。
    // 大きさが変わっていなければ何もしない。
    layout() {
      if (!this.player || !this.video) return false;
      const pr = this.player.getBoundingClientRect();
      const vr = this.video.getBoundingClientRect();
      const c = G.contentRect({ width: vr.width, height: vr.height }, this.video.videoWidth, this.video.videoHeight);
      const dpr = window.devicePixelRatio || 1;
      const left = vr.left - pr.left + c.x;
      const top = vr.top - pr.top + c.y;
      const key = [left, top, c.w, c.h, dpr].map((v) => Math.round(v * 10)).join(',');
      if (key === this._key) return false;
      this._key = key;
      Object.assign(this.canvas.style, { left: `${left}px`, top: `${top}px`, width: `${c.w}px`, height: `${c.h}px` });
      this.canvas.width = Math.max(1, Math.round(c.w * dpr));
      this.canvas.height = Math.max(1, Math.round(c.h * dpr));
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.w = c.w;
      this.h = c.h;
      return true;
    }

    setVisible(on) {
      this.canvas.style.display = on ? '' : 'none';
    }

    // 位置合わせ中だけクリックを受け、十字のカーソルにする。
    // YouTube はマウスを止めると操作バーを隠し、自分の CSS でカーソルを消すので、
    // CSS の順番によっては負けて十字にならないことがあった。要素に直接 !important で付けて、必ず勝つようにする
    setInteractive(on) {
      this.canvas.classList.toggle('simai-overlay-interactive', on);
      for (const [k, v] of [['cursor', 'crosshair'], ['pointer-events', 'auto']]) {
        if (on) this.canvas.style.setProperty(k, v, 'important');
        else this.canvas.style.removeProperty(k);
      }
    }

    // 層の左上からの座標（CSS px）
    pointFromEvent(ev) {
      const r = this.canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    // state:
    //   calib        … 円の設定（割合）。null なら円まわりは描かない
    //   touchRatios  … タッチの輪の比率
    //   guide        … 円と 8 つの点、タッチの輪を描く
    //   t            … 譜面の時刻（秒、first を引いた値）
    //   frame        … 1 コマの秒数
    //   flow         … { on, approach, touchApproach, appear } 流れるノーツ（秒）
    //   events       … 今の時刻の前後のノーツ
    //   holding      … 描く必要のあるホールド（流れている最中・押している最中）
    //   sliding      … 描く必要のあるスライド（軌道が出ている間）
    //   hud          … いまの場所（content.js の nowInfo の結果）。あれば動画の左上に出す
    draw(state) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      if (!state.calib) return;
      const c = G.circleToPx(state.calib, this.w, this.h);
      const ratios = state.touchRatios;
      if (state.guide) this.drawGuide(c, ratios);

      const flow = state.flow && state.flow.on ? state.flow : null;
      // 先に書いたスライドほど手前に出す（書式のページより）ので、後ろから描く
      const sliding = state.sliding || [];
      for (let i = sliding.length - 1; i >= 0; i--) this.drawSlide(c, sliding[i], state.t, flow, ratios);
      for (const e of state.holding || []) {
        if (flow || e.time <= state.t) this.drawHold(c, e, state.t, flow, ratios);
      }
      if (flow) {
        for (const e of state.events || []) {
          if (e.kind === 'slide' || e.kind === 'hold' || e.kind === 'touchHold' || e.time <= state.t) continue;
          const left = e.time - state.t;
          if (e.kind === 'touch') this.drawTouchFlow(c, e, left, flow, ratios);
          else this.drawFlow(c, e, left, flow, state.t);
        }
      }
      for (const e of state.events || []) {
        if (e.kind === 'slide') continue; // 軌道は drawSlide で描く
        const ph = F.flashPhase(state.t - e.time, state.frame);
        if (ph) this.drawFlash(c, e, ph, ratios, state.t);
      }
      if (state.verdict) {
        for (const e of state.events || []) {
          if (e.kind === 'slide') continue; // スライドは終わってから（下）
          const dt = state.t - e.time;
          if (dt < 0 || dt > MARK_SEC) continue;
          const ok = state.verdict(e);
          if (ok != null) this.drawMark(c, e, ok, 1 - dt / MARK_SEC, ratios);
        }
        for (const e of state.slideEnds || []) {
          const dt = state.t - e.endTime;
          if (dt < 0 || dt > MARK_SEC) continue;
          const ok = state.verdict(e);
          if (ok != null) this.drawMark(c, e, ok, 1 - dt / MARK_SEC, ratios);
        }
      }
      if (state.hud) this.drawHud(state.hud);
    }

    // 動画の左上に、いまの場所（再生時間・小節と拍・simai の行と、いまの区切り）を出す
    drawHud(now) {
      const ctx = this.ctx;
      const fs = Math.max(11, Math.min(16, this.h * 0.022));
      const pad = fs * 0.5;
      const m = Math.floor(Math.max(0, now.video) / 60);
      const sec = (Math.max(0, now.video) - m * 60).toFixed(2).padStart(5, '0');
      const top = `${m}:${sec}　${now.line ? `${now.measure} 小節 ${now.beat.toFixed(2)} 拍　${now.line} 行目` : '始まる前'}`;
      // いまの区切りの前後は、長ければ近い所だけ
      const before = now.before.length > HUD_SIDE ? `…${now.before.slice(-HUD_SIDE)}` : now.before;
      const after = now.after.length > HUD_SIDE ? `${now.after.slice(0, HUD_SIDE)}…` : now.after;
      ctx.save();
      ctx.font = `bold ${fs}px ui-monospace, Consolas, monospace`;
      ctx.textBaseline = 'top';
      const wTop = ctx.measureText(top).width;
      ctx.font = `${fs}px ui-monospace, Consolas, monospace`;
      const wB = ctx.measureText(before).width, wC = ctx.measureText(now.cell).width, wA = ctx.measureText(after).width;
      const lineH = fs * 1.4;
      const rows = now.line ? 2 : 1;
      const w = Math.max(wTop, wB + wC + wA) + pad * 2;
      ctx.globalAlpha = 0.78;
      ctx.fillStyle = '#000';
      ctx.fillRect(8, 8, w, lineH * rows + pad * 2 - fs * 0.4);
      ctx.globalAlpha = 1;
      ctx.font = `bold ${fs}px ui-monospace, Consolas, monospace`;
      ctx.fillStyle = '#fff';
      ctx.fillText(top, 8 + pad, 8 + pad);
      if (now.line) {
        const y = 8 + pad + lineH;
        let x = 8 + pad;
        ctx.font = `${fs}px ui-monospace, Consolas, monospace`;
        ctx.fillStyle = '#aaa';
        ctx.fillText(before, x, y);
        x += wB;
        ctx.fillStyle = COLORS.each;
        ctx.fillRect(x - 1, y - fs * 0.15, wC + 2, fs * 1.3);
        ctx.fillStyle = '#111';
        ctx.fillText(now.cell, x, y);
        x += wC;
        ctx.fillStyle = '#aaa';
        ctx.fillText(after, x, y);
      }
      ctx.restore();
    }

    // 重なりの確認の結果: 円の外側に ○（重なった）か ×（重ならなかった）。
    // タッチは区画の右上、スライドは終点のボタンの外側
    drawMark(c, e, ok, alpha, ratios) {
      const ctx = this.ctx;
      const s = c.r * 0.055;
      let pt;
      if (e.kind === 'touch' || e.kind === 'touchHold') {
        const q = G.touchPoint(c, e.area, e.pos, ratios);
        pt = { x: q.x + s * 1.8, y: q.y - s * 1.8 };
      } else pt = G.polar(c, G.buttonAngle(e.kind === 'slide' ? e.end : e.pos), c.r * 1.2);
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha * 1.5);
      ctx.lineWidth = 4;
      ctx.strokeStyle = ok ? COLORS.ok : COLORS.ng;
      ctx.beginPath();
      if (ok) ctx.arc(pt.x, pt.y, s, 0, Math.PI * 2);
      else {
        ctx.moveTo(pt.x - s, pt.y - s); ctx.lineTo(pt.x + s, pt.y + s);
        ctx.moveTo(pt.x + s, pt.y - s); ctx.lineTo(pt.x - s, pt.y + s);
      }
      ctx.stroke();
      ctx.restore();
    }

    drawGuide(c, ratios) {
      const ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = COLORS.guide;
      ctx.fillStyle = COLORS.guide;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2);
      ctx.stroke();
      // 中心の十字
      ctx.beginPath();
      ctx.moveTo(c.cx - 8, c.cy); ctx.lineTo(c.cx + 8, c.cy);
      ctx.moveTo(c.cx, c.cy - 8); ctx.lineTo(c.cx, c.cy + 8);
      ctx.stroke();
      // タッチセンサーの 34 の区画（点線）と名前
      ctx.setLineDash([3, 5]);
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.font = `${Math.max(9, c.r * 0.035)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const g of SN.regions(ratios)) {
        this.regionPath(c, g);
        ctx.stroke();
        const m = centroid(g.poly);
        ctx.fillText(g.id, c.cx + m.x * c.r, c.cy + m.y * c.r);
      }
      ctx.setLineDash([]);
      ctx.lineWidth = 1.5;
      // 8 つの点と番号
      ctx.globalAlpha = 1;
      ctx.font = `bold ${Math.max(11, c.r * 0.06)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let p = 1; p <= 8; p++) {
        const pt = G.buttonPoint(c, p);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, Math.max(3, c.r * 0.015), 0, Math.PI * 2);
        ctx.fill();
        const lb = G.polar(c, G.buttonAngle(p), c.r * 1.09);
        ctx.fillText(String(p), lb.x, lb.y);
      }
      ctx.restore();
    }

    noteColor(e) {
      if (e.isBreak) return COLORS.break;
      if (e.isEach || e.eachSlide) return COLORS.each;
      if (e.star || e.kind === 'slide') return COLORS.star;
      if (e.kind === 'touch' || e.kind === 'touchHold') return COLORS.touch;
      return COLORS.tap;
    }

    // 線の引き方をノーツの印に合わせる。
    //   BREAK … 色の線の内側に白い細線
    //   EX    … 白く光らせる
    strokeNote(e, width, alpha, color) {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (e.isEx) {
        ctx.shadowColor = COLORS.ex;
        ctx.shadowBlur = 14;
      }
      ctx.strokeStyle = color || this.noteColor(e);
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (e.isBreak) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, width * 0.3);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ---- 流れてくるノーツ ----

    // タップ・星: 中心寄りから円へ進む
    drawFlow(c, e, left, flow, t) {
      const k = F.flowRadius(left, flow);
      if (k == null) return;
      const deg = G.buttonAngle(e.pos);
      const pt = G.polar(c, deg, c.r * k);
      const size = c.r * 0.075;
      if (e.star) this.starPath(pt, size * 1.25, starRot(e, t, deg));
      else this.circlePath(pt, size);
      this.strokeNote(e, 3.5, 0.9);
    }

    // ホールド: 細長い六角形。頭は円まで進んで止まり、尾は終わりの時刻に合わせて後から進む
    drawHold(c, e, t, flow, ratios) {
      if (e.kind === 'touchHold') {
        if (flow && e.time > t) this.drawTouchFlow(c, e, e.time - t, flow, ratios);
        else if (e.time <= t) this.drawTouchHolding(c, e, ratios, t);
        return;
      }
      const deg = G.buttonAngle(e.pos);
      let head;
      let tail;
      if (flow) {
        head = F.flowRadius(e.time - t, flow);
        if (head == null) return;
        const tk = F.flowRadius(e.endTime - t, flow);
        tail = tk == null ? flow.appear : tk;
      } else {
        // 流れるノーツを出さないときは、押している間だけ円の上に短く描く
        head = 1;
        tail = 0.9;
      }
      const size = c.r * 0.075;
      this.hexPath(c, deg, c.r * tail, c.r * head, size);
      this.strokeNote(e, 3.5, 0.9);
    }

    // タッチ: 4 つの三角が外から寄ってくる。終わり近くで速くなる（F.touchEase）。
    // 三角は画面の上下左右（右・下・左・上）。叩く 0.45 秒前で中心から判定線の半径の 0.072 倍、寄りきって 0.03 倍
    // （チエルカ／エソテリカの動画で測った。以前は HachimiDX の値で斜めに置いていたが、動画とは向きが違った）
    // タッチホールドは、4 つの三角を虹の色（赤・黄・緑・青）で描く
    drawTouchFlow(c, e, left, flow, ratios) {
      const total = flow.touchApproach;
      if (left > total) return;
      const pt = G.touchPoint(c, e.area, e.pos, ratios);
      const size = c.r * 0.045;
      const moved = F.touchEase(1 - Math.max(0, left) / total);
      const d = c.r * (TOUCH_NEAR + (TOUCH_FAR - TOUCH_NEAR) * (1 - moved));
      const rainbow = e.kind === 'touchHold' && !e.isBreak;
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        this.trianglePath({ x: pt.x + d * Math.cos(a), y: pt.y + d * Math.sin(a) }, size, a + Math.PI);
        this.strokeNote(e, 2.5, 0.9, rainbow ? RAINBOW[i] : null);
      }
      this.circlePath(pt, c.r * 0.012);
      this.strokeNote(e, 2, 0.9);
    }

    // タッチホールドを押している間: 寄りきった虹の三角のまわりを、4 色の大きな◆が真上から時計回りに形作っていき、
    // ◆ができあがる時刻がホールドの終わり（書式のページ 509 より）。押している区画もうすく塗る
    drawTouchHolding(c, e, ratios, t) {
      const pt = G.touchPoint(c, e.area, e.pos, ratios);
      const size = c.r * 0.045;
      const d = c.r * TOUCH_NEAR;
      const rainbow = !e.isBreak;
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        this.trianglePath({ x: pt.x + d * Math.cos(a), y: pt.y + d * Math.sin(a) }, size, a + Math.PI);
        this.strokeNote(e, 2.5, 0.9, rainbow ? RAINBOW[i] : null);
      }
      const span = e.endTime - e.time;
      const done = span > 0 ? Math.max(0, Math.min(1, (t - e.time) / span)) : 1;
      const ctx = this.ctx;
      this.fillRegions(c, e, ratios, 0.12);
      const r = c.r * 0.13;
      // ◆の 4 つの角（真上・右・真下・左）
      const corner = [[0, -r], [r, 0], [0, r], [-r, 0]].map(([x, y]) => ({ x: pt.x + x, y: pt.y + y }));
      ctx.save();
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // 薄い下地の◆
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      corner.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.stroke();
      // できた分: 辺ごとに色を変えて、真上から時計回り
      ctx.globalAlpha = 0.9;
      const sides = 4 * done;
      for (let i = 0; i < 4 && i < sides; i++) {
        const a = corner[i], b = corner[(i + 1) % 4];
        const k = Math.min(1, sides - i);
        ctx.strokeStyle = e.isBreak ? COLORS.break : RAINBOW[i];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
        ctx.stroke();
      }
      ctx.restore();
    }

    // タッチの区画（C は C1・C2 の両方）をうすく塗る
    fillRegions(c, e, ratios, alpha) {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = this.noteColor(e);
      for (const g of SN.regionsOfNote(e.area, e.pos, ratios)) {
        this.regionPath(c, g);
        ctx.fill();
      }
      ctx.restore();
    }

    // 区画の多角形（判定線の半径 1 の座標）を画面に
    regionPath(c, g) {
      const ctx = this.ctx;
      ctx.beginPath();
      g.poly.forEach((p, i) => {
        const x = c.cx + p.x * c.r, y = c.cy + p.y * c.r;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.closePath();
    }

    // ---- スライド ----

    // 星を叩く少し前（流れるノーツの秒数）から軌道を出し、星を叩いて 1 拍後に、星が軌道を進む。
    // 軌道は矢印の並びで描き、星が通り過ぎた所は消す
    // 星が動いている間は、星のいる区画（スライドの判定に使うセンサー）をうすく塗る。
    // 星なしスライド: ? は星がフェードインし、! は動き出すまで星を出さない
    drawSlide(c, e, t, flow, ratios) {
      const lead = flow ? flow.approach : 0;
      if (t < e.time - lead || t > e.endTime) return;
      if (!e._paths) e._paths = S.slidePaths(e);
      const toPx = (q) => ({ x: c.cx + q.x * c.r, y: c.cy + q.y * c.r });
      const moving = e.endTime - e.slideStart;
      const f = t <= e.slideStart ? 0 : S.progressAt(e, t - e.slideStart, moving);
      const trackAlpha = t < e.time ? 0.25 + 0.45 * (1 - (e.time - t) / Math.max(lead, 1e-6)) : 0.7;
      const ctx = this.ctx;
      const s = c.r * CHEVRON_SIZE;
      for (const path of e._paths) {
        // 矢印（通り過ぎた所は描かない）
        const len = S.length(path);
        const n = Math.max(1, Math.floor(len / CHEVRON_GAP));
        ctx.beginPath();
        for (let i = 1; i < n; i++) {
          const k = i / n;
          if (k < f) continue;
          const q = S.pointAt(path, k);
          const p = toPx(q);
          const a = q.dir;
          ctx.moveTo(p.x - s * Math.cos(a - 0.9), p.y - s * Math.sin(a - 0.9));
          ctx.lineTo(p.x, p.y);
          ctx.lineTo(p.x - s * Math.cos(a + 0.9), p.y - s * Math.sin(a + 0.9));
        }
        this.strokeNote(e, 3, trackAlpha);
        // 星: 叩いたあとに現れ、待つ 1 拍の間に濃くなる
        if (t < e.time) continue;
        if (e.starMode === '!' && t < e.slideStart) continue;
        const wait = e.slideStart - e.time;
        const starAlpha = t < e.slideStart && wait > 0 ? 0.3 + 0.6 * ((t - e.time) / wait) : 0.9;
        const q = S.pointAt(path, f);
        if (t >= e.slideStart) {
          const id = SN.hit(q.x, q.y, ratios);
          const g = id && SN.regions(ratios).find((r) => r.id === id);
          if (g) {
            ctx.save();
            ctx.globalAlpha = 0.18;
            ctx.fillStyle = this.noteColor(e);
            this.regionPath(c, g);
            ctx.fill();
            ctx.restore();
          }
        }
        this.starPath(toPx(q), c.r * 0.075 * 1.25, q.dir + Math.PI / 2);
        this.strokeNote(e, 3.5, starAlpha);
      }
    }

    // ---- 叩く瞬間の光 ----

    drawFlash(c, e, ph, ratios, t) {
      const isTouch = e.kind === 'touch' || e.kind === 'touchHold';
      const pt = isTouch ? G.touchPoint(c, e.area, e.pos, ratios) : G.buttonPoint(c, e.pos);
      let size = c.r * (isTouch ? 0.075 : 0.09);
      if (ph.phase === 'after') size *= 1 + 0.4 * (1 - ph.alpha / 0.8); // 残像は少し広がる
      const width = ph.phase === 'pre' ? 2 : ph.phase === 'hit' ? 6 : 4;

      const path = () => {
        if (isTouch) this.diamondPath(pt, size);
        else if (e.star) this.starPath(pt, size * 1.25, starRot(e, t, G.buttonAngle(e.pos)));
        else if (e.kind === 'hold') this.hexPath(c, G.buttonAngle(e.pos), c.r - size * 0.3, c.r + size * 0.3, size);
        else this.circlePath(pt, size);
      };

      // タッチは区画（範囲）ごと光らせる
      if (isTouch && ph.phase !== 'pre') this.fillRegions(c, e, ratios, 0.3 * ph.alpha);

      if (ph.phase === 'hit') {
        path();
        const ctx = this.ctx;
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = this.noteColor(e);
        ctx.fill();
        ctx.restore();
      }
      path();
      this.strokeNote(e, width, ph.alpha);
    }

    // ---- 図形 ----

    circlePath(pt, r) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    }

    diamondPath(pt, s) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y - s);
      ctx.lineTo(pt.x + s, pt.y);
      ctx.lineTo(pt.x, pt.y + s);
      ctx.lineTo(pt.x - s, pt.y);
      ctx.closePath();
    }

    // 五角の星。rot はラジアン
    starPath(pt, r, rot) {
      const ctx = this.ctx;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 === 0 ? r : r * 0.45;
        const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
        const x = pt.x + rr * Math.cos(a);
        const y = pt.y + rr * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    // 角度 a の向きを指す三角
    trianglePath(pt, s, a) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(pt.x + s * Math.cos(a), pt.y + s * Math.sin(a));
      ctx.lineTo(pt.x + s * Math.cos(a + 2.4), pt.y + s * Math.sin(a + 2.4));
      ctx.lineTo(pt.x + s * Math.cos(a - 2.4), pt.y + s * Math.sin(a - 2.4));
      ctx.closePath();
    }

    // ホールドの細長い六角形。角度 deg の線上で、中心から r1〜r2 の範囲。w は太さの半分
    hexPath(c, deg, r1, r2, w) {
      const tip = w * 0.6;
      const p = (r, side) => {
        const q = G.polar(c, deg, r);
        const a = (deg * Math.PI) / 180; // 線に垂直な向き
        return { x: q.x + side * w * Math.cos(a), y: q.y + side * w * Math.sin(a) };
      };
      const a = G.polar(c, deg, r1 - tip);
      const b = G.polar(c, deg, r2 + tip);
      const pts = [a, p(r1, 1), p(r2, 1), b, p(r2, -1), p(r1, -1)];
      const ctx = this.ctx;
      ctx.beginPath();
      pts.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
      ctx.closePath();
    }
  }

  // 星の向き。回るのはスライドの始点の星と $$ の星だけ。$ だけの星形タップは回らない（書式のページより）。
  // 回る速さは譜面の時刻で決めるので、止めれば止まる
  function starRot(e, t, deg) {
    const spin = e.spin || e.slideHead ? t * Math.PI : 0;
    return spin + (deg * Math.PI) / 180;
  }

  function centroid(poly) {
    let x = 0, y = 0;
    for (const p of poly) { x += p.x; y += p.y; }
    return { x: x / poly.length, y: y / poly.length };
  }

  root.SimaiOverlay = { Overlay, COLORS };
})(globalThis);
