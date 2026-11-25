// 動画から simai の下書きを作る（DOM を使わない部分）。
//
// 1. extractNotes: LaneScanner が覚えたコマから、8 本の線ごとにノーツを拾う。
//    「流れてくるノーツがある」時刻が短く続けばタップ、長く続けばホールド（胴が線の上に残るため）。
//    色で種類を見分ける: 青 = 星、橙 = BREAK、黄 = 同時押し、ピンク = タップ。
//    長く続く青は、線に重なったスライドの軌道なので捨てる。
// 2. toSimai: BPM と first（拍 0 の動画の時刻）で拍に直し、1/12 拍に丸めて simai の文字にする。
//
// 拾わないもの: スライドの軌道（星だけを $ で書く）、タッチ、EX。BPM の途中変更にも対応していない。
(function (root) {
  'use strict';

  const BIN = 1 / 120; // 時刻を調べる刻み（秒）
  const RUN_GAP = 0.025; // これより短い途切れは、同じ連なりとみなす
  const HOLD_MIN = 0.12; // これより長く続けばホールド
  const TAP_BODY_MIN = 0.03; // 胴の左右の点がこれ以上（HOLD_MIN より短く）続き、頭がなければタップ
  const STAR_SURE = 0.9; // 青い点で星とみなす: 見たコマのこの割合以上で、青い点が出ていること
  const STAR_LAG = 0.01; // 青い点の山が、ほかのノーツの頭より遅れて出る秒（チエルカ／エソテリカで約 10 ms）
  const WEAK_STAR = { mean: 0.85, agree: 0.6, lit: 0.9 }; // 黄・橙の星: 'm' の平均・一致率、's' の一致率の下限
  const STRAY_SPAN = 2; // 曲の始まり: この秒数の間に
  const STRAY_MIN = 4; // これだけノーツが続く所
  const BPM_RANGE = [90, 320]; // BPM を推定するときに探す範囲
  const OFF_GRID = 4; // BPM の推定: どのマスにも乗らないノーツの書きにくさ
  const UNIT = 12; // 1 拍を何個に分けて丸めるか（16 分も 3 連符も入る）
  const TAIL_PAD = -0.02; // ホールドの尾: 胴が見えなくなる時刻に足す秒（チエルカ／エソテリカで +0.02 だと 91 個中 91 個が約 45 ms 長かった）
  const GRID_SIGMA = 0.008; // 拍の格子に合わせるとき、格子からこれくらい（秒）までを「乗っている」とみなす
  const SNAP_SIGMA = 0.008; // 丸めるときの、拾った時刻の揺れ（秒）
  const SNAP_SIGMA_LEN = 0.015; // 丸めるときの、ホールドの長さの揺れ（秒。頭と尾の両方の揺れが入る）
  const HEAD_PAD = 0.042; //ホールドの頭: 胴の始まりに足す秒（動画の頭の六角形は、ノーツの位置より前へ出ているため。OV3RCLOCK で測った）

  // 色の色相（0〜360）。色が薄ければ null
  function hue(c) {
    const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b);
    if (mx - mn < 40) return null;
    let h;
    if (mx === c.r) h = ((c.g - c.b) / (mx - mn)) % 6;
    else if (mx === c.g) h = (c.b - c.r) / (mx - mn) + 2;
    else h = (c.r - c.g) / (mx - mn) + 4;
    return (h * 60 + 360) % 360;
  }

  // 色からノーツの種類: 'star' | 'break' | 'each' | 'tap'
  function classify(color) {
    const h = color ? hue(color) : null;
    if (h == null) return 'tap';
    if (h >= 165 && h <= 260) return 'star';
    if (h >= 8 && h < 46) return 'break';
    if (h >= 46 && h <= 80) return 'each';
    return 'tap';
  }

  // 線 p で、scanner.found(p, t, key) が続く区間の一覧 [{ p, a, z }]
  function runsOf(scanner, span, p, key) {
    const runs = [];
    let start = null, last = null;
    for (let b = Math.ceil(span.lo / BIN); b * BIN <= span.hi; b++) {
      const t = b * BIN;
      if (!scanner.found(p, t, key)) continue;
      if (start != null && t - last <= RUN_GAP) { last = t; continue; }
      if (start != null) runs.push({ p, a: start, z: last });
      start = last = t;
    }
    if (start != null) runs.push({ p, a: start, z: last });
    return runs;
  }

  // 返り値: [{ pos, time, end（ホールドのみ）, kind: 'tap' | 'hold', color: 'tap' | 'each' | 'star' | 'break', star（黄・橙の星のみ）}]（時刻順）
  // 頭: 動いて見える光（'m'）が短く続く所。胴: ホールドの左右の辺（'h'）が HOLD_MIN より長く続く所
  function extractNotes(scanner) {
    const s = scanner.span();
    if (!s) return [];
    const heads = [], bodies = [], shorts = [];
    for (let p = 1; p <= 8; p++) {
      for (const r of runsOf(scanner, s, p, 'm')) heads.push(Object.assign(r, { time: peak(scanner, r, 'm') }));
      for (const r of runsOf(scanner, s, p, 'h')) {
        if (r.z - r.a >= HOLD_MIN) bodies.push(r);
        else if (r.z - r.a >= TAP_BODY_MIN) shorts.push(r);
      }
    }

    const notes = [];
    const used = new Set();
    for (const b of bodies) {
      // 胴の始まりの近くの頭を、ホールドの頭にする。胴の途中・終わりに出る頭（尾の端）は使わない
      const head = heads.find((h) => h.p === b.p && h.time >= b.a - 0.04 && h.time <= b.a + 0.08);
      for (const h of heads) if (h.p === b.p && h.time >= b.a - 0.04 && h.time <= b.z + 0.04) used.add(h);
      // 頭の時刻は胴の始まりから出す（動画では、六角形の先が見つかって早めに出ることがあるため）
      const time = b.a + HEAD_PAD;
      const color = classify(scanner.colorAt(b.p, time));
      // 青く長い光は、線に重なったスライドの軌道。頭があれば星だけ残す
      if (color === 'star') {
        if (head) notes.push({ pos: b.p, time, kind: 'tap', color });
        continue;
      }
      // 橙で頭のない胴も、線に重なったスライドの軌道（チエルカ／エソテリカで 13 個すべてそうだった）。
      // 本物のホールドも 3 分の 1 ほどは頭が見つからないので、頭がないことだけでは捨てない
      if (color === 'break' && !head) continue;
      // 胴の辺は見る場所の少し後ろ（中心寄り）を見るので、胴の終わりは尾より TAIL_PAD 秒早く切れる
      notes.push({ pos: b.p, time, end: Math.max(time + BIN, b.z + TAIL_PAD), kind: 'hold', color });
    }
    for (const h of heads) {
      if (used.has(h)) continue;
      notes.push({ pos: h.p, time: h.time, kind: 'tap', color: classify(scanner.colorAt(h.p, h.time)) });
    }
    // 頭が見つからないタップ: 長いホールドの横の連打（チエルカ／エソテリカの 4,4,4,…）は、動いて見える光が
    // 一部のコマでしか出ず「頭」にならない。それでもタップの輪は胴の左右の点に短く（0.03〜0.12 秒）かかるので、
    // 近くに頭も胴もなければ、その真ん中をタップにする（答えと比べて 30 個当たり・1 個外れ）
    for (const r of shorts) {
      const time = (r.a + r.z) / 2;
      if (heads.some((h) => h.p === r.p && Math.abs(h.time - time) <= 0.06)) continue;
      if (bodies.some((b) => b.p === r.p && time >= b.a - 0.04 && time <= b.z + 0.04)) continue;
      notes.push({ pos: r.p, time, kind: 'tap', color: classify(scanner.colorAt(r.p, time)) });
    }
    // 頭が見つからない星: 自分のスライドの軌道（水色の矢印の帯）の上を流れてくる星は、帯も光るので 'm' では消える。
    // 星の縁の青い点（'bm'）がどのコマでもはっきり出る所を星にする（答えと比べて 12 個当たり・外れなし）。
    // 青い点の山は、ほかのノーツの頭より STAR_LAG 秒遅れて出る
    for (let p = 1; p <= 8; p++) {
      for (const r of runsOf(scanner, s, p, 'bm')) {
        const at = peak(scanner, r, 'bm');
        const ev = scanner.evidence(p, at, 'bm');
        if (ev.mean < STAR_SURE || ev.agree < STAR_SURE) continue;
        const time = at - STAR_LAG;
        if (heads.some((h) => h.p === p && Math.abs(h.time - at) <= 0.06)) continue;
        if (bodies.concat(shorts).some((b) => b.p === p && at >= b.a - 0.04 && at <= b.z + 0.04)) continue;
        if (notes.some((n) => n.pos === p && Math.abs(n.time - time) <= 0.06)) continue;
        notes.push({ pos: p, time, kind: 'tap', color: 'star' });
      }
    }
    // 同時押し（黄）・BREAK（橙）の星: 帯も同じ色なので青い点は使えないが、動いて見える光（'m'）の平均は高く、
    // 一部のコマで帯に埋もれて一致率だけが AGREE に届かない。そういう山を星にする（答えと比べて 7 個当たり・外れなし）
    for (let p = 1; p <= 8; p++) {
      let prev = null, cur = null;
      for (let b = Math.ceil(s.lo / BIN); b * BIN <= s.hi + BIN; b++) {
        const next = { t: b * BIN, ev: scanner.evidence(p, b * BIN, 'm') };
        if (cur && prev && cur.ev.mean >= prev.ev.mean && cur.ev.mean > next.ev.mean) {
          const { t, ev } = cur;
          if (ev.mean >= WEAK_STAR.mean && ev.agree >= WEAK_STAR.agree && ev.agree < 0.8 && ev.n >= 2
            && scanner.evidence(p, t, 's').agree >= WEAK_STAR.lit
            && !notes.some((n) => n.pos === p && Math.abs(n.time - t) <= 0.06)
            && !bodies.concat(shorts).some((r) => r.p === p && t >= r.a - 0.04 && t <= r.z + 0.04)) {
            const color = classify(scanner.colorAt(p, t));
            if (color === 'each' || color === 'break') notes.push({ pos: p, time: t, kind: 'tap', color, star: true });
          }
        }
        prev = cur;
        cur = next;
      }
    }
    return notes.sort((x, y) => x.time - y.time || x.pos - y.pos);
  }

  // 連なりの中で一番強く光った時刻（同じなら真ん中）
  function peak(scanner, r, key) {
    const tops = [];
    let best = -1;
    for (let t = r.a; t <= r.z + 1e-9; t += BIN) {
      const m = scanner.evidence(r.p, t, key).mean;
      if (m > best + 1e-9) { best = m; tops.length = 0; }
      if (Math.abs(m - best) <= 1e-9) tops.push(t);
    }
    return tops[(tops.length - 1) >> 1];
  }

  // 曲が始まる前（タイトル画面など）と終わったあと（結果の画面など）に、ぽつんと拾ったノーツを捨てる。
  // ノーツから STRAY_SPAN 秒の間に STRAY_MIN 個以上ノーツが続く所を、曲の始まり（終わりは逆向き）とみなす。
  // チエルカ／エソテリカで、始まる 8.5 秒前に 1 つ拾い、それを拍 0 にして 1/12 拍の丸めがずれた。終わりにも 1 つ拾った
  // 返り値: { notes（捨てたあと）, dropped（前で捨てた数）, droppedEnd（後ろで捨てた数）}
  function dropStrays(notes) {
    const dense = (i, dir) => {
      let n = 0;
      for (let j = i; j >= 0 && j < notes.length && Math.abs(notes[j].time - notes[i].time) <= STRAY_SPAN; j += dir) n++;
      return n >= STRAY_MIN;
    };
    let a = 0, z = notes.length - 1;
    while (a < notes.length && !dense(a, 1)) a++;
    if (a >= notes.length) return { notes, dropped: 0, droppedEnd: 0 }; // どこにも続かないときは何も捨てない
    while (z > a && !dense(z, -1)) z--;
    return { notes: notes.slice(a, z + 1), dropped: a, droppedEnd: notes.length - 1 - z };
  }

  function gcd(a, b) {
    while (b) [a, b] = [b, a % b];
    return a;
  }

  function noteText(n, slots) {
    const b = n.color === 'break' ? 'b' : '';
    // m × 4 ÷ n 拍 = slots ÷ UNIT 拍 → [4·UNIT : slots] を約分
    const len = () => { const g = gcd(4 * UNIT, slots); return `[${(4 * UNIT) / g}:${slots / g}]`; };
    if (n.kind === 'touch') return noteKey(n);
    if (n.kind === 'touchHold') return `${noteKey(n)}h${len()}`;
    if (n.kind === 'hold') return `${n.pos}${b}h${len()}`;
    // スライドが分かった星は「1-5[8:1]」、分からなければ星の印だけ「1$」
    if (n.slide) return `${n.pos}${b}${n.slide.text}`;
    return `${n.pos}${b}${n.color === 'star' || n.star ? '$' : ''}`;
  }

  // 同じ時刻に同じ所のノーツは 1 つだけ書く。ボタンは 1〜8、タッチは 'E4'・'C' など
  function noteKey(n) {
    return n.kind === 'touch' || n.kind === 'touchHold' ? `${n.area}${n.pos || ''}` : n.pos;
  }

  // 同じ時刻のノーツの並び: ボタン（番号順）、そのあとタッチ（A〜E 順）
  function keyOrder(x, y) {
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    if (typeof x === 'number') return -1;
    if (typeof y === 'number') return 1;
    return x < y ? -1 : x > y ? 1 : 0;
  }

  // 拾った時刻が、first から見た 16 分の格子からまとめてずれている秒（正なら遅い）。
  // 拾う時刻と first は別の見方で決めるので、数十 ms ずれることがある（チエルカ／エソテリカ 205 BPM で約 −20 ms）。
  // 速い曲では 1/12 拍が 24 ms ほどしかなく、ずれたまま丸めると同時押しが 1/48 ずつ離れて書かれてしまう。
  // 16 分の半分までのずれを 1 ms 刻みで試し、格子の近くに一番多く集まるずれを選ぶ（3 連符は数が少ないので無視できる）
  function gridShift(notes, bpm, first) {
    const step = 60 / bpm / 4;
    let best = 0, bestScore = -1;
    for (let ms = -Math.floor((step / 2) * 1000); ms <= (step / 2) * 1000; ms++) {
      const d = ms / 1000;
      let score = 0;
      for (const n of notes) {
        const x = (n.time - first - d) / step;
        const off = (x - Math.round(x)) * step;
        score += Math.exp(-((off / GRID_SIGMA) ** 2));
      }
      if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && Math.abs(d) < Math.abs(best))) { bestScore = score; best = d; }
    }
    return best;
  }

  // 同じ時刻のノーツ。タップ（BREAK・星でない）だけなら simai の略記で「18」、ほかが混じれば「1/8h[4:1]」
  function eachText(list) {
    if (list.length > 1 && list.every((x) => x.plain)) return list.map((x) => x.text).join('');
    return list.map((x) => x.text).join('/');
  }

  // 1 拍の中の位置（1/12 拍の番号 0〜11）ごとの「書かれにくさ」。拍・8 分 < 16 分 < 3 連 8 分 < 6 連 < 1/12 拍
  const SLOT_PENALTY = [0, 2, 1.5, 0.3, 0.8, 2, 0, 2, 0.8, 0.3, 1.5, 2];

  // 時刻（1/12 拍の単位、小数）を丸める。近さ（揺れ sigma 秒）と書かれにくさを足して一番小さいマス目にする。
  // ただ一番近いマス目にすると、速い曲では 12 ms の揺れで 16 分のノーツが隣の 1/48 に落ちる（チエルカ／エソテリカで 21 個）
  function snapSlot(x, slotSec, sigma) {
    let best = Math.round(x), bestCost = Infinity;
    for (let c = Math.floor(x) - 1; c <= Math.ceil(x) + 1; c++) {
      const d = ((x - c) * slotSec) / sigma;
      const cost = (d * d) / 2 + SLOT_PENALTY[((c % UNIT) + UNIT) % UNIT];
      if (cost < bestCost) { bestCost = cost; best = c; }
    }
    return best;
  }

  // notes: extractNotes の結果、bpm: BPM、first: 拍 0 の動画の時刻（秒）
  // 返り値: { text, count, shift（拍に合わせるために、拾った時刻から引いた秒）}
  function toSimai(notes, bpm, first) {
    const perMeasure = 4 * UNIT;
    const slotSec = 60 / bpm / UNIT;
    const shift = notes.length ? gridShift(notes, bpm, first) : 0;
    const slots = new Map(); // 位置 → { 線 → 書くノーツの文字 }（同じ線は 1 つ）
    let lastSlot = 0;
    for (const n of notes) {
      const slot = snapSlot((n.time - shift - first) / slotSec, slotSec, SNAP_SIGMA);
      if (slot < 0) continue;
      const len = n.kind === 'hold' || n.kind === 'touchHold' ? Math.max(1, snapSlot((n.end - n.time) / slotSec, slotSec, SNAP_SIGMA_LEN)) : 0;
      const at = slots.get(slot) || new Map();
      const key = noteKey(n);
      if (!at.has(key)) at.set(key, { text: noteText(n, len), plain: n.kind === 'tap' && n.color !== 'break' && n.color !== 'star' && !n.star });
      slots.set(slot, at);
      lastSlot = Math.max(lastSlot, slot);
    }
    const lines = [`(${bpm})`];
    let div = null;
    const measures = Math.floor(lastSlot / perMeasure) + 1;
    for (let m = 0; m < measures; m++) {
      // その小節の音の位置に合う一番粗い分け方
      let u = perMeasure;
      for (const slot of slots.keys()) {
        if (Math.floor(slot / perMeasure) === m) u = gcd(u, slot - m * perMeasure);
      }
      const n = perMeasure / u;
      let line = n !== div ? `{${n}}` : '';
      div = n;
      for (let i = 0; i < n; i++) {
        const at = slots.get(m * perMeasure + i * u);
        line += (at ? eachText([...at.keys()].sort(keyOrder).map((p) => at.get(p))) : '') + ',';
      }
      lines.push(line);
    }
    lines.push('E');
    let count = 0;
    for (const at of slots.values()) count += at.size;
    return { text: lines.join('\n'), count, shift };
  }

  // ノーツの時刻から BPM を推定する（曲の情報に BPM がないとき）。
  // 16 分の格子への揃い方（位相の集まり具合）で候補を出し、半分・2/3・3/4・4/3・3/2・2 倍も足して、
  // 「その BPM で書いたとき、拍・8 分・16 分で素直に書けるか」（SLOT_PENALTY と、どのマスにも乗らない所）が一番小さいものを選ぶ。
  // 揃い方だけだと、8 分ばかりの譜面で半分の BPM を選んでしまう（チエルカ／エソテリカの答えで 102.5）。
  // チエルカ 205・魔法仕掛けのファンタジア 280（ゲーム画面と同じ）を当てた。3 連符の多い OV3RCLOCK（118）は 177 になる
  // （3 連符を 1.5 倍の BPM の 8 分・16 分として書く方が素直なため）。
  // 返り値: { bpm, cost（1 ノーツあたりの書きにくさ）} か、ノーツが少なければ null
  function estimateBpm(notes) {
    const ts = notes.map((n) => n.time);
    if (ts.length < 16) return null;
    const scan = [];
    for (let b = BPM_RANGE[0]; b <= BPM_RANGE[1]; b += 0.25) scan.push({ b, r: phase16(ts, b).r });
    const peaks = scan.filter((x, i) => i > 0 && i < scan.length - 1 && x.r >= scan[i - 1].r && x.r >= scan[i + 1].r)
      .sort((a, b) => b.r - a.r).slice(0, 6);
    const cands = new Set();
    for (const pk of peaks) for (const m of [0.5, 2 / 3, 0.75, 1, 4 / 3, 1.5, 2]) {
      const b = pk.b * m;
      if (b >= BPM_RANGE[0] && b <= BPM_RANGE[1]) cands.add(+b.toFixed(2));
    }
    let best = null;
    for (const b0 of cands) {
      for (let b = b0 - 0.5; b <= b0 + 0.5; b += 0.05) {
        const c = writeCost(ts, b);
        if (!best || c < best.cost) best = { bpm: b, cost: c };
      }
    }
    // BPM はたいてい整数
    const r = Math.round(best.bpm);
    best.bpm = Math.abs(best.bpm - r) < 0.15 ? r : +best.bpm.toFixed(2);
    return best;
  }

  // 16 分の長さを 1 周とした位相の集まり具合 r（0〜1）と、集まった位相（秒）
  function phase16(ts, bpm) {
    const step = 60 / bpm / 4;
    let c = 0, s = 0;
    for (const t of ts) {
      const a = (2 * Math.PI * t) / step;
      c += Math.cos(a);
      s += Math.sin(a);
    }
    return { r: Math.hypot(c, s) / ts.length, ph: (Math.atan2(s, c) / (2 * Math.PI)) * step };
  }

  // その BPM で書いたときの、1 ノーツあたりの書きにくさ（拍の頭は 16 分の 4 通りから一番よいもの）
  function writeCost(ts, bpm) {
    const beat = 60 / bpm, slot = beat / UNIT, { ph } = phase16(ts, bpm);
    let best = Infinity;
    for (let k = 0; k < 4; k++) {
      const off = ph + (k * beat) / 4;
      let sum = 0;
      for (const t of ts) {
        const x = (t - off) / slot;
        let m = OFF_GRID;
        for (let c = Math.floor(x) - 1; c <= Math.ceil(x) + 1; c++) {
          const d = ((x - c) * slot) / SNAP_SIGMA;
          m = Math.min(m, (d * d) / 2 + SLOT_PENALTY[((c % UNIT) + UNIT) % UNIT]);
        }
        sum += m;
      }
      best = Math.min(best, sum / ts.length);
    }
    return best;
  }

  const api = { extractNotes, dropStrays, toSimai, gridShift, estimateBpm, writeCost, classify, hue, UNIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SimaiDraft = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
