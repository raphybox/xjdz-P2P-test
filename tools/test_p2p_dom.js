/* P2P 冒烟：game.js 引用的所有 DOM id 必须存在于 index.html */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const ids = new Set();
let m;
const re = /\$\('([A-Za-z0-9_]+)'\)/g;
while ((m = re.exec(game))) ids.add(m[1]);

const missing = [...ids].filter(id => !html.includes('id="' + id + '"'));
assert.deepStrictEqual(missing, [], '缺失的 DOM id: ' + missing.join(', '));

// P2P / 房间页关键元素必须齐
['p2pBtn', 'p2pModal', 'p2pRoomCodeIn', 'p2pStatus', 'p2pStageSel', 'p2pStageJoin',
 'roomScreen', 'roomCode', 'roomCopyBtn', 'roomStatus', 'roomMyReady', 'roomPeerReady',
 'roomMyNick', 'roomPeerNick', 'roomClassGrid', 'roomReadyBtn', 'roomLeaveBtn',
 'roomSharedHint', 'roomMsg'].forEach(id => {
  assert.ok(html.includes('id="' + id + '"'), 'P2P/房间元素缺失: ' + id);
});
// 脚本引入顺序：net.js / sync.js 必须在 game.js 之前
const order = ['net.js', 'sync.js', 'game.js'].map(s => html.indexOf('src="' + s + '"'));
assert.ok(order.every(i => i > 0) && order[0] < order[1] && order[1] < order[2], 'script 引入顺序错误');

console.log('test_p2p_dom: ' + ids.size + ' ids checked, all present');
