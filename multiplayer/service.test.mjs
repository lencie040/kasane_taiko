import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import rules from '../multiplayer-rules.js';
import { MatchService } from './service.mjs';

const pc = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
const mobile = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
const chart = {uid:'fixture::easy',title:'fixture',path:'content/songs/fixture.ktz',hash:'a'.repeat(40),course:'easy',
  level:3.5,length:1800,firstT:500,targets:[{t:500,type:'single',color:'d'},{t:1500,type:'single',color:'d'}],rolls:[]};

function fixture(charts=[chart]) {
  const data = new Map();
  const store = {
    get: key=>structuredClone(data.get(key)),
    put: values=>{ for (const [key,value] of Object.entries(values)) data.set(key,structuredClone(value)); },
  };
  const service = new MatchService(store,()=>charts);
  return {store,service};
}

test('casual difficulty bounds and ranked league adjacency',()=>{
  const choices=[1,7.9,8,12].map(level=>({...chart,level}));
  const novice=rules.freshProfile();
  assert.equal(rules.chooseChart(choices,'casual',[novice,novice],()=>0).level,1);
  assert.equal(rules.chooseChart(choices,'casual',[novice,novice],()=>.999).level,7.9);
  const of=(league,rating)=>({...novice,league,rating});
  for(const [a,b,allowed] of [[0,1,true],[0,2,false],[1,2,true],[1,3,false],[2,3,true],[2,4,false],[3,4,true]]) {
    assert.equal(rules.canMatch(of(a,1000),of(b,1000)),allowed);
    assert.equal(rules.canMatch(of(b,1000),of(a,1000)),allowed);
  }
  assert.equal(rules.canMatch(of(3,1000),of(4,1151)),false);
  assert.equal(rules.canMatch(of(4,1200),of(4,1300)),true);
  assert.equal(rules.canMatch(of(4,1200),of(4,1600)),false);
  assert.equal(rules.chooseChart(choices,'ranked',[of(4,1600),of(4,1600)],()=>0).level,12);
});

test('completed losses can promote and masters use Elo',()=>{
  let loser=rules.freshProfile();
  for(let i=0;i<84;i++)loser=rules.advanceProfile(loser,rules.freshProfile(),0,true);
  assert.equal(loser.league,4);
  assert.equal(loser.rating,1000);
  const won=rules.advanceProfile(loser,loser,1,true);
  assert.equal(won.rating,1016);
  assert.equal(rules.advanceProfile(loser,loser,0,true).rating,984);
});

test('device queues are separate and the player who reaches a tied score earlier wins',async()=>{
  const {service,store}=fixture();
  const [a,b,c]=Array.from({length:3},()=>crypto.randomUUID());
  const req=(token,agent,now,action,fields={})=>service.request({token,action,...fields},agent,now);
  assert.equal((await req(a,pc,1000,'join',{mode:'ranked'})).status,'waiting');
  assert.equal((await req(c,mobile,1001,'join',{mode:'ranked'})).status,'waiting');
  const second=await req(b,pc,1002,'join',{mode:'ranked'});
  const id=second.match.id;
  assert.equal(second.match.device,'pc');
  await req(a,pc,1003,'ready',{match:id});
  const {match:{start}}=await req(b,pc,1004,'ready',{match:id});
  const hit=(who,time,hits,done=false)=>req(who,pc,time,'tick',{match:id,batch:1,hits,done,score:99999999});
  // B's request arrives first, but A reaches the tied final score earlier in the song.
  const bHits=[[1,500],[2,1510]];
  const aHits=[[1,500],[2,1490]];
  assert.equal((await hit(b,start+1700,bHits)).match.scores[1],1000000);
  await hit(a,start+1800,aHits);
  assert.equal((await hit(b,start+1850,bHits)).match.scores[1],1000000);
  await hit(b,start+2900,[],true);
  const done=await hit(a,start+2950,[],true);
  assert.equal(done.status,'result');
  assert.deepEqual(done.match.scores,[1000000,1000000]);
  assert.equal(done.match.result.winner,0);
  assert.equal(done.match.result.tiebreak,true);
  assert.equal(done.profile.points,2);
  const restart=new MatchService(store,()=>[chart]);
  const profile=(await restart.request({token:b,action:'status'},pc,start+3000)).profile;
  assert.equal(profile.points,1);
  assert.equal((await req(c,mobile,start+3000,'status')).status,'waiting');
});

test('an early cancellation leaves the ranked profile untouched',async()=>{
  const {service}=fixture();
  const [a,b]=Array.from({length:2},()=>crypto.randomUUID());
  const req=(token,at,action,extra={})=>service.request({token,action,...extra},pc,at);
  await req(a,1000,'join',{mode:'ranked'});
  const {match}=await req(b,1001,'join',{mode:'ranked'});
  const result=await req(a,1002,'leave',{match:match.id});
  assert.equal(result.match.result.reason,'cancelled');
  assert.equal(result.profile.played,0);
  assert.equal((await req(b,1003,'status')).match.result.reason,'cancelled');
});

test('standard note, big note, roll, balloon and sealed-note scoring',()=>{
  const targets=[{t:300,type:'single',color:'d',big:true},{t:600,type:'single',color:'k',noise:'left'}];
  const rolls=[{t:800,end:900,big:true},{t:1000,end:1100,hits:2}];
  const state=rules.newScore();
  const inputs=[[1,300],[2,315],[0,600],[1,810],[0,1000],[1,1010],[2,1030]];
  for(const [i,[role,time]] of inputs.entries())rules.scoreInput(state,{...chart,targets,rolls},role,time,i,false);
  assert.equal(state.score,1005800);
  assert.equal(state.reached,1030);
});
