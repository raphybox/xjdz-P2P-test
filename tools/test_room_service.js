/**
 * 联机房间信令服务（Durable Object）离线回归测试
 * 运行：node tools/test_room_service.js
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

  console.log('\n[2] 创建房间');
  const hub = new mod.RoomHub(fakeState());
  const created = await hub.fetch(req('create', 'POST', { offer: 'z.TESTOFFER', nick: '房主A' }));
  const cc = await created.json();
  ok('创建返回 200', created.status === 200, created.status);
  ok('返回 8 位码', mod.isValidCode(cc.code), cc);
  ok('房间已落盘', hub.state._m.has('room:' + cc.code));
  ok('响应禁止缓存', /no-store/.test(created.headers.get('Cache-Control') || ''));
  ok('响应允许跨域', created.headers.get('Access-Control-Allow-Origin') === '*');
  const bad = await hub.fetch(req('create', 'POST', { offer: '' }));
  ok('空 offer 被拒 400', bad.status === 400, bad.status);

  console.log('\n[3] 客机查找房间');
  const wrong = await hub.fetch(req('lookup?code=ZZZZZZZZ', 'GET'));
  ok('不存在的码返回 404', wrong.status === 404, wrong.status);
  ok('错误码带人话提示', /不存在或已过期/.test((await wrong.json()).error || ''));
  const found = await hub.fetch(req('lookup?code=' + cc.code.toLowerCase(), 'GET'));
  const fj = await found.json();
  ok('小写码也能查到', found.status === 200 && fj.offer === 'z.TESTOFFER', fj);
  ok('返回房主昵称', fj.host === '房主A', fj.host);

  console.log('\n[4] 提交应答与房主轮询');
  const before = await (await hub.fetch(req('poll?code=' + cc.code, 'GET'))).json();
  ok('尚无应答时 joined=false', before.joined === false && before.answer === null, before);
  const ans = await hub.fetch(req('answer', 'POST', {
    code: cc.code, answer: 'r.TESTANSWER', nick: '好友B',
  }));
  ok('提交应答成功', (await ans.json()).ok === true);
  const after = await (await hub.fetch(req('poll?code=' + cc.code, 'GET'))).json();
  ok('房主轮询拿到应答', after.answer === 'r.TESTANSWER', after);
  ok('房主轮询看到好友昵称', after.guest === '好友B', after.guest);
  ok('joined 置真', after.joined === true);
  const dup = await hub.fetch(req('lookup?code=' + cc.code, 'GET'));
  ok('第二人加入被拒 409', dup.status === 409, dup.status);
  const dupAns = await hub.fetch(req('answer', 'POST', { code: cc.code, answer: 'r.OTHERANSWER' }));
  ok('重复提交应答被拒 409', dupAns.status === 409, dupAns.status);

  console.log('\n[5] 关闭与过期');
  const closed = await hub.fetch(req('close', 'POST', { code: cc.code }));
  ok('关闭成功', (await closed.json()).ok === true);
  ok('关闭后查不到', (await hub.fetch(req('lookup?code=' + cc.code, 'GET'))).status === 404);

  const hub2 = new mod.RoomHub(fakeState());
  const c2 = await (await hub2.fetch(req('create', 'POST', { offer: 'z.EXPIRE' }))).json();
  const rec = hub2.state._m.get('room:' + c2.code);
  rec.ts = Date.now() - mod.ROOM_TTL - 1000;
  hub2.state._m.set('room:' + c2.code, rec);
  ok('过期房间查不到', (await hub2.fetch(req('lookup?code=' + c2.code, 'GET'))).status === 404);
  ok('过期房间已清理', !hub2.state._m.has('room:' + c2.code));

  console.log('\n[6] 其它');
  ok('OPTIONS 预检 204', (await hub.fetch(req('create', 'OPTIONS'))).status === 204);
  ok('未知动作 404', (await hub.fetch(req('nope', 'GET'))).status === 404);

  console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + ': ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
