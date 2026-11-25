// 譜面レーダー試作のページを出し、Majdata Net への中継をする小さなサーバー。
// Majdata の譜面ファイル（cdn.majdata.net）は majdata.net 以外のページから読めないので、
// /majdata/... をこのサーバーが代わりに取りに行く。中継先は majdata.net だけ。
// 実行: docker compose up radar → http://localhost:8787/
const http = require('http');
const fs = require('fs');

const PAGE = process.env.PAGE || '/srv/index.html';
const PORT = +(process.env.PORT || 8787);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    fs.createReadStream(PAGE).pipe(res);
    return;
  }
  if (url.pathname.startsWith('/majdata/') && req.method === 'GET') {
    const target = 'https://majdata.net/' + url.pathname.slice('/majdata/'.length) + url.search;
    try {
      const r = await fetch(target, { redirect: 'follow' });
      const final = new URL(r.url);
      if (final.hostname !== 'majdata.net' && !final.hostname.endsWith('.majdata.net')) throw new Error('外のサイトへ飛ばされた: ' + r.url);
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'text/plain; charset=utf-8' });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(e.message || e));
    }
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log(`http://localhost:${PORT}/`));
