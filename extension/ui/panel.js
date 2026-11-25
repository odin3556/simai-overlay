// ページの中に浮かぶ小さな操作パネル。
// YouTube は Trusted Types を使うので、innerHTML は使わずに要素を組み立てる。
(function (root) {
  'use strict';

  function el(tag, props, children) {
    const e = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v);
      }
    }
    for (const c of children || []) e.append(c);
    return e;
  }

  // 秒を 1:23.45 の形に
  function clock(sec) {
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
  }

  class Panel {
    // actions: { jumpToNow(), setHud(on), searchSong(q), guessSong(), pickSong(i), pickChart(id), load(text), resetVideo(), autoCircle(), calibrate(), findFirst(), playCheck(), applyFix(), draft(bpm), useDraft(text), copyDraft(text), resetCircle(), setFirstNow(), nudge(n), setShow(on), setGuide(on), setTouch(area, v),
    //            setFlow(on), setSpeed(v), setTouchSpeed(v), setSound(on), setVolume(v), setSoundOffset(ms), close() }
    constructor(actions) {
      this.actions = actions;
      const a = actions;

      // ① 曲を探して選ぶ
      this.songQuery = el('input', { type: 'text', class: 'simai-p-query', placeholder: '曲名・読み・アーティスト', onkeydown: (ev) => { if (ev.key === 'Enter') a.searchSong(this.songQuery.value); } });
      this.songSelect = el('select', { class: 'simai-p-select', onchange: () => a.pickSong(Number(this.songSelect.value)) });
      this.chartSelect = el('select', { class: 'simai-p-select', onchange: () => a.pickChart(this.chartSelect.value) });
      this.songInfo = el('div', { class: 'simai-p-counts simai-p-song-info' });
      this.wikiLink = el('a', { target: '_blank', rel: 'noopener noreferrer', text: 'gamerch で見る' });
      this.dbLink = el('a', { target: '_blank', rel: 'noopener noreferrer', href: 'https://otoge-db.net/maimai/', text: 'OTOGE DB' });
      this.songLinks = el('div', { class: 'simai-p-row simai-p-links' }, [this.wikiLink, this.dbLink]);
      this.songStatus = el('div', { class: 'simai-p-hint simai-p-song-status' });
      this.songSelect.hidden = this.chartSelect.hidden = this.songLinks.hidden = true;

      this.textarea = el('textarea', { class: 'simai-p-text', placeholder: '(118){24}18,,,24,... を貼り付け', spellcheck: 'false' });
      this.counts = el('div', { class: 'simai-p-counts', text: 'まだ読み込んでいません' });
      // この動画をリセット: 消すと戻せないので、1 回目は文字を変えるだけにし、3 秒以内にもう一度押したら消す
      this.resetButton = el('button', {
        text: 'この動画をリセット',
        title: 'この動画で保存した simai・first・曲・円・下書きを消して、最初の状態に戻す（ハイスピなどの設定は残る）',
        onclick: () => {
          if (this.resetArmed) {
            clearTimeout(this.resetArmed);
            this.disarmReset();
            a.resetVideo();
            return;
          }
          this.resetButton.textContent = 'もう一度押すと消します';
          this.resetArmed = setTimeout(() => this.disarmReset(), 3000);
        },
      });
      this.warnings = el('ul', { class: 'simai-p-warn' });
      this.calibStatus = el('div', { class: 'simai-p-hint simai-p-calib-status' });
      this.firstText = el('span', { class: 'simai-p-mono', text: '—' });
      this.posText = el('span', { class: 'simai-p-mono', text: '—' });
      this.fpsText = el('span', { class: 'simai-p-mono', text: '—' });
      this.showBox = el('input', { type: 'checkbox', onchange: () => a.setShow(this.showBox.checked) });
      this.guideBox = el('input', { type: 'checkbox', onchange: () => a.setGuide(this.guideBox.checked) });
      this.flowBox = el('input', { type: 'checkbox', onchange: () => a.setFlow(this.flowBox.checked) });
      this.speedInput = el('input', { type: 'number', step: '0.25', min: '1', max: '10', class: 'simai-p-num', onchange: () => a.setSpeed(Number(this.speedInput.value)) });
      this.touchSpeedInput = el('input', { type: 'number', step: '0.25', min: '1', max: '10', class: 'simai-p-num', onchange: () => a.setTouchSpeed(Number(this.touchSpeedInput.value)) });
      this.soundBox = el('input', { type: 'checkbox', onchange: () => a.setSound(this.soundBox.checked) });
      this.hudBox = el('input', { type: 'checkbox', onchange: () => a.setHud(this.hudBox.checked) });
      this.volumeInput = el('input', { type: 'range', min: '0', max: '1', step: '0.05', class: 'simai-p-range', oninput: () => a.setVolume(Number(this.volumeInput.value)) });
      this.offsetInput = el('input', { type: 'number', step: '5', class: 'simai-p-num', onchange: () => a.setSoundOffset(Number(this.offsetInput.value)) });
      this.touchInputs = {};
      const touchRow = el('div', { class: 'simai-p-row' }, [el('span', { text: 'タッチの輪' })]);
      for (const area of ['A', 'B', 'D', 'E']) {
        const inp = el('input', { type: 'number', step: '0.01', min: '0', max: '1.2', class: 'simai-p-num', onchange: () => a.setTouch(area, Number(inp.value)) });
        this.touchInputs[area] = inp;
        touchRow.append(el('label', {}, [area, inp]));
      }

      this.header = el('div', { class: 'simai-p-head' }, [
        el('span', { text: '譜面重ね表示 v0.2' }),
        el('button', { class: 'simai-p-x', title: '閉じる', text: '×', onclick: () => a.close() }),
      ]);

      // いまの場所（パネルの上に固定）: 再生時間・譜面の時刻・小節と拍・simai の行、その行の中のいまの区切り
      this.nowTime = el('span', { class: 'simai-p-now-time', text: '—' });
      this.nowWhere = el('span', { class: 'simai-p-now-where' });
      this.nowLine = el('div', { class: 'simai-p-now-line' });
      this.nowJump = el('button', { class: 'simai-p-now-jump', text: '② で選ぶ', title: '② の譜面の欄で、いまの区切りを選ぶ（止めて直すときに）', onclick: () => a.jumpToNow() });
      this.nowBar = el('div', { class: 'simai-p-now' }, [
        el('div', { class: 'simai-p-row' }, [this.nowTime, this.nowWhere, this.nowJump]),
        this.nowLine,
      ]);
      this.nowBar.hidden = true;

      // ④ 最初のノーツの自動検出
      this.findButton = el('button', { class: 'simai-p-main', text: '▶ 再生して自動で探す', onclick: () => a.findFirst() });
      this.firstStatus = el('div', { class: 'simai-p-hint simai-p-first-status' });

      // ⑥ 動画から下書き
      this.bpmInput = el('input', { type: 'number', step: '0.01', min: '1', class: 'simai-p-num', placeholder: '空なら自動', title: '空のままなら、拾ったノーツから推定する' });
      this.draftButton = el('button', { class: 'simai-p-main', text: '▶ 再生して下書きを作る', onclick: () => a.draft(Number(this.bpmInput.value)) });
      this.draftStatus = el('div', { class: 'simai-p-hint simai-p-draft-status' });
      this.draftText = el('textarea', { class: 'simai-p-text', spellcheck: 'false' });
      this.draftRow = el('div', { class: 'simai-p-row' }, [
        el('button', { text: '② に入れて重ねる', onclick: () => a.useDraft(this.draftText.value) }),
        el('button', { text: 'コピー', onclick: () => a.copyDraft(this.draftText.value) }),
      ]);
      this.draftText.hidden = this.draftRow.hidden = true;

      // ⑤ 重なりの確認
      this.checkButton = el('button', { class: 'simai-p-main', text: '▶ 再生して確かめる', onclick: () => a.playCheck() });
      this.checkScore = el('div', { class: 'simai-p-score', text: 'まだ確かめていません' });
      this.checkAdvice = el('span', { class: 'simai-p-advice' });
      this.fixButton = el('button', { text: '直す', onclick: () => a.applyFix() });
      this.fixButton.hidden = true;

      const step = (title) => el('div', { class: 'simai-p-step', text: title });

      this.root = el('div', { class: 'simai-panel' }, [
        el('div', { class: 'simai-p-top' }, [this.header, this.nowBar]),
        el('div', { class: 'simai-p-body' }, [
          step('① 曲を探して選ぶ'),
          el('div', { class: 'simai-p-hint-static', text: 'OTOGE DB（非公式の曲データベース）から、BPM・難易度・ノーツの数を読みます。⑥ の下書きの BPM と見比べに使います' }),
          el('div', { class: 'simai-p-row' }, [
            this.songQuery,
            el('button', { text: '探す', onclick: () => a.searchSong(this.songQuery.value) }),
            el('button', { text: '動画のタイトルから', title: '動画のタイトルに入っている曲名と難易度で選ぶ', onclick: () => a.guessSong() }),
          ]),
          this.songSelect,
          this.chartSelect,
          this.songInfo,
          this.songLinks,
          this.songStatus,

          step('② 譜面（simai）を貼って読み込む'),
          this.textarea,
          el('div', { class: 'simai-p-row' }, [
            el('button', { text: '読み込む', onclick: () => a.load(this.textarea.value) }),
            this.resetButton,
          ]),
          this.counts,
          this.warnings,

          step('③ 円を動画に合わせる'),
          el('div', { class: 'simai-p-row' }, [
            el('button', { text: '自動で探す', title: '動画の白い判定線を探して円を合わせる（新しい動画では開いたときに自動で探す）', onclick: () => a.autoCircle() }),
            el('button', { text: '手で合わせる', title: '円の中心 → 円のふちの順にクリック', onclick: () => a.calibrate() }),
            el('button', { text: '標準に戻す', title: '外部出力の動画の標準（中心が真ん中、半径が高さの 0.445 倍）', onclick: () => a.resetCircle() }),
          ]),
          this.calibStatus,

          step('④ 最初のノーツの時刻を決める'),
          el('div', { class: 'simai-p-hint-static', text: '動画の頭から再生して、流れてくるノーツを自動で探します。手で決めるときは、最初のノーツが円に着いたコマで止めて「いまが最初のノーツ」（コマ送りは , と .）' }),
          this.findButton,
          this.firstStatus,
          el('div', { class: 'simai-p-row' }, [
            el('button', { text: 'いまが最初のノーツ', onclick: () => a.setFirstNow() }),
            el('span', { text: 'first' }), this.firstText,
          ]),
          el('div', { class: 'simai-p-row' }, [
            el('button', { text: '−10', title: '10 コマ前へ（Shift + [）', onclick: () => a.nudge(-10) }),
            el('button', { text: '−1 コマ', title: '[ キー', onclick: () => a.nudge(-1) }),
            el('button', { text: '+1 コマ', title: '] キー', onclick: () => a.nudge(1) }),
            el('button', { text: '+10', title: '10 コマ後へ（Shift + ]）', onclick: () => a.nudge(10) }),
          ]),
          el('div', { class: 'simai-p-row' }, [el('span', { text: 'いま' }), this.posText]),

          step('⑤ 再生して、重なるか確かめる'),
          el('div', { class: 'simai-p-hint-static', text: '動画のノーツが、重ねたノーツと同じ場所に来るかを自動で数えます。叩く瞬間に ○（重なった）か ×（重ならなかった）が出ます' }),
          this.checkButton,
          this.checkScore,
          el('div', { class: 'simai-p-row' }, [this.checkAdvice, this.fixButton]),

          step('⑥ 動画から simai の下書きを作る'),
          el('div', { class: 'simai-p-hint-static', text: '③ の円と ④ の first を決め、BPM を入れて押すと、最後まで再生しながらタップ・ホールド・星・BREAK を拾います（スライドの軌道・タッチはまだ拾いません）。できた下書きは ② に入れて、⑤ で確かめながら直します' }),
          el('div', { class: 'simai-p-row' }, [el('label', {}, ['BPM', this.bpmInput]), this.draftButton]),
          this.draftStatus,
          this.draftText,
          this.draftRow,

          el('hr'),
          el('div', { class: 'simai-p-row' }, [
            el('label', {}, [this.showBox, '表示']),
            el('label', { title: '中心寄りから円へ流れてくるノーツを重ねる' }, [this.flowBox, '流れるノーツ']),
            el('label', { title: '叩く時刻に音を鳴らす' }, [this.soundBox, 'アンサー音']),
            el('label', { title: '再生時間・小節・simai の行を、動画の左上にも出す' }, [this.hudBox, '場所を動画に']),
            this.volumeInput,
          ]),
          el('div', { class: 'simai-p-legend', text: '色: ピンク＝タップ・ホールド　黄＝同時押し　青＝星・タッチ　橙＋白線＝BREAK　白く光る＝EX' }),
          el('details', { class: 'simai-p-more' }, [
            el('summary', { text: '細かい設定' }),
            el('div', { class: 'simai-p-row' }, [el('label', {}, [this.guideBox, '円と点のガイド'])]),
            el('div', { class: 'simai-p-row' }, [
              el('label', { title: '動画を撮ったときのゲームのハイスピ（タップ）。6.5 で 0.32 秒' }, ['ハイスピ', this.speedInput]),
              el('label', { title: 'タッチのハイスピ' }, ['タッチ', this.touchSpeedInput]),
            ]),
            el('div', { class: 'simai-p-row' }, [el('label', { title: '正の値で音を遅らせる' }, ['音のずれ', this.offsetInput, 'ms'])]),
            touchRow,
            el('div', { class: 'simai-p-row' }, [el('span', { text: '1 コマ' }), this.fpsText]),
          ]),
        ]),
      ]);

      // パネルの中のキー操作を YouTube のショートカットに渡さない
      for (const type of ['keydown', 'keyup', 'keypress']) {
        this.root.addEventListener(type, (ev) => ev.stopPropagation());
      }
      this.makeDraggable();
    }

    makeDraggable() {
      let start = null;
      this.header.addEventListener('pointerdown', (ev) => {
        if (ev.target.tagName === 'BUTTON') return;
        const r = this.root.getBoundingClientRect();
        start = { x: ev.clientX - r.left, y: ev.clientY - r.top };
        this.header.setPointerCapture(ev.pointerId);
      });
      this.header.addEventListener('pointermove', (ev) => {
        if (!start) return;
        Object.assign(this.root.style, { left: `${ev.clientX - start.x}px`, top: `${ev.clientY - start.y}px`, right: 'auto' });
      });
      this.header.addEventListener('pointerup', () => { start = null; });
    }

    // 全画面のときは全画面の要素の中に置かないと見えない
    mount() {
      const parent = document.fullscreenElement || document.body;
      if (this.root.parentNode !== parent) parent.append(this.root);
    }

    unmount() {
      this.root.remove();
    }

    setText(text) {
      this.textarea.value = text || '';
    }

    disarmReset() {
      this.resetArmed = null;
      this.resetButton.textContent = 'この動画をリセット';
    }

    // リセットしたあとの知らせ（② の数の欄に出す）
    setLoadNote(text) {
      this.counts.textContent = text;
    }

    setParsed(parsed) {
      this.warnings.replaceChildren();
      if (!parsed) {
        this.counts.textContent = 'まだ読み込んでいません';
        return;
      }
      const c = parsed.counts;
      const bpms = [...new Set(parsed.bpmEvents.map((b) => b.bpm))].join(' / ') || '—';
      this.counts.textContent = `BPM ${bpms}　総数 ${c.total}　Tap ${c.tap}　Hold ${c.hold}　Slide ${c.slide}　Touch ${c.touch}　Break ${c.break}`;
      const shown = parsed.warnings.slice(0, 5);
      for (const w of shown) this.warnings.append(el('li', { text: w }));
      if (parsed.warnings.length > shown.length) this.warnings.append(el('li', { text: `ほか ${parsed.warnings.length - shown.length} 件` }));
    }

    setCalibStatus(text) {
      this.calibStatus.textContent = text || '';
    }

    setFirst(first) {
      this.firstText.textContent = first == null ? '—' : `${first.toFixed(3)} 秒`;
    }

    // now: content.js の nowInfo() の結果か null（譜面がない・first を決めていない）
    //   { video, chart, measure, beat, line, before, cell, after }。before・cell・after は、いまの行をいまの区切りで分けた文字
    setNow(now) {
      this.nowBar.hidden = !now;
      if (!now) return;
      this.nowTime.textContent = `${clock(now.video)}　譜面 ${now.chart >= 0 ? '' : '−'}${Math.abs(now.chart).toFixed(2)} 秒`;
      this.nowWhere.textContent = now.line ? `${now.measure} 小節 ${now.beat.toFixed(2)} 拍　${now.line} 行目` : '始まる前';
      this.nowJump.hidden = !now.line;
      this.nowLine.replaceChildren(now.before, el('mark', { class: 'simai-p-now-cell', text: now.cell || ' ' }), now.after);
      // いまの区切りが見えるように、行の横の位置を動かす
      const mark = this.nowLine.querySelector('mark');
      if (mark) this.nowLine.scrollLeft = Math.max(0, mark.offsetLeft - this.nowLine.clientWidth / 3);
    }

    setHud(on) {
      this.hudBox.checked = on;
    }

    // ② の欄で start〜end を選んで見せる
    selectText(start, end) {
      this.textarea.focus();
      this.textarea.setSelectionRange(start, end);
      // 選んだ所が見えるように、欄を縦に動かす（行の高さから見当をつける）
      const line = this.textarea.value.slice(0, start).split('\n').length - 1;
      const lh = parseFloat(getComputedStyle(this.textarea).lineHeight) || 16;
      this.textarea.scrollTop = Math.max(0, line * lh - this.textarea.clientHeight / 3);
    }

    setPosition(pos) {
      if (!pos) this.posText.textContent = '—';
      else if (pos.beat < 0) this.posText.textContent = `始まる前（あと ${(-pos.beat).toFixed(2)} 拍）`;
      else this.posText.textContent = `${pos.measure} 小節 ${(pos.beatInMeasure + 1).toFixed(2)} 拍`;
    }

    setFrame(frame) {
      this.fpsText.textContent = `${(frame * 1000).toFixed(1)} ms（${(1 / frame).toFixed(1)} fps）`;
    }

    setToggles(show, guide) {
      this.showBox.checked = show;
      this.guideBox.checked = guide;
    }

    setPlayback(p) {
      this.flowBox.checked = p.flow;
      this.speedInput.value = String(p.speed);
      this.touchSpeedInput.value = String(p.touchSpeed);
      this.soundBox.checked = p.sound;
      this.volumeInput.value = String(p.volume);
      this.offsetInput.value = String(p.soundOffsetMs);
      this.hudBox.checked = p.hud !== false;
    }

    setDrafting(on) {
      this.draftButton.textContent = on ? '■ 止めて下書きにする' : '▶ 再生して下書きを作る';
    }

    setDraftStatus(text) {
      this.draftStatus.textContent = text || '';
    }

    setDraft(text) {
      this.draftText.value = text || '';
      this.draftText.hidden = this.draftRow.hidden = !text;
    }

    // force: 曲を選んだとき（入っている値より曲の BPM を使う）
    setBpm(bpm, force) {
      if (bpm && (force || !this.bpmInput.value)) this.bpmInput.value = String(bpm);
    }

    // 別の動画に移ったとき: 選んだ曲と BPM を消す
    resetSong() {
      this.setSongResults([]);
      this.setCharts([]);
      this.setSongInfo(null);
      this.setSongStatus('');
      this.bpmInput.value = '';
    }

    setSongStatus(text) {
      this.songStatus.textContent = text || '';
    }

    // 探した結果の曲の一覧。selected: 選んでいる番号
    setSongResults(songs, selected) {
      this.songSelect.replaceChildren(...songs.map((s, i) => el('option', { value: String(i), text: `${s.title} ／ ${s.artist}（BPM ${String(s.bpm).trim()}）` })));
      if (selected != null) this.songSelect.value = String(selected);
      this.songSelect.hidden = !songs.length;
    }

    // 選んだ曲の譜面の一覧と、選んでいる譜面
    setCharts(charts, selectedId) {
      this.chartSelect.replaceChildren(...charts.map((c) => el('option', { value: c.id, text: `${c.name} ${c.lev}${c.notes.total ? `（${c.notes.total} ノーツ）` : ''}` })));
      if (selectedId) this.chartSelect.value = selectedId;
      this.chartSelect.hidden = !charts.length;
    }

    // info: { song, chart, bpm: parseBpm の結果 } か null
    setSongInfo(info) {
      if (!info || !info.song) {
        this.songInfo.textContent = '';
        this.songLinks.hidden = true;
        return;
      }
      const { song, chart, bpm } = info;
      const lines = [`${song.title} ／ ${song.artist}`];
      let b = `BPM ${String(song.bpm).trim()}`;
      if (bpm && bpm.changes) b += `（途中で変わる曲です。下書きは ${bpm.main} で作ります）`;
      lines.push(b);
      if (chart) {
        lines.push(`${chart.name} ${chart.lev}${chart.levI ? `（${chart.levI}）` : ''}${chart.designer ? `　譜面作者 ${chart.designer}` : ''}`);
        const n = chart.notes;
        if (n.total) {
          const parts = [['タップ', n.tap], ['ホールド', n.hold], ['スライド', n.slide], ['タッチ', n.touch], ['BREAK', n.break]].filter(([, v]) => v != null);
          lines.push(`ノーツ ${n.total}（${parts.map(([k, v]) => `${k} ${v}`).join('・')}）`);
        }
      }
      this.songInfo.textContent = lines.join('\n');
      this.wikiLink.hidden = !song.wiki_url;
      if (song.wiki_url) this.wikiLink.setAttribute('href', song.wiki_url);
      this.songLinks.hidden = false;
    }

    setFinding(on) {
      this.findButton.textContent = on ? '■ 止める' : '▶ 再生して自動で探す';
    }

    setFirstStatus(text) {
      this.firstStatus.textContent = text || '';
    }

    setChecking(on) {
      this.checkButton.textContent = on ? '■ 止める' : '▶ 再生して確かめる';
    }

    // res: SimaiVerify の result()。null なら「まだ」
    setCheckResult(res) {
      this.fixButton.hidden = true;
      this.checkScore.className = 'simai-p-score';
      if (!res || !res.checked) {
        this.checkScore.textContent = 'まだ確かめていません';
        this.checkAdvice.textContent = '';
        return;
      }
      const pct = Math.round((100 * res.matched) / res.checked);
      // タッチ・スライドはセンサーの区画の範囲で見た数（ずれ探しには使わない）
      const extra = [['タッチ', res.touch], ['スライド', res.slide]]
        .filter(([, o]) => o && o.checked)
        .map(([k, o]) => `${k} ${o.matched}/${o.checked}`)
        .join('・');
      this.checkScore.textContent = `重なった ${res.matched} / ${res.checked} ノーツ（${pct}%）${extra ? `　${extra}` : ''}`;
      this.checkScore.classList.add(pct >= 85 ? 'simai-p-good' : pct >= 60 ? 'simai-p-soso' : 'simai-p-bad');
      if (res.checked < 8) this.checkAdvice.textContent = 'もう少し再生してください…';
      else if (!res.sure) this.checkAdvice.textContent = 'ずれの向きがはっきりしません（円・ハイスピ・譜面を見直す）';
      else if (res.best === 0) this.checkAdvice.textContent = 'ずれ: ぴったり';
      else {
        this.checkAdvice.textContent = `${res.best > 0 ? '+' : '−'}${Math.abs(res.best)} コマ直すと、よく重なりそう`;
        this.fixButton.hidden = false;
      }
    }

    setTouch(ratios) {
      for (const [k, inp] of Object.entries(this.touchInputs)) inp.value = String(ratios[k]);
    }
  }

  root.SimaiPanel = { Panel };
})(globalThis);
