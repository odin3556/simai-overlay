// 曲の情報（OTOGE DB の music-ex.json）を探して読む（DOM を使わない部分）。
// OTOGE DB（https://otoge-db.net/maimai/ ・ zvuc 作）は非公式のファン制作のデータベース。
// 1 曲ごとに BPM・難易度・譜面作者・ノーツの数（種類ごと）・gamerch のページ（wiki_url）が入っている。
(function (root) {
  'use strict';

  const DIFFS = [
    { key: 'bas', name: 'BASIC' },
    { key: 'adv', name: 'ADVANCED' },
    { key: 'exp', name: 'EXPERT' },
    { key: 'mas', name: 'MASTER' },
    { key: 'remas', name: 'Re:MASTER' },
  ];

  // 探すときの文字の形をそろえる（全角半角・大文字小文字・空白・記号の違いを無くす）
  function normalize(s) {
    return String(s || '').normalize('NFKC').toLowerCase().replace(/[\s'’"“”・.,!?！？~〜\-‐–—_:：;()（）[\]【】「」『』]/g, '');
  }

  // BPM の書き方（"118"、"225 (225.5)"、"170-210(170)"、"191 (40-191)"）から、
  // { main（下書きに使う BPM）, changes（途中で変わるか）}。読めなければ null
  function parseBpm(text) {
    const s = String(text || '').trim();
    const m = /^([\d.]+)(?:\s*-\s*([\d.]+))?[^(]*(?:\(\s*([\d.]+)(?:\s*-\s*([\d.]+))?\s*\))?/.exec(s);
    if (!m) return null;
    const out = Number(m[1]), outRange = m[2] != null;
    const inn = m[3] != null ? Number(m[3]) : null, innRange = m[4] != null;
    let main = out;
    if (inn != null && !innRange && (outRange || Math.abs(inn - out) < 1)) main = inn; // 括弧の中が主な BPM か、細かい値
    const changes = outRange || innRange;
    return main > 0 ? { main, changes } : null;
  }

  // その曲の譜面の一覧: [{ id, dx, diff, name, lev, levI, designer, notes: { total, tap, hold, slide, touch, break } }]
  function charts(song) {
    const out = [];
    for (const dx of [true, false]) {
      for (const d of DIFFS) {
        const p = `${dx ? 'dx_' : ''}lev_${d.key}`;
        if (!song[p]) continue;
        const n = (k) => (song[`${p}_notes${k}`] ? Number(song[`${p}_notes${k}`]) : null);
        out.push({
          id: `${dx ? 'dx' : 'std'}_${d.key}`,
          dx,
          diff: d.key,
          name: `${dx ? 'でらっくす' : 'スタンダード'} ${d.name}`,
          lev: song[p],
          levI: song[`${p}_i`] || '',
          designer: song[`${p}_designer`] || '',
          notes: { total: n(''), tap: n('_tap'), hold: n('_hold'), slide: n('_slide'), touch: n('_touch'), break: n('_break') },
        });
      }
    }
    return out;
  }

  // 曲名・読み・アーティストで探す。曲名がそのまま合うものを先に。返り値は最大 limit 曲
  function search(songs, query, limit = 20) {
    const q = normalize(query);
    if (!q) return [];
    const scored = [];
    for (const s of songs) {
      const t = normalize(s.title), k = normalize(s.title_kana), a = normalize(s.artist);
      let score = 0;
      if (t === q) score = 100;
      else if (t.startsWith(q)) score = 80;
      else if (t.includes(q)) score = 60;
      else if (k.includes(q)) score = 50;
      else if (a.includes(q)) score = 30;
      // 曲名で合ったときは、短い曲名（よりぴったり）を先に
      if (score) scored.push({ s, score: score >= 60 ? score - t.length / 1000 : score });
    }
    return scored.sort((x, y) => y.score - x.score).slice(0, limit).map((x) => x.s);
  }

  // 動画のタイトルから曲と譜面を当てる。曲名がタイトルに入っている曲のうち、一番長い曲名のもの。
  // 譜面は、タイトルの「MASTER」「EXPERT」などと「スタンダード」「STD」から選ぶ（なければでらっくすを先に）
  function guessFromTitle(songs, videoTitle) {
    const v = normalize(videoTitle);
    let best = null;
    for (const s of songs) {
      const t = normalize(s.title);
      if (t.length < 2 || !v.includes(t)) continue;
      if (!best || t.length > normalize(best.title).length) best = s;
    }
    if (!best) return null;
    const raw = String(videoTitle || '');
    const up = raw.toUpperCase();
    let diff = null;
    if (/RE:?\s*MASTER|リマス/.test(up)) diff = 'remas';
    else if (/MASTER|マスター/.test(up)) diff = 'mas';
    else if (/EXPERT|エキスパート/.test(up)) diff = 'exp';
    else if (/ADVANCED|アドバンス/.test(up)) diff = 'adv';
    else if (/BASIC|ベーシック/.test(up)) diff = 'bas';
    const std = /スタンダード|STANDARD|\bSTD\b/.test(up);
    const list = charts(best);
    const chart = list.find((c) => (!diff || c.diff === diff) && c.dx === !std) || list.find((c) => !diff || c.diff === diff) || null;
    return { song: best, chart };
  }

  // 下書きの先頭に書くコメント（simai の || はコメント）
  function draftComment(song, chart) {
    if (!song) return '';
    const parts = [song.title, song.artist];
    if (chart) parts.push(`${chart.name} ${chart.lev}`, chart.designer ? `譜面作者 ${chart.designer}` : '');
    return `|| ${parts.filter(Boolean).join(' / ')}（曲の情報: OTOGE DB）`;
  }

  const api = { normalize, parseBpm, charts, search, guessFromTitle, draftComment, DIFFS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SimaiSongDB = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
