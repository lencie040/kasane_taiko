import { MatchService } from './service.mjs';

const json = (body,status=200,headers={}) => Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});

export class MatchRoom {
  constructor(ctx,env) {
    this.env=env;
    this.service=new MatchService(ctx.storage,()=>this.getCatalog());
  }

  async getCatalog() {
    if (this.charts && Date.now()<this.catalogExpires) return this.charts;
    const url=new URL('content/match-catalog.json',this.env.SITE_URL);
    const response=await fetch(url);
    if (!response.ok) throw Error('Could not fetch the published chart catalog');
    const data=await response.json();
    if (data.format!==1 || !Array.isArray(data.charts)) throw Error('Invalid chart catalog');
    this.charts=data.charts;
    this.catalogExpires=Date.now()+60000;
    return this.charts;
  }

  async fetch(request) {
    const bytes=await request.text();
    if (bytes.length>40000) return json({error:'対戦データが大きすぎます。'},413);
    let input;
    try { input=JSON.parse(bytes); } catch { return json({error:'対戦データを読み込めません。'},400); }
    const result=await this.service.request(input,request.headers.get('User-Agent')||'');
    return json(result,result.error?400:200);
  }
}

export default {
  async fetch(request,env) {
    const origin=request.headers.get('Origin');
    const allowed=new URL(env.SITE_URL).origin;
    const path=new URL(request.url).pathname;
    if (path!=='/multiplayer') return json({error:'利用できない処理です。'},404);
    if (origin!==allowed) return json({error:'接続元を確認できません。'},403);
    const cors = {'Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Methods':'POST, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'};
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
    if (request.method!=='POST') return json({error:'利用できない処理です。'},405,cors);
    try {
      const room=env.MATCH_ROOM.getByName('kasane-match-v1');
      const response=await room.fetch(request);
      const headers=new Headers(response.headers);
      for (const [key,value] of Object.entries(cors)) headers.set(key,value);
      return new Response(response.body,{status:response.status,headers});
    } catch(error) {
      console.error(error);
      return json({error:'対戦サーバーで問題が発生しました。'},500,cors);
    }
  },
};
