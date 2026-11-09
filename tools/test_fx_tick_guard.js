/* 特效 tick 死字段防线回归测试

   背景：特效模块的持续伤害早已迁到「伤害·结算」，但后台旧页面会把
   tickDamage / tickDps / tickRadius / tickInterval 原样回写存档，导致
   `data/game-config.json` 反复回潮、test_dmg_dot.js 随机挂掉。
   server.js 原本只在落盘前剥离，当前进程若是旧的就不起作用；
   因此后台在「装载 / 导入 / 提交」三处也各剥一次，server 的 GET 同样剥。
   本测试验证这套防线存在且行为正确。 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const adminSrc = fs.readFileSync(path.join(ROOT, 'admin.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
}

console.log('\n1) 后台前端：函数与调用点');
const start = adminSrc.indexOf('const FX_TICK_KEYS');
const end = adminSrc.indexOf('async function detectServer');
ok('admin.js 里有 stripFxTickFields 定义', start > 0 && end > start, 'start=' + start + ' end=' + end);
const fnSrc = adminSrc.slice(start, end);
ok('死字段清单包含 4 个 tick 键',
  ['tickDamage', 'tickDps', 'tickRadius', 'tickInterval'].every(k => fnSrc.indexOf("'" + k + "'") >= 0));
const normCalls = (adminSrc.match(/normalize\(stripFxTickFields\(d\)\)/g) || []).length;
ok('装载与导入都走剥离（2 处）', normCalls === 2, 'got=' + normCalls);
ok('提交前再剥一次（防止撤销 / 旧快照带回）',
  /body: JSON\.stringify\(stripFxTickFields\(S\.data\)\)/.test(adminSrc));

console.log('\n2) 剥离行为（真实执行函数体）');
const strip = new Function(fnSrc + '\nreturn stripFxTickFields;')();
const boom = () => { throw new Error('不该被修改'); };
const data = {
  skills: [{
    id: 'sk_t', graph: {
      nodes: [
        { id: 'fx1', type: 'fx', params: { effect: 'wind/slash', scale: 2, tickDamage: 6, tickDps: 6, tickRadius: 60, tickInterval: 1 } },
        { id: 'dmg1', type: 'damage', params: { dotEnable: true, dotDps: 6, dotRadius: 60, dotInterval: 1 } },
        { id: 'fx2', type: 'fx', params: null },
        { id: 'fx3', type: 'fx' },
        { id: 'p1', type: 'projectile', params: { tickDamage: 9 } }
      ]
    }
  }]
};
const out = strip(data);
const fx1 = out.skills[0].graph.nodes[0].params;
ok('4 个 tick 死字段全部剥掉', ['tickDamage', 'tickDps', 'tickRadius', 'tickInterval'].every(k => !(k in fx1)),
  Object.keys(fx1).join(','));
ok('其它 fx 参数原样保留', fx1.effect === 'wind/slash' && fx1.scale === 2);
const dmg1 = out.skills[0].graph.nodes[1].params;
ok('伤害模块的 dot* 字段不受影响', dmg1.dotEnable === true && dmg1.dotDps === 6);
ok('params 为 null / 缺失的 fx 节点不报错',
  out.skills[0].graph.nodes[2].params === null && !('params' in out.skills[0].graph.nodes[3]));
ok('非 fx 节点即使带同名键也不动', out.skills[0].graph.nodes[4].params.tickDamage === 9);
ok('非配置结构原样返回（null / 缺 skills）',
  strip(null) === null && (function () { const o = { a: 1 }; return strip(o) === o; })());
ok('就地修改并返回同一对象（不会复制出第二份草稿）', out === data);

console.log('\n3) 服务端：落盘 + 读取双重剥离');
ok('落盘前剥离仍在（POST）', /stripLegacyFxTick\(data\);\s*\/\/[^\n]*|stripLegacyFxTick\(data\)/.test(serverSrc));
const getBlock = serverSrc.slice(serverSrc.indexOf("req.method === 'GET' && url.startsWith('/api/config')"), serverSrc.indexOf("req.method === 'POST' && url.startsWith('/api/config')"));
ok('GET /api/config 也剥一次', /stripLegacyFxTick\(data\)/.test(getBlock));
ok('剥离的是响应对象、不是落盘数据（GET 不改文件）', !/writeFileSync/.test(getBlock));

console.log('\n4) 存档当前干净');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/game-config.json'), 'utf8'));
let dirty = 0;
cfg.skills.forEach(sk => ((sk.graph && sk.graph.nodes) || []).forEach(n => {
  if (n.type === 'fx' && n.params && ['tickDamage', 'tickDps', 'tickRadius', 'tickInterval'].some(k => n.params[k] != null)) dirty++;
}));
ok('data/game-config.json 没有残留 fx tick 字段', dirty === 0, 'dirty=' + dirty);
const pub = fs.readFileSync(path.join(ROOT, 'data/published-config.js'), 'utf8');
ok('published-config.js 同样干净', pub.indexOf('"tickDamage"') < 0 && pub.indexOf('"tickDps"') < 0);

console.log('\n结果: 通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);
