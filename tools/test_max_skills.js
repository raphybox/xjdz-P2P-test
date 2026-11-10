/* v3 核心玩法闭环单测（原「maxSkills 封顶」测试改写）
   职业系统已移除、弹珠数值统一；新玩家 5 枚蛋孵化入库，每回合从库存抽一枚果实且只在本回合生效。
   - game-data.js 默认 config 含 hatchEggs、不含 maxSkills / classes / shop
   - config-loader migrate 对旧存档回填 hatchEggs，并补齐 marble / themes / skins
   - game.js：果实库存档、孵化特效、每回合从库存发牌、选中果实覆盖而非叠加
   - admin：职业管理页签与 maxSkills 参数已移除；外观/果实管理存在
   纯 Node 执行，不依赖 DOM。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

/* 1) game-data.js 默认配置 */
global.window = {};
require(path.join(ROOT, 'game-data.js'));
const DEF = global.window.WOWPINBALL_DEFAULT;
ok('默认 config.hatchEggs === 5', DEF && DEF.config && DEF.config.hatchEggs === 5);
ok('默认 config 不再有 maxSkills', DEF && DEF.config && DEF.config.maxSkills == null);
ok('默认 config 不再有 classSkillWeight', DEF && DEF.config && DEF.config.classSkillWeight == null);
ok('职业表 classes 已移除', !('classes' in DEF));
ok('商店 shop 已移除', !('shop' in DEF));
ok('统一弹珠数值 marble 存在', !!(DEF.marble && DEF.marble.hp > 0 && DEF.marble.radius > 0));
ok('外观库与题材存在', Array.isArray(DEF.skins) && DEF.skins.length > 0 && Array.isArray(DEF.themes) && DEF.themes.length > 0);
ok('果实池 skills 每项带 icon 字段且无 cls',
  Array.isArray(DEF.skills) && DEF.skills.every(s => 'icon' in s && !('cls' in s)));
ok('地图出生点扩到 4 个', Array.isArray(DEF.maps) && DEF.maps.every(m => m.spawns && m.spawns.length === 4));

/* 2) config-loader migrate 旧存档 */
const stub = {
  meta: { schema: DEF.meta.schema, gameName: 't', updatedAt: 'x', note: 'x' },
  version: '', versionSeq: 0,
  config: Object.assign({}, DEF.config),
  skills: [{ id: 's1', name: '果实一', cls: ['warrior'], enabled: true, charge: 3 }],
  maps: [], events: [],
  tierWeights: {}, weather: { enabled: true, types: [] }
};
delete stub.config.hatchEggs;
stub.config.maxSkills = 9;   // 模拟旧存档残留
global.window = {
  WOWPINBALL_DEFAULT: DEF,
  WOWPINBALL_PUBLISHED: undefined,
  localStorage: { getItem: () => JSON.stringify(stub), setItem: () => {} }
};
require(path.join(ROOT, 'config-loader.js'));
const loaded = global.window.WOWPINBALL_DATA;
ok('config-loader 对缺失 hatchEggs 回填 5', loaded && loaded.config && loaded.config.hatchEggs === 5);
ok('config-loader 清掉旧 maxSkills', loaded && loaded.config && loaded.config.maxSkills == null);
ok('config-loader 移除旧 classes / shop', loaded && !('classes' in loaded) && !('shop' in loaded));
ok('config-loader 补齐 marble / themes / skins',
  !!(loaded && loaded.marble && loaded.marble.hp > 0 && Array.isArray(loaded.themes) && Array.isArray(loaded.skins)));
ok('config-loader 去掉果实 cls、补 icon',
  !!(loaded && loaded.skills && !('cls' in loaded.skills[0]) && 'icon' in loaded.skills[0]));

/* 3) 后台侧：职业管理与封顶参数已移除 */
const adminSrc = fs.readFileSync(path.join(ROOT, 'admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
ok('admin 面板不再有 maxSkills 参数', !/k:\s*'maxSkills'/.test(adminSrc));
ok('admin.html 不再有职业管理页签', !/data-tab="classes"/.test(adminHtml));
ok('后台有果实图标上传入口', /frIcon_/.test(adminSrc) && /fruitIconUpload/.test(adminSrc));
ok('后台有外观管理', /renderSkins/.test(adminSrc));

/* 4) game.js 闭环 */
const gameSrc = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ok('不再有 MAX_SKILLS 封顶闸门', !/G\.playerSkills\.length\s*>=\s*maxSkills/.test(gameSrc));
ok('openDraft 从玩家果实库抽候选',
  /drawSkills\(G\.playerClass, G\.playerSkills, draftCount, ownFruitIds\(\)\)/.test(gameSrc));
ok('chooseSkill 覆盖而非叠加（果实只管一回合）', /G\.playerSkills = \[x\]/.test(gameSrc));
ok('果实库存档键存在', /wowpinball\.fruits\.v1/.test(gameSrc));
ok('初始蛋孵化使用 spawn/egg-hatch', /spawn\/egg-hatch/.test(gameSrc));
ok('孵化结果写入 INV.owned', /INV\.owned\.push\(/.test(gameSrc));
ok('主页面渲染果实库与外观题材', /function renderLibrary/.test(gameSrc) && /function renderSkins/.test(gameSrc));
ok('首页 DOM 含果实库 / 外观 / 孵化弹层',
  /id="fruitGrid"/.test(html) && /id="skinGrid"/.test(html) && /id="hatchModal"/.test(html));
ok('首页 DOM 不再有职业网格与商店弹层',
  !/id="classGrid"/.test(html) && !/id="shopModal"/.test(html));
ok('联机弹层含 1V1 / 2V2 模式选择',
  /id="p2pMode1v1"/.test(html) && /id="p2pMode2v2"/.test(html));
ok('2V2 四球物理：N×N 两两碰撞', /for \(let ai = 0; ai < bodies\.length; ai\+\+\)/.test(gameSrc));
ok('2V2 快照走 encodeActors', /encodeActors\(/.test(gameSrc));
ok('外观不改变弹珠数值', /MARBLE\.hp/.test(gameSrc) && !/skin\.hp/.test(gameSrc));

console.log('\nv3 核心玩法单测：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
