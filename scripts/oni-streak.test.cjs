const {strict:assert}=require('node:assert');
const {test}=require('node:test');
const {STAGES,starBand,groupCharts,pickCharts,canClear,cleared}=require('../oni-streak');

const chart=(key,level,properties={})=>({
  level,course:'oni',set:{key},stats:{notes:20},...properties,
});

test('both courses have ten stages, and plus and 10.x charts share the integer band',()=>{
  assert.deepEqual(STAGES.normal,[1,2,3,4,5,6,7,8,9,10]);
  assert.deepEqual(STAGES.hard,[5,6,7,8,9,10,10,10,10,10]);
  assert.deepEqual([5,5.9,6.5,10,10.9,11].map(starBand),[5,5,6,10,10,11]);
  const groups=groupCharts([
    chart('plus',5.5),chart('plain',5.0),chart('ten',10.9),chart('eleven',11),
    chart('demo',5,{set:{key:'demo',demo:true}}),chart('kasane',5,{course:'kasane'}),
  ]);
  assert.deepEqual([...groups.get(5).keys()],['plus','plain']);
  assert.deepEqual([...groups.get(10).keys()],['ten']);
  assert(!groups.has(11));
});

test('picks keep future stages playable with different songs',()=>{
  const groups=groupCharts([
    chart('a',5),chart('a',5.1),chart('a',6),chart('b',5),chart('c',5),chart('d',5),chart('e',5),chart('e',7),
  ]);
  const picks=pickCharts(groups,[5,6,7],new Set(),()=>0);
  assert.deepEqual(picks.map(c=>c.set.key),['b','c','d']);
  assert.deepEqual(pickCharts(groups,[6,7],new Set(['b']),()=>0).map(c=>c.set.key),['a']);
  assert.deepEqual(pickCharts(groups,[6,7],new Set(['a']),()=>0),[]);
});

test('immediate elimination uses the maximum possible gauge with remaining notes',()=>{
  const base={notes:100,judged:70,gu:10000/75,gauge:4000};
  assert(canClear(base,8000));
  assert(!canClear({...base,judged:71},8000));
  assert(canClear({...base,judged:71,ab:{fx:{gain:1,gainClear:1.2}}},8000));
  assert(!cleared(base,8000));
  assert(cleared({...base,gauge:8000},8000));
});
