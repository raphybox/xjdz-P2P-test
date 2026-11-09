/* 配置层单测：验证「拥有的技能最大数量」(maxSkills) 在四端闭环
   - game-data.js 默认 config 含 maxSkills
   - config-loader migrate 对缺失 maxSkills 的旧存档回填默认
   - admin.js 全局参数面板 CONFIG_GROUPS 含该字段
   - game.js 接入 CONFIG.MAX_SKILLS 且 openDraft 顶部有封顶闸门
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

/* 1) game-data.js 默认 config */
global.window = {};
require(path.join(ROOT, 'game-data.js'));
const DEF = global.window.WOWPINBALL_DEFAULT;
ok('game-data 默认 config.maxSkills === 9', DEF && DEF.config && DEF.config.maxSkills === 9);

/* 2) config-loader migrate 补全缺失字段 */
const stub = {
  meta: { schema: DEF.meta.schema, gameName: 't', updatedAt: 'x', note: 'x' },
  version: '', versionSeq: 0,
  config: Object.assign({}, DEF.config),
  classes: [{ id: 'c1', name: 'C1', color: '#fff' }],
  skills: [{ id: 's1', name: 'S1', cls: [], enabled: true }],
  maps: [], events: [],
  tierWeights: {}, shop: {}, weather: { enabled: true, types: [] }
};
delete stub.config.maxSkills; // 模拟旧存档缺字段
global.window = {
  WOWPINBALL_DEFAULT: DEF,
  WOWPINBALL_PUBLISHED: undefined,
  localStorage: { getItem: () => JSON.stringify(stub), setItem: () => {} }
};
require(path.join(ROOT, 'config-loader.js'));
const loaded = global.window.WOWPINBALL_DATA;
ok('config-loader 对缺失 maxSkills 回填默认 9', loaded && loaded.config && loaded.config.maxSkills === 9);

/* 3) admin.js 面板字段（静态读取，避免加载 DOM 依赖） */
const adminSrc = fs.readFileSync(path.join(ROOT, 'admin.js'), 'utf8');
ok("admin 面板含 { k: 'maxSkills', label: '拥有的技能最大数量' }",
  /\{[^}]*k:\s*'maxSkills'[^}]*label:\s*'拥有的技能最大数量'/.test(adminSrc));

/* 4) game.js 接入与闸门（静态读取） */
const gameSrc = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
ok('game.js CONFIG 含 MAX_SKILLS 回退默认',
  /MAX_SKILLS:\s*C\.maxSkills\s*!=\s*null\s*\?\s*C\.maxSkills\s*:\s*9/.test(gameSrc));
ok('game.js openDraft 顶部有封顶闸门 (playerSkills.length >= maxSkills)',
  /if\s*\(\s*G\.playerSkills\.length\s*>=\s*maxSkills\s*\)/.test(gameSrc));

console.log('\n配置层单测：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
