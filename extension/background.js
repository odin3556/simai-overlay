// 拡張機能のアイコンを押したら、そのタブの content.js に「オン / オフ」を伝える。
chrome.action.onClicked.addListener((tab) => {
  if (tab.id == null) return;
  // YouTube 以外のタブや、拡張機能を入れる前から開いていたタブでは届かない（再読み込みが必要）
  chrome.tabs.sendMessage(tab.id, { type: 'toggle' }).catch(() => {});
});

// 曲の情報（OTOGE DB の music-ex.json）を渡す。パネルで「探す」を押したときだけ読みに行き、1 日はしまっておいた物を使う。
// 送るのはファイルを取りに行く要求だけで、動画や譜面の情報は送らない
const SONG_DB_URL = 'https://otoge-db.net/maimai/data/music-ex.json';
const SONG_DB_KEY = 'songdb';
const SONG_DB_TTL = 24 * 60 * 60 * 1000;

async function songDb(refresh, cacheOnly) {
  const saved = (await chrome.storage.local.get(SONG_DB_KEY))[SONG_DB_KEY];
  if (!refresh && saved && Date.now() - saved.at < SONG_DB_TTL) return saved;
  if (cacheOnly) return saved || { error: 'nocache' }; // 自分からは読みに行かない（新しい動画を開いたとき）
  try {
    const res = await fetch(SONG_DB_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const songs = await res.json();
    if (!Array.isArray(songs)) throw new Error('形が違います');
    const fresh = { at: Date.now(), songs };
    await chrome.storage.local.set({ [SONG_DB_KEY]: fresh });
    return fresh;
  } catch (e) {
    // 読めなければ、古くてもしまっておいた物を使う
    if (saved) return Object.assign({ stale: true }, saved);
    return { error: String(e.message || e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'songdb') return false;
  songDb(!!msg.refresh, !!msg.cacheOnly).then(reply);
  return true; // reply はあとで呼ぶ
});
