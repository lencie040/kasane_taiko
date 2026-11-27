const assert = require('node:assert/strict');
const {test} = require('node:test');
const {estimateKasaneDifficulty,chartRadarScores} = require('../difficulty');

function rate(colors, gap){
  const targets=[...colors].map((color,i)=>({type:'single',t:i*gap,color,speed:.001}));
  return estimateKasaneDifficulty({targets},'oni');
}

test('fast single-color streams raise volume without adding color technique',()=>{
  for(const color of ['d','k']){
    const slow=rate(color.repeat(32),125),fast=rate(color.repeat(32),55);
    assert.equal(fast.technique,0);
    assert.equal(chartRadarScores(fast)[1],0);
    assert(chartRadarScores(fast)[0]>chartRadarScores(slow)[0]);
    assert(fast.quantity>slow.quantity);
  }
});

test('short, irregular color combinations earn more technique than regular alternation',()=>{
  const mixed='ddkdkddkkkddkdddkdkddkkd';
  const regular=rate('dk'.repeat(12),55);
  const slower=rate(mixed,125);
  const fast=rate(mixed,55);
  assert(fast.radarTechnique>regular.radarTechnique);
  assert(fast.radarTechnique>slower.radarTechnique);
});
