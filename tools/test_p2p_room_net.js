/* P2P 房间码协议冒烟：net.js 导出、短码归一化、API 存在性 */
const assert = require('assert');
global.window = {};
require('../net.js');
const NET = global.window.WowPinballNet;

assert.ok(NET && NET.Session, 'net 模块未导出 Session');
assert.strictEqual(typeof NET.normalizeRoomCode, 'function', '缺少 normalizeRoomCode');
assert.strictEqual(typeof NET.Session.createHostRoom, 'function', '缺少 createHostRoom');
assert.strictEqual(typeof NET.Session.joinRoom, 'function', '缺少 joinRoom');
assert.strictEqual(typeof NET.Session.createHost, 'function', '手动信令 createHost 应保留');
assert.strictEqual(typeof NET.Session.createGuest, 'function', '手动信令 createGuest 应保留');

assert.strictEqual(NET.normalizeRoomCode('a7kq-2rmx'), 'A7KQ2RMX');
assert.strictEqual(NET.normalizeRoomCode('  a b 7 k q 2 r m x z z '), 'AB7KQ2RM');
assert.strictEqual(NET.normalizeRoomCode(null), '');
assert.ok(/^[A-HJ-NP-Z2-9]{8}$/.test(NET.normalizeRoomCode('a7kq2rmx')));

console.log('test_p2p_room_net: all assertions passed');
