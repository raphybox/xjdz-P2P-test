const SM = require('../skill-modules.js');
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + '  got=' + JSON.stringify(got) + (ok ? '' : '  want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}

// 复现截图：source -> 像素特效(fx, 移动路径) -> 事件状态(status, slow, 对手, 命中时)
const skill = {
  name: '测试减速',
  graph: {
    nodes: [
      { id: 's1', type: 'source', params: {} },
      { id: 'fx1', type: 'fx', params: { nature: 'poison-cloud', attach: 'path', pathInterval: 0.15, pathDuration: 7 } },
      { id: 'st1', type: 'status', params: { status: 'slow', statusPower: 0.5, statusDuration: 2, self: false, triggerEvent: 'onHit' } }
    ],
    edges: [
      { from: 's1', to: 'fx1' },
      { from: 'fx1', to: 'st1' }
    ]
  }
};

const C = SM.compile(skill);
const onHit = (C.events && C.events.onHit) || {};
const stList = onHit.status || [];
eq('onHit.status 节点数量', stList.length, 1);
eq('onHit.status[0].status == slow', stList[0] && stList[0].status, 'slow');
eq('onHit.status[0].statusPower', stList[0] && stList[0].statusPower, 0.5);
eq('onHit.status[0].self(作用于自身)', stList[0] && !!stList[0].self, false);
eq('onHit.status[0] 绑定的 host', stList[0] && stList[0]._hostId, '');  // 公共块，应无宿主
eq('onHit.fx 含 path 特效', (onHit.fx || []).some(f => f.attach === 'path'), true);

// 反向对照：如果 status 不连 fx、直接连 source，是否同样进 onHit（验证连接方向不是问题）
const skill2 = JSON.parse(JSON.stringify(skill));
skill2.graph.edges = [{ from: 's1', to: 'st1' }, { from: 's1', to: 'fx1' }];
const C2 = SM.compile(skill2);
eq('直接连 source: onHit.status 数量', (C2.events.onHit.status || []).length, 1);

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
