/* 战斗记录「技能伤害归因到技能名」回归测试
   ① 编译层：SkillModules.compile 把技能名带进 C（含 publicView / viewFor 两份预编译视图），
     所有运行时视图都能直接取到，不用回查技能表；
   ② 标签归一化：字符串 = 纯机制来源，{ name, tag } = 技能名 + 机制补充，缺名兜底「技能」；
   ③ 统计聚合：byKind 按技能名归并，同一技能的直伤 / 区域 / 印记算到同一个技能名下；
   ④ 明细行结构：四列栅格 span（方向 / 伤害 / 来源 / 剩余），来源名做 HTML 转义，不再出现「技能」这种泛称；
   ⑤ 摘要 chips：来源按伤害从高到低排，空数据回退「暂无」。 */
const path = require('path');
const SM = require(path.join(__dirname, '..', 'skill-modules.js'));

let pass = 0, fail = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; }
  else { fail++; console.log('FAIL ' + name + '\n  actual  = ' + a + '\n  expect  = ' + b); }
}
function ok(name, cond) { eq(name, !!cond, true); }

/* —— 复刻 game.js 的标签归一化 —— */
function dmgLabel(label) {
  if (label && typeof label === 'object') {
    const name = String(label.name == null ? '' : label.name).trim();
    const tag = String(label.tag == null ? '' : label.tag).trim();
    return { name: name || '技能', tag: tag };
  }
  const s = String(label == null ? '' : label).trim();
  return { name: s || '撞击', tag: '' };
}
function skillLabel(C, tag) {
  const n = String((C && C.name) || '').trim();
  return { name: n || '技能', tag: tag || '' };
}
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* —— ① 编译层带技能名 —— */
const graph = {
  nodes: [
    { id: 'src', type: 'source', params: { trigger: 'onCharge', enabled: true } },
    { id: 'proj', type: 'projectile', params: { name: '主弹体', speed: 320 } },
    { id: 'dmg', type: 'damage', params: { base: 20 } }
  ],
  edges: [{ from: 'src', to: 'proj' }, { from: 'proj', to: 'dmg' }]
};
const C = SM.compile({ id: 'sk_lava', name: '熔岩迸发', graph: graph });
eq('编译：C.name = 技能名', C.name, '熔岩迸发');
eq('编译：C.sid = 技能 id', C.sid, 'sk_lava');
eq('编译：publicView 也带技能名', SM.publicView(C).name, '熔岩迸发');
const hosts = SM.hostsOf(C) || [];
const hostId = hosts.length ? hosts[0].id : '';
ok('编译：存在投射物载体', hostId === 'proj');
eq('编译：载体视图带技能名', SM.viewFor(C, hostId).name, '熔岩迸发');
eq('编译：技能无 name 时为空串（不污染）', SM.compile({ id: 'x', graph: graph }).name, '');

/* —— ② 标签归一化 —— */
eq('标签：字符串来源', dmgLabel('撞击'), { name: '撞击', tag: '' });
eq('标签：null 兜底撞击', dmgLabel(null), { name: '撞击', tag: '' });
eq('标签：空白兜底撞击', dmgLabel('   '), { name: '撞击', tag: '' });
eq('标签：技能名 + 机制补充', dmgLabel({ name: '熔岩迸发', tag: '区域残留' }), { name: '熔岩迸发', tag: '区域残留' });
eq('标签：对象缺 name 兜底技能', dmgLabel({ tag: '光环' }), { name: '技能', tag: '光环' });
eq('标签：对象 tag 为空', dmgLabel({ name: '熔岩迸发' }), { name: '熔岩迸发', tag: '' });
eq('skillLabel：C 有名字', skillLabel(C), { name: '熔岩迸发', tag: '' });
eq('skillLabel：带 tag', skillLabel(C, '溅射'), { name: '熔岩迸发', tag: '溅射' });
eq('skillLabel：C 无名字兜底技能', skillLabel({}), { name: '技能', tag: '' });
eq('skillLabel：C 为 null 兜底技能', skillLabel(null), { name: '技能', tag: '' });

/* —— ③ 统计按技能名聚合（复刻 recordDamage 的 byKind 逻辑）—— */
function stats() {
  const s = { total: { player: 0, enemy: 0 }, round: { player: 0, enemy: 0 }, byKind: { player: {}, enemy: {} }, hits: { player: 0, enemy: 0 } };
  return {
    rec(side, dmg, label) {
      const L = dmgLabel(label);
      s.total[side] += dmg; s.round[side] += dmg;
      s.byKind[side][L.name] = (s.byKind[side][L.name] || 0) + dmg;
      s.hits[side] += 1;
    },
    get: () => s
  };
}
const st = stats();
st.rec('player', 20, skillLabel(C));                     // 直伤
st.rec('player', 12, { name: '熔岩迸发', tag: '区域残留' }); // 同一技能的区域
st.rec('player', 8, { name: '熔岩迸发', tag: '印记·撕裂' }); // 同一技能的印记
st.rec('player', 52, '撞击');
st.rec('enemy', 75, '撞击');
const S = st.get();
eq('聚合：同技能三种机制并到一条', S.byKind.player['熔岩迸发'], 40);
eq('聚合：撞击单列', S.byKind.player['撞击'], 52);
eq('聚合：不再出现泛称「技能」', S.byKind.player['技能'], undefined);
eq('聚合：累计伤害 = 各来源之和', S.total.player, 92);
eq('聚合：对手来源独立统计', S.byKind.enemy['撞击'], 75);
eq('聚合：命中次数', S.hits.player, 4);

/* —— ④ 明细行结构 —— */
function logLine(side, dmg, L, crit, pct, remain) {
  const who = side === 'player' ? '我方 → 对手' : '对手 → 我方';
  return '<span class="lg-dir">' + who + '</span>' +
    '<span class="lg-val">-' + Math.round(dmg) + '</span>' +
    '<span class="lg-src"><b title="' + escHtml(L.name) + '">' + escHtml(L.name) + '</b>' +
    (L.tag ? '<i>' + escHtml(L.tag) + '</i>' : '') +
    (crit ? '<i class="lg-crit">暴击</i>' : '') + '</span>' +
    '<span class="lg-hp">' + remain + ' ' + pct + '%</span>';
}
const line = logLine('player', 20, skillLabel(C), false, 36, '对手');
ok('明细：有方向列', line.indexOf('<span class="lg-dir">我方 → 对手</span>') >= 0);
ok('明细：伤害值列 -20', line.indexOf('<span class="lg-val">-20</span>') >= 0);
ok('明细：显示技能名而不是「技能」', line.indexOf('<b title="熔岩迸发">熔岩迸发</b>') >= 0 && line.indexOf('>技能<') < 0);
ok('明细：剩余血量列', line.indexOf('<span class="lg-hp">对手 36%</span>') >= 0);
ok('明细：无 tag 时不渲染空 chip', line.indexOf('<i></i>') < 0);
const lineTag = logLine('enemy', 8, dmgLabel({ name: '冰霜新星', tag: '光环' }), true, 50, '我方');
ok('明细：机制 tag 单独成 chip', lineTag.indexOf('<i>光环</i>') >= 0);
ok('明细：暴击标记', lineTag.indexOf('<i class="lg-crit">暴击</i>') >= 0);
ok('明细：四列 span 齐全', ['lg-dir', 'lg-val', 'lg-src', 'lg-hp'].every(k => lineTag.indexOf(k) >= 0));
const lineXss = logLine('player', 5, dmgLabel({ name: '<img src=x>', tag: '"a"' }), false, 10, '对手');
ok('明细：技能名做 HTML 转义', lineXss.indexOf('&lt;img src=x&gt;') >= 0 && lineXss.indexOf('<img') < 0);

/* —— ⑤ 摘要 chips：按伤害倒序 —— */
function chips(byKind) {
  const keys = Object.keys(byKind).filter(x => byKind[x] > 0).sort((a, b) => byKind[b] - byKind[a]);
  if (!keys.length) return '<span class="ds-empty">暂无</span>';
  return keys.map(x => '<span class="ds-chip" title="' + escHtml(x) + '"><b>' + escHtml(x) + '</b>' + Math.round(byKind[x]) + '</span>').join('');
}
const ch = chips({ '撞击': 52, '熔岩迸发': 40, '冰霜新星': 8 });
ok('摘要：伤害高的排前面', ch.indexOf('撞击') < ch.indexOf('熔岩迸发') && ch.indexOf('熔岩迸发') < ch.indexOf('冰霜新星'));
eq('摘要：空数据回退暂无', chips({}), '<span class="ds-empty">暂无</span>');
eq('摘要：0 值来源不显示', chips({ '撞击': 0 }), '<span class="ds-empty">暂无</span>');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'HAS FAIL') + ' / total ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
