import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MatchService } from './service.mjs';

const site = resolve(process.env.KASANE_SITE || '.site');
const port = Number(process.env.KASANE_PORT || 8000);
const host = process.env.KASANE_HOST || '127.0.0.1';
const database = new DatabaseSync(process.env.KASANE_MATCH_DB || '.match.sqlite');
database.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS values_store(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
const read = database.prepare('SELECT value FROM values_store WHERE key=?');
const write = database.prepare('INSERT INTO values_store VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
const store = {
  get(key) {
    const row = read.get(key);
    return row ? JSON.parse(row.value) : undefined;
  },
  put(values) {
    database.exec('BEGIN');
    try {
      for (const [key,value] of Object.entries(values)) write.run(key,JSON.stringify(value));
      database.exec('COMMIT');
    } catch(error) {
      database.exec('ROLLBACK');
      throw error;
    }
  },
};
const catalog = JSON.parse(await readFile(resolve(site,'content/match-catalog.json'),'utf8'));
const service = new MatchService(store,()=>catalog.charts);
const contentTypes = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml',
  '.woff2':'font/woff2','.csv':'text/csv; charset=utf-8'};

function json(res,status,value) {
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
}

const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if (url.pathname==='/multiplayer' && req.method==='POST') {
      const origin=req.headers.origin;
      if (origin && new URL(origin).host!==req.headers.host) return json(res,403,{error:'接続元を確認できません。'});
      let body='';
      for await (const part of req) {
        body+=part;
        if (body.length>40000) return json(res,413,{error:'対戦データが大きすぎます。'});
      }
      let input;
      try { input=JSON.parse(body); } catch { return json(res,400,{error:'対戦データを読み込めません。'}); }
      const result=await service.request(input,req.headers['user-agent']||'');
      return json(res,result.error?400:200,result);
    }
    if (req.method!=='GET'&&req.method!=='HEAD') return json(res,405,{error:'利用できない処理です。'});
    const pathname=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    const file=resolve(site,'.'+pathname);
    if(!file.startsWith(site+sep)) return json(res,404,{error:'ファイルがありません。'});
    const info=await stat(file).catch(()=>null);
    if (!info?.isFile()) return json(res,404,{error:'ファイルがありません。'});
    res.writeHead(200,{'Content-Type':contentTypes[extname(file)]||'application/octet-stream','Content-Length':info.size});
    if (req.method==='HEAD') res.end();
    else createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  } catch(error) {
    console.error(error);
    if(!res.headersSent) json(res,500,{error:'対戦サーバーで問題が発生しました。'});
    else res.destroy();
  }
});
server.listen(port,host,()=>console.log(`重ね太鼓 http://${host}:${port}`));
