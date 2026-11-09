// 一次性迁移：把「撞墙后消失 / 撞墙反弹次数」从投射物节点搬到运动器的「撞墙处理」。
// 背景：撞墙属于运动行为，字段归属已改到运动器（scope=projectile 的投射物绑定）。
// 规则：
//   1) 同一技能里找 scope=projectile 且绑定目标匹配的运动器，把 projectile 上的旧值写进去
//   2) 找不到、且旧值不是默认（wallBounce>0 或 dieOnWall=false）→ 新建一个「位移距离=0」的
//      投射物绑定运动器承载撞墙规则（不推动弹体），并接在投射物节点后面
//   3) 迁移完删掉 projectile 上的两个旧字段
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'game-config.json');

const cfg = JSON.parse(fs.readFileSync(SRC, 'utf8'));
let migrated = 0, created = 0, touchedSkills = 0;

cfg.skills.forEach(sk => {
  const g = sk.graph || {};
  const nodes = g.nodes || [];
  const edges = g.edges || (g.edges = []);
  let touched = false;

  nodes.filter(n => n.type === 'projectile').forEach(pj => {
    const p = pj.params || {};
    const hasOld = ('wallBounce' in p) || ('dieOnWall' in p);
    if (!hasOld) return;
    const nm = String(p.name || '').trim();
    const die = p.dieOnWall !== false;                        // 旧数据缺省 = 撞墙消失
    const bounce = Math.max(0, Math.round(Number(p.wallBounce) || 0));

    // 同一技能里能承载这条投射物的运动器：scope=projectile，命名匹配（都为空也算匹配）
    const mot = nodes.find(n => {
      if (n.type !== 'motion') return false;
      const mp = n.params || {};
      if (mp.scope !== 'projectile') return false;
      const target = String(mp.bindTarget || '').trim();
      return target === nm || target === '' || nm === '';
    });

    if (mot) {
      const mp = mot.params || (mot.params = {});
      if (mp.dieOnWall == null) mp.dieOnWall = die;
      if (mp.wallBounce == null) mp.wallBounce = bounce;
    } else if (bounce > 0 || !die) {
      const id = 'motion_wall_' + (pj.id || 'x');
      nodes.push({
        id,
        type: 'motion',
        x: (Number(pj.x) || 0) + 260,
        y: (Number(pj.y) || 0) + 140,
        params: {
          triggerEvent: 'onCast', scope: 'projectile', bindTarget: nm,
          track: 'line', dirFrom: 'velocity', distance: 0, duration: 0.35,
          dieOnWall: die, wallBounce: bounce
        }
      });
      edges.push({ from: pj.id, to: id });
      created++;
    }

    delete p.wallBounce;
    delete p.dieOnWall;
    migrated++;
    touched = true;
  });

  if (touched) touchedSkills++;
});

fs.writeFileSync(SRC, JSON.stringify(cfg, null, 2));
console.log(`migrated projectiles=${migrated} skills=${touchedSkills} createdMotionNodes=${created}`);
// 重新生成静态站副本
const { execSync } = require('child_process');
try { execSync('node tools/export-static-config.js', { cwd: ROOT, stdio: 'inherit' }); }
catch (e) { console.warn('export-static-config 失败（可手动运行）：', e.message); }
