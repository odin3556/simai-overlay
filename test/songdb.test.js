const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBpm, charts, search, guessFromTitle, draftComment, normalize } = require('../extension/lib/songdb.js');

// OTOGE DB の music-ex.json と同じ形（OV3RCLOCK は 2026-11-01 に見た値）
const SONGS = [
  {
    title: 'OV3RCLOCK', title_kana: 'OV3RCLOCK', artist: 'Alicemetix', bpm: '118', wiki_url: 'https://gamerch.com/maimai/1018985',
    dx_lev_exp: '12+', dx_lev_exp_i: '12.6', dx_lev_exp_designer: 'サファ太', dx_lev_exp_notes: '548',
    dx_lev_mas: '14+', dx_lev_mas_i: '14.8', dx_lev_mas_designer: 'LuxizheLemon', dx_lev_mas_notes: '927',
    dx_lev_mas_notes_tap: '685', dx_lev_mas_notes_hold: '40', dx_lev_mas_notes_slide: '91', dx_lev_mas_notes_touch: '24', dx_lev_mas_notes_break: '87',
  },
  { title: 'CLOCK', title_kana: 'クロック', artist: 'someone', bpm: '170-210(170)', lev_mas: '12', lev_mas_notes: '600', lev_exp: '10' },
  { title: 'てすと曲', title_kana: 'テストキョク', artist: 'Alicemetix feat. X', bpm: '225 (225.5)', dx_lev_bas: '3' },
];

test('BPM の書き方を読む', () => {
  assert.deepEqual(parseBpm('118'), { main: 118, changes: false });
  assert.deepEqual(parseBpm('225 (225.5)'), { main: 225.5, changes: false });
  assert.deepEqual(parseBpm('170-210(170)'), { main: 170, changes: true });
  assert.deepEqual(parseBpm('191 (40-191)'), { main: 191, changes: true });
  assert.deepEqual(parseBpm('176-185 (176)'), { main: 176, changes: true });
  assert.deepEqual(parseBpm('\t185'), { main: 185, changes: false });
  assert.equal(parseBpm(''), null);
});

test('譜面の一覧: でらっくす・スタンダードと難易度、ノーツの数', () => {
  const list = charts(SONGS[0]);
  assert.deepEqual(list.map((c) => c.id), ['dx_exp', 'dx_mas']);
  const mas = list[1];
  assert.equal(mas.name, 'でらっくす MASTER');
  assert.equal(mas.lev, '14+');
  assert.equal(mas.designer, 'LuxizheLemon');
  assert.deepEqual(mas.notes, { total: 927, tap: 685, hold: 40, slide: 91, touch: 24, break: 87 });
  assert.deepEqual(charts(SONGS[1]).map((c) => c.name), ['スタンダード EXPERT', 'スタンダード MASTER']);
});

test('探す: 曲名が合うものを先に、読みやアーティストでも見つかる', () => {
  assert.deepEqual(search(SONGS, 'clock').map((s) => s.title), ['CLOCK', 'OV3RCLOCK']);
  assert.deepEqual(search(SONGS, 'ｏｖ３ｒ').map((s) => s.title), ['OV3RCLOCK']);
  assert.deepEqual(search(SONGS, 'てすときょく'.normalize('NFKC')).length, 0); // ひらがなとカタカナは別
  assert.deepEqual(search(SONGS, 'テストキョク').map((s) => s.title), ['てすと曲']);
  assert.deepEqual(search(SONGS, 'alicemetix').map((s) => s.title), ['OV3RCLOCK', 'てすと曲']);
  assert.deepEqual(search(SONGS, '  '), []);
});

test('動画のタイトルから曲と譜面を当てる（長い曲名を先に）', () => {
  const g = guessFromTitle(SONGS, 'OV3RCLOCK MASTER AP【maimaiでらっくす外部出力】 - YouTube');
  assert.equal(g.song.title, 'OV3RCLOCK');
  assert.equal(g.chart.id, 'dx_mas');
  assert.equal(guessFromTitle(SONGS, 'OV3RCLOCK EXPERT').chart.id, 'dx_exp');
  assert.equal(guessFromTitle(SONGS, 'CLOCK スタンダード MASTER').chart.id, 'std_mas');
  assert.equal(guessFromTitle(SONGS, '関係のない動画'), null);
});

test('下書きの先頭のコメント', () => {
  const c = draftComment(SONGS[0], charts(SONGS[0])[1]);
  assert.equal(c, '|| OV3RCLOCK / Alicemetix / でらっくす MASTER 14+ / 譜面作者 LuxizheLemon（曲の情報: OTOGE DB）');
  assert.equal(normalize('Ａ Ｂ-c'), 'abc');
});
