const assert = require('node:assert/strict');
const {test} = require('node:test');
const SealedRoute = require('../sealed-route');

const route = {
  sourcePath:'base.osu',at:2000,character:'character-1',minLevel:5,maxBad:1,maxOk:1,
};
const chart = (course,times) => ({
  course,length:3000,stats:{chords:0},targets:times.map(t=>({t})),
});

test('a sealed chart requires a normal source and notes on both sides of the split',()=>{
  const target = chart('sealed',[2000,2500]);
  assert.deepEqual(SealedRoute.parse(route),route);
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

test('life starts at 100 and loses 2 for each OK or 20 for each miss',()=>{
  assert.equal(SealedRoute.life,100);
  assert.equal(SealedRoute.remaining(100,'good'),100);
  assert.equal(SealedRoute.remaining(100,'ok'),98);
  assert.equal(SealedRoute.remaining(98,'bad',4),18);
  assert.equal(SealedRoute.remaining(18,'bad'),0);
});
