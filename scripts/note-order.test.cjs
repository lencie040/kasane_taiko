const assert = require('node:assert/strict');
const {test} = require('node:test');
const {WIN_HARD,oldestTarget,nearestTarget} = require('../multiplayer-rules');

test('oldest-note targeting uses chart time even when a later note is closer or matches the hit',()=>{
  const targets=[{t:920,type:'single',color:'k'},{t:1000,type:'single',color:'d'}];
  const run={targets,win:WIN_HARD,cursor:0};
  assert.equal(oldestTarget(run,1000),targets[0]);
  assert.equal(nearestTarget(run,1000,'d'),targets[1]);
  assert.equal(nearestTarget(run,1000,'d',true),targets[1]);
});

test('oldest-note targeting skips completed, expired and ineligible chord columns',()=>{
  const targets=[{t:860},{t:930,judged:true},{t:990,type:'chord'},{t:1030},{t:1190}];
  const run={targets,win:WIN_HARD,cursor:0};
  assert.equal(oldestTarget(run,1000),targets[2]);
  assert.equal(oldestTarget(run,1000,990),targets[3]);
  targets[2].judged=true;
  assert.equal(oldestTarget(run,1000),targets[3]);
  targets[3].judged=true;
  assert.equal(oldestTarget(run,1000),null);
});
