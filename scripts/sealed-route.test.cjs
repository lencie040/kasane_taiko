const assert = require('node:assert/strict');
const {test} = require('node:test');
const SealedRoute = require('../sealed-route');

const route = {
  sourcePath:'base.osu',at:2000,character:'character-1',minLevel:5,maxBad:1,maxOk:1,minCombo:0,
};
const chart = (course,times) => ({
  course,length:3000,stats:{chords:0},targets:times.map(t=>({t})),
});

test('a sealed chart requires a normal source and notes on both sides of the split',()=>{
  const target = chart('sealed',[2000,2500]);
  assert.deepEqual(SealedRoute.parse(route),route);
  const {minCombo,...legacy}=route;
  assert.equal(SealedRoute.parse(legacy).minCombo,0);
  for(const invalid of [-1,1.5,null,'30'])assert.equal(SealedRoute.parse({...route,minCombo:invalid}),null);
  assert.equal(SealedRoute.parse({...route,maxOk:-1}),null);
  assert.equal(SealedRoute.parse({...route,minLevel:0}),null);
  assert(SealedRoute.validSplit(route,chart('oni',[1500,2800]),target));
  assert(!SealedRoute.validSplit(route,chart('kasane',[1500,2800]),target));
  assert(!SealedRoute.validSplit(route,chart('oni',[2000,2800]),target));
  assert(!SealedRoute.validSplit(route,chart('oni',[1500,2800]),chart('sealed',[1800])));
});

test('unlock conditions use the equipped character and only judge the source prefix',()=>{
  const character = {id:'character-1'};
  const targets = [
    {t:1200,judged:true,res:'ok'},
    {t:1850,judged:false},
    {t:2000,judged:true,res:'bad'},
    {t:2100,judged:true,res:'ok'},
  ];
  assert(SealedRoute.qualifies(route,character,5,targets));
  assert(!SealedRoute.qualifies(route,character,4,targets));
  assert(!SealedRoute.qualifies(route,null,5,targets));
  assert(!SealedRoute.qualifies({...route,maxBad:0},character,5,targets));
  assert(!SealedRoute.qualifies({...route,maxOk:0},character,5,targets));
  assert(SealedRoute.qualifies({...route,character:null},null,1,targets));
});

test('a streak that reaches the threshold before the split counts after a miss',()=>{
  const character={id:route.character};
  const streak=Array.from({length:30},(_,i)=>({t:1000+i*25,judged:true,res:i===0?'ok':'good'}));
  const miss={t:1800,judged:true,res:'bad'};
  const splitNote={t:route.at,judged:true,res:'good'};
  assert(SealedRoute.qualifies({...route,minCombo:30},character,5,[...streak,miss,splitNote]));
  assert(!SealedRoute.qualifies({...route,minCombo:30,maxBad:0},character,5,[...streak,miss]));
  assert(!SealedRoute.qualifies({...route,minCombo:31},character,5,[...streak,splitNote]));
  const interrupted=[...streak.slice(0,15),{t:1360,judged:false},...streak.slice(15)];
  assert(!SealedRoute.qualifies({...route,minCombo:30},character,5,interrupted));
});

test('life starts at 100 and loses 2 for each OK or 20 for each miss',()=>{
  assert.equal(SealedRoute.life,100);
  assert.equal(SealedRoute.remaining(100,'good'),100);
  assert.equal(SealedRoute.remaining(100,'ok'),98);
  assert.equal(SealedRoute.remaining(98,'bad',4),18);
  assert.equal(SealedRoute.remaining(18,'bad'),0);
});
