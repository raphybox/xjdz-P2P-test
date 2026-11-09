/* 后台界面编辑器：房间页与联机弹层图层必须注册，且选择器能在页面里找到 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'ui-layout.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// 抽出两组定义块做静态检查（避免为 Node 模拟完整 DOM）
const roomBlock = ui.match(/\{ id: 'room',[\s\S]*?\n    \] \},/);
const p2pBlock = ui.match(/\{ id: 'p2p',[\s\S]*?\n    \] \}/);
assert.ok(roomBlock, 'ui-layout.js 缺少 room（联机房间）屏幕定义');
assert.ok(p2pBlock, 'ui-layout.js 缺少 p2p（联机弹层）定义');

const keySelectors = {
  room: ['#roomScreen', '#roomScreen .room-shell', '#roomCode', '#roomCopyBtn', '#roomStatus',
         '#roomMyCard', '#roomPeerCard', '#roomMyReady', '#roomPeerReady',
         '#roomClassGrid', '#roomReadyBtn', '#roomSharedHint', '#roomLeaveBtn'],
  p2p: ['#p2pModal', '#p2pCreateBtn', '#p2pJoinBtn', '#p2pRoomCodeIn',
        '#p2pAcceptBtn', '#p2pStatus', '#p2pStageJoin'],
};
[...keySelectors.room.map(s => [s, roomBlock[0]]), ...keySelectors.p2p.map(s => [s, p2pBlock[0]])]
  .forEach(([sel, block]) => {
    assert.ok(block.includes("'" + sel), '图层定义缺少选择器: ' + sel);
    const id = sel.match(/^#([\w-]+)$/);
    if (id) assert.ok(html.includes('id="' + id[1] + '"'), 'index.html 缺少元素: ' + sel);
  });

// 首页「联机对战」按钮必须单独成图层，否则点它只会选到整组 .start-actions
const startBlock = ui.match(/var START_BASE = \[[\s\S]*?\n  \];/);
assert.ok(startBlock, 'ui-layout.js 缺少 START_BASE');
assert.ok(startBlock[0].includes("['p2pBtn', '联机对战按钮', '#p2pBtn']"),
  'START_BASE 缺少 p2pBtn 图层');
assert.ok(html.includes('id="p2pBtn"'), 'index.html 缺少 #p2pBtn');

// 编辑器切屏时，加入面板默认 hidden，必须强制展开才能改素材
assert.ok(/#p2pStageJoin/.test(ui.match(/var FORCE_VISIBLE = \[[\s\S]*?\];/)[0]),
  'FORCE_VISIBLE 未包含 #p2pStageJoin');

// 启动即构建房间职业网格，后台才能编辑「首个职业按钮」
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
assert.ok(/renderClassGrid\(\);\s*\n\s*p2pRoomBuildClasses\(\);/.test(game),
  'game.js 启动区未预建房间职业网格');

// 一键同步：推域名绑定仓库 + wrangler 部署
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.js'), 'utf8');
const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
assert.ok(/\['push', 'xjdz', 'main'\]/.test(server) || /push', 'xjdz'/.test(server), '一键同步未推 xjdz-P2P-test');
assert.ok(/wrangler, 'deploy'/.test(server), '一键同步未执行 wrangler deploy');
assert.ok(/api\/room/.test(server), '本地服务缺少 /api/room');
// 主仓库必须成功、镜像仓库失败只警告；点击时必须有可见反馈
assert.ok(/mirrorWarning/.test(server), '镜像仓库失败未与整体结果分离');
assert.ok(/正在同步上线 xjdz\.de5\.net/.test(admin), '点击后缺少进行中提示');
assert.ok(/syncBtn\.disabled = true/.test(admin), '点击后未禁用按钮');
assert.ok(/g\.deployed/.test(admin) && /g\.mirrorWarning/.test(admin), '后台未分类展示部署/镜像结果');
assert.ok(/未连接本地服务/.test(admin), '未连服务时缺少明确提示');
assert.ok(/\.wrangler\//.test(ignore), '.gitignore 未排除 wrangler 临时目录');

console.log('test_room_ui_layout: all assertions passed');
