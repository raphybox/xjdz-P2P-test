require('../skill-flow-guard.js');
const SM = require('../skill-modules.js');
const FG = global.SkillFlowGuard;

// 复现截图：source -> fx(移动路径) -> status(slow, 对手, 命中时)
function graph(kind) {
  return {
    name: '测试减速',
    graph: {
      nodes: [
        { id: 's1', type: 'source', params: {} },
        { id: 'fx1', type: 'fx', params: { nature: 'poison-cloud', attach: 'path', pathInterval: 0.15, pathDuration: 7 } },
        { id: 'st1', type: 'status', params: { status: 'slow', statusPower: 0.5, statusDuration: 2, self: false, triggerEvent: 'onHit' } }
      ],
      edges: [
        { from: 's1', to: 'fx1', kind: kind },
        { from: 'fx1', to: 'st1', kind: kind }
      ]
    }
  };
}

['bind', 'flow', undefined].forEach(function (kind) {
  const sk = graph(kind);
  const sum = FG.summarize(sk, SM);
  console.log('\n==== edge kind = ' + JSON.stringify(kind) + ' | model=' + sum.model + ' | errors=' + sum.errors + ' warnings=' + sum.warnings + ' ====');
  sum.issues.forEach(function (x) {
    console.log('  [' + x.level + '] ' + x.code + ' :: ' + x.msg + (x.node ? '  (node=' + x.node + ')' : ''));
  });
});
