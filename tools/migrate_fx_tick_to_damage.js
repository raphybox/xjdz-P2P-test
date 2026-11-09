// 一次性迁移：把特效节点上遗留的「持续伤害」字段（tickDamage/tickDps/tickRadius/tickInterval）
// 迁移到「伤害·结算」模块（新字段 dotEnable/dotDps/dotRadius/dotInterval/dotFollow/dotDuration）。
// 与墙面残留同一思路：伤害数值统一在伤害模块配置。特效节点若没有伤害模块则新建一个并接入图。
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'game-config.json');

const cfg = JSON.parse(fs.readFileSync(SRC, 'utf8'));
let migratedSkills = 0, createdDamage = 0;

cfg.skills.forEach(s => {
  const nodes = (s.graph && s.graph.nodes) || [];
  const fxWithTick = nodes.filter(n => n.type === 'fx' && (n.params || {}).tickDamage);
  if (!fxWithTick.length) return;
  const dmgNodes = nodes.filter(n => n.type === 'damage');
  const dmg = dmgNodes[0];
  const targets = dmg ? [dmg] : [];
  if (!dmg) {
    // 没有伤害模块：在 source 之后新建一个并接入图（沿用 source→range→fx 的 source 作为上游）
    const src = nodes.find(n => n.type === 'source') || nodes[0];
    const id = 'damage_mig_' + (s.id || 'x');
    const node = {
      id, type: 'damage',
      params: { triggerEvent: 'onHit' }
    };
    nodes.push(node);
    (s.graph.edges || (s.graph.edges = [])).push({ from: src.id, to: id });
    targets.push(node);
    createdDamage++;
  }
  // 把每个 fx 节点的遗留 tick 字段搬到伤害模块，并清理 fx 上的旧字段
  fxWithTick.forEach(fx => {
    const p = fx.params;
    targets.forEach(d => {
      const dp = d.params;
      if (dp.dotEnable !== true) dp.dotEnable = true;
      if (dp.dotDps == null) dp.dotDps = Number(p.tickDps) || 8;
      if (dp.dotRadius == null) dp.dotRadius = Number(p.tickRadius) || 70;
      if (dp.dotInterval == null) dp.dotInterval = Number(p.tickInterval) || 0.5;
      if (dp.dotFollow == null) dp.dotFollow = 'caster';
      if (dp.dotDuration == null) dp.dotDuration = 6;
    });
    ['tickDamage', 'tickDps', 'tickRadius', 'tickInterval'].forEach(k => delete p[k]);
  });
  migratedSkills++;
});

fs.writeFileSync(SRC, JSON.stringify(cfg, null, 2));
console.log(`migrated skills=${migratedSkills} createdDamageNodes=${createdDamage}`);
// 重新生成静态站副本
const { execSync } = require('child_process');
try { execSync('node tools/export-static-config.js', { cwd: ROOT, stdio: 'inherit' }); }
catch (e) { console.warn('export-static-config 失败（可手动运行）：', e.message); }
