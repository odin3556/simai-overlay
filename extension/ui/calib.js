// 円の位置合わせ。中心 → ふちの 1 点の 2 回のクリックで決め、キーで微調整する。
//   矢印キー … 中心を 1px（Shift で 10px）
//   + / −    … 半径を 1px（Shift で 10px）
//   Enter / Esc … 終わる
(function (root) {
  'use strict';

  const G = root.SimaiGeometry;

  class Calibration {
    // onChange(calib, step) … 円が変わるたびに呼ぶ。step は 'center' | 'edge' | 'adjust'
    // onDone(calib)         … 終わったときに呼ぶ
    constructor(overlay, onChange, onDone) {
      this.overlay = overlay;
      this.onChange = onChange;
      this.onDone = onDone;
      this.active = false;
      this.step = 'center';
      this.px = null;
      this._click = (ev) => this.handleClick(ev);
      this._key = (ev) => this.handleKey(ev);
    }

    start(calib) {
      this.active = true;
      this.step = calib ? 'adjust' : 'center';
      this.px = calib ? G.circleToPx(calib, this.overlay.w, this.overlay.h) : null;
      this.overlay.setInteractive(true);
      this.overlay.canvas.addEventListener('click', this._click, true);
      // YouTube の矢印キー（シーク）より先に受け取るため、window の capture で聞く
      window.addEventListener('keydown', this._key, true);
      this.emit();
    }

    stop() {
      if (!this.active) return;
      this.active = false;
      this.overlay.setInteractive(false);
      this.overlay.canvas.removeEventListener('click', this._click, true);
      window.removeEventListener('keydown', this._key, true);
      this.onDone(this.calib());
    }

    calib() {
      return this.px ? G.circleFromPx(this.px, this.overlay.w, this.overlay.h) : null;
    }

    emit() {
      this.onChange(this.calib(), this.step);
    }

    handleClick(ev) {
      ev.preventDefault();
      ev.stopPropagation(); // 動画の再生 / 停止にしない
      const p = this.overlay.pointFromEvent(ev);
      if (this.step === 'edge') {
        this.px.r = Math.hypot(p.x - this.px.cx, p.y - this.px.cy);
        this.step = 'adjust';
      } else {
        // 'center'、または 'adjust' 中のクリックは中心からやり直し
        this.px = { cx: p.x, cy: p.y, r: this.px ? this.px.r : Math.min(this.overlay.w, this.overlay.h) * 0.4 };
        this.step = 'edge';
      }
      this.emit();
    }

    handleKey(ev) {
      if (ev.target && /^(INPUT|TEXTAREA)$/.test(ev.target.tagName)) return;
      const n = ev.shiftKey ? 10 : 1;
      let handled = true;
      if (ev.key === 'Enter' || ev.key === 'Escape') {
        this.stop();
      } else if (!this.px) {
        handled = false;
      } else if (ev.key === 'ArrowLeft') this.px.cx -= n;
      else if (ev.key === 'ArrowRight') this.px.cx += n;
      else if (ev.key === 'ArrowUp') this.px.cy -= n;
      else if (ev.key === 'ArrowDown') this.px.cy += n;
      // 日本語配列の「+」は Shift + ;、英語配列は Shift + =
      else if (ev.key === '+' || ev.key === '=' || ev.key === ';') this.px.r += n;
      else if (ev.key === '-' || ev.key === '_') this.px.r = Math.max(5, this.px.r - n);
      else handled = false;
      if (!handled) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (this.active) this.emit();
    }
  }

  root.SimaiCalibration = { Calibration };
})(globalThis);
