/**
 * 联机房间信令服务（Durable Object）离线回归测试
 * 运行：node tools/test_room_service.js
 * 覆盖：房间码工具 / 1v1 默认 / 2v2 多座位 / 4 座满员才 409 /
 *       ready 按座位 / 关闭 / 过期 / CORS / OPTIONS
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'api', 'room.js'), 'utf8');
const url = 'data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64');

function fakeState() {
  const m = new Map();
  return {
    _m: m,
    storage: {
      async get(k) { const v = m.get(k); return v == null ? undefined : JSON.parse(JSON.stringify(v)); },
      async put(k, v) { m.set(k, JSON.parse(JSON.stringify(v))); },
      async delete(k) { m.delete(k); },
    },
  };
}

function req(act, method, body) {
  const init = { method: method || 'GET' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return new Request('https://xjdz.de5.net/api/room/' + act, init);
}

async function main() {
  const mod = await import(url);
  assert.ok(mod.RoomHub && mod.normalizeCode && mod.isValidCode && mod.genCode);

  console.log('\n[1] 房间码工具');
  ok('归一化去符号并转大写', mod.normalizeCode('a7kq-2rmx') === 'A7KQ2RMX');
  ok('归一化截断到 8 位', mod.normalizeCode('ABCDEFGHIJK') === 'ABCDEFGH');
  ok('合法码通过', mod.isValidCode('A7KQ2RMX') === true);
  ok('易混淆字符被拒', !mod.isValidCode('AIO01234'));
  ok('长度不足被拒', !mod.isValidCode('A7KQ2RM'));
  const c = mod.genCode();
  ok('随机码 8 位', c.length === 8, c);
  ok('随机码字符集合法', mod.isValidCode(c), c);
  ok('两次随机码不重复', mod.genCode() !== mod.genCode());

  console.log('\n[2] 创建房间（1v1 默认 / 不传 mode）');
  const hub = new mod.RoomHub(fakeState());
  const created = await hub.fetch(req('create', 'POST', { mode: '1v1', offers: [null, 'z.TESTOFFER'], nick: '房主A' }));
  const cc = await created.json();
  ok('创建返回 200', created.status === 200, created.status);
  ok('返回 8 位码', mod.isValidCode(cc.code), cc);
  ok('1v1 → mode 1v1', cc.mode === '1v1', cc);
  ok('1v1 → seats 2', cc.seats === 2, cc);
  ok('房间已落盘', hub.state._m.has('room:' + cc.code));
  ok('响应禁止缓存', /no-store/.test(created.headers.get('Cache-Control') || ''));
  ok('响应允许跨域', created.headers.get('Access-Control-Allow-Origin') === '*');
  const bad = await hub.fetch(req('create', 'POST', { offer: '' }));
  ok('空 offer 被拒 400', bad.status === 400, bad.status);
  const def = await (await hub.fetch(req('create', 'POST', { offers: [null, 'z.DEFOFFER'], nick: '默认房主' }))).json();
  ok('不传 mode 默认 1v1', def.mode === '1v1' && def.seats === 2, def);

  console.log('\n[3] 客机查找房间（按 seat 分配）');
  const wrong = await hub.fetch(req('lookup?code=ZZZZZZZZ', 'GET'));
  ok('不存在的码返回 404', wrong.status === 404, wrong.status);
  ok('错误码带人话提示', /不存在或已过期/.test((await wrong.json()).error || ''));
  const found = await hub.fetch(req('lookup?code=' + cc.code.toLowerCase(), 'GET'));
  const fj = await found.json();
  ok('小写码也能查到', found.status === 200 && fj.offer === 'z.TESTOFFER', fj);
  ok('返回房主昵称', fj.host === '房主A', fj.host);
  ok('分配到 seat1', fj.seat === 1, fj);
  ok('返回 mode/seats', fj.mode === '1v1' && fj.seats === 2, fj);
  // 1v1 只有 seat1 一个客机位，第二次 lookup 应满员 409
  const dup = await hub.fetch(req('lookup?code=' + cc.code, 'GET'));
  ok('1v1 第二人加入被拒 409（满员）', dup.status === 409, dup.status);

  console.log('\n[4] 提交应答与房主轮询');
  const before = await (await hub.fetch(req('poll?code=' + cc.code, 'GET'))).json();
  ok('尚无应答时 answers 全空', before.answers && before.answers[1] === null, before);
  ok('poll 返回 members 全员', Array.isArray(before.members) && before.members.length === 2, before.members);
  ok('members[0] 是已加入的房主', before.members[0].joined === true && before.members[0].nick === '房主A', before.members);
  const ans = await hub.fetch(req('answer', 'POST', {
    code: cc.code, seat: 1, answer: 'r.TESTANSWER', nick: '好友B',
  }));
  ok('提交应答成功', (await ans.json()).ok === true);
  const after = await (await hub.fetch(req('poll?code=' + cc.code, 'GET'))).json();
  ok('房主轮询拿到应答', after.answers[1] === 'r.TESTANSWER', after.answers);
  ok('members[1] 显示好友昵称', after.members[1].nick === '好友B', after.members[1]);
  ok('兼容旧字段 joined/answer', after.joined === true && after.answer === 'r.TESTANSWER', after);
  const dupAns = await hub.fetch(req('answer', 'POST', { code: cc.code, seat: 1, answer: 'r.OTHERANSWER' }));
  ok('同 seat 重复提交应答被拒 409', dupAns.status === 409, dupAns.status);

  console.log('\n[5] ready 状态同步');
  const rd = await hub.fetch(req('ready', 'POST', { code: cc.code, seat: 1, ready: true, nick: '好友B' }));
  ok('ready 提交成功', (await rd.json()).ok === true);
  const afterRd = await (await hub.fetch(req('poll?code=' + cc.code, 'GET'))).json();
  ok('members[1].ready 置真', afterRd.members[1].ready === true, afterRd.members[1]);
  ok('members[0].ready 仍为 false', afterRd.members[0].ready === false, afterRd.members[0]);

  console.log('\n[6] 关闭与过期');
  const closed = await hub.fetch(req('close', 'POST', { code: cc.code }));
  ok('关闭成功', (await closed.json()).ok === true);
  ok('关闭后查不到', (await hub.fetch(req('lookup?code=' + cc.code, 'GET'))).status === 404);

  const hub2 = new mod.RoomHub(fakeState());
  const c2 = await (await hub2.fetch(req('create', 'POST', { mode: '1v1', offers: [null, 'z.EXPIRE'] }))).json();
  const rec = hub2.state._m.get('room:' + c2.code);
  rec.ts = Date.now() - mod.ROOM_TTL - 1000;
  hub2.state._m.set('room:' + c2.code, rec);
  ok('过期房间查不到', (await hub2.fetch(req('lookup?code=' + c2.code, 'GET'))).status === 404);
  ok('过期房间已清理', !hub2.state._m.has('room:' + c2.code));

  console.log('\n[7] 2V2 多座位 create/lookup/answer/poll');
  const hub3 = new mod.RoomHub(fakeState());
  const offers2 = [null, 'z.OFFER1XX', 'z.OFFER2XX', 'z.OFFER3XX'];
  const cr2 = await (await hub3.fetch(req('create', 'POST', { mode: '2v2', offers: offers2, nick: '房主C' }))).json();
  ok('2v2 创建成功', mod.isValidCode(cr2.code), cr2);
  ok('2v2 → mode 2v2', cr2.mode === '2v2', cr2);
  ok('2v2 → seats 4', cr2.seats === 4, cr2);
  // 连续 3 次 lookup 应依次分配 seat 1,2,3
  const l1 = await (await hub3.fetch(req('lookup?code=' + cr2.code, 'GET'))).json();
  const l2 = await (await hub3.fetch(req('lookup?code=' + cr2.code, 'GET'))).json();
  const l3 = await (await hub3.fetch(req('lookup?code=' + cr2.code, 'GET'))).json();
  ok('第一位客机分到 seat1 且拿到对应 offer', l1.seat === 1 && l1.offer === 'z.OFFER1XX', l1);
  ok('第二位客机分到 seat2 且拿到对应 offer', l2.seat === 2 && l2.offer === 'z.OFFER2XX', l2);
  ok('第三位客机分到 seat3 且拿到对应 offer', l3.seat === 3 && l3.offer === 'z.OFFER3XX', l3);
  // 4 座（含房主）满员，第 4 位客机才 409
  const full = await hub3.fetch(req('lookup?code=' + cr2.code, 'GET'));
  ok('4 座满员才 409（前三人都能加入）', full.status === 409, full.status);
  // 三个座位分别提交应答
  await hub3.fetch(req('answer', 'POST', { code: cr2.code, seat: 1, answer: 'r.ANSWER1X', nick: '客机1' }));
  await hub3.fetch(req('answer', 'POST', { code: cr2.code, seat: 2, answer: 'r.ANSWER2X', nick: '客机2' }));
  await hub3.fetch(req('answer', 'POST', { code: cr2.code, seat: 3, answer: 'r.ANSWER3X', nick: '客机3' }));
  const poll2 = await (await hub3.fetch(req('poll?code=' + cr2.code, 'GET'))).json();
  ok('poll.members 返回 4 个座位', poll2.members.length === 4, poll2.members);
  ok('poll.answers[0] 恒为 null', poll2.answers[0] === null, poll2.answers);
  ok('poll.answers 三个客机应答齐', poll2.answers[1] === 'r.ANSWER1X' && poll2.answers[2] === 'r.ANSWER2X' && poll2.answers[3] === 'r.ANSWER3X', poll2.answers);
  ok('成员昵称按 seat 写入', poll2.members[1].nick === '客机1' && poll2.members[3].nick === '客机3', poll2.members);
  // ready 按座位独立
  await hub3.fetch(req('ready', 'POST', { code: cr2.code, seat: 2, ready: true }));
  const poll3 = await (await hub3.fetch(req('poll?code=' + cr2.code, 'GET'))).json();
  ok('ready 只影响目标 seat', poll3.members[2].ready === true && poll3.members[1].ready === false && poll3.members[3].ready === false, poll3.members);
  const dupA2 = await hub3.fetch(req('answer', 'POST', { code: cr2.code, seat: 2, answer: 'r.DUPANSXX' }));
  ok('2v2 同 seat 重复应答 409', dupA2.status === 409, dupA2.status);

  console.log('\n[8] 其它');
  ok('OPTIONS 预检 204', (await hub.fetch(req('create', 'OPTIONS'))).status === 204);
  ok('未知动作 404', (await hub.fetch(req('nope', 'GET'))).status === 404);

  console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + ': ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
