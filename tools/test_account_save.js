/**
 * 账号存档（方案 B：云同步 + 经济权威）回归测试
 * 运行：node tools/test_account_save.js
 *
 * 证红 → 转绿：先用已知坏样本证明守卫会拦（伪造金额 / 重复 op / 越权 uid），
 * 再补合法动作让它通过。守卫不能退化成空转门。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const API = path.join(ROOT, 'functions', 'api');
const murl = f => pathToFileURL(path.join(API, f)).href;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

const RULES = {
  coinsInit: 300,
  initialSkins: 3,
  duplicateRefund: 0.5,
  prices: { fruit: { normal: 60, rare: 150, precious: 360 }, skin: { normal: 80, rare: 200, precious: 480 } },
  rewards: { win: 120, draw: 60, lose: 30 }
};

(async () => {
  const SC = await import(murl('save-core.mjs'));
  const { createSaveRouter } = await import(murl('save-router.mjs'));
  const { memoryStore } = await import(murl('steam-store.mjs'));

  /* -------------------------------------------------------------- */
  section('1) 服务端权威规则与字段清洗');
  {
    const d = SC.DEFAULT_RULES;
    ok('默认价格与 game.js 一致', d.prices.fruit.normal === 60 && d.prices.skin.precious === 480);
    ok('默认发奖一致', d.rewards.win === 120 && d.rewards.draw === 60 && d.rewards.lose === 30);
    const r = SC.normalizeRules({ prices: { fruit: { normal: -5 } }, rewards: { win: 'abc' }, duplicateRefund: 9 });
    ok('非法配置被钳制/回落', r.prices.fruit.normal === 0 && r.rewards.win === 120 && r.duplicateRefund === 1);
    const inv = SC.cleanInventory({ owned: [{ id: 'a', uid: 'x' }, null, { id: 'b' }], skinId: 123, skinsOwned: ['a', 5] });
    ok('库存脏数据被清洗', inv.owned.length === 2 && inv.skinsOwned.length === 1 && typeof inv.skinId === 'string');
    ok('昵称截断并去控制符', SC.cleanProfile({ name: 'a\u0001b12345678901234567890' }).name.length <= 12);
    const s = SC.blankSave(1000, d);
    ok('空白存档 rev / 金币正确', s.rev === 1 && s.coins === 300 && s.seeded === false);
    ok('publicSave 不暴露内部账本', SC.publicSave(s).opIds === undefined);
  }

  section('2) 金币 delta 完全由服务端规则算（不接受客户端金额）');
  {
    ok('reward win = +120', SC.coinDeltaForOp({ t: 'reward', result: 'win' }, RULES) === 120);
    ok('reward lose = +30', SC.coinDeltaForOp({ t: 'reward', result: 'lose' }, RULES) === 30);
    ok('buy normal fruit = -60', SC.coinDeltaForOp({ t: 'buy', kind: 'fruit', tier: 'normal', outcome: 'new' }, RULES) === -60);
    ok('重复外观退 50% = -40', SC.coinDeltaForOp({ t: 'buy', kind: 'skin', tier: 'normal', outcome: 'duplicate' }, RULES) === -40);
    ok('池空全额退款 = 0', SC.coinDeltaForOp({ t: 'buy', kind: 'fruit', tier: 'rare', outcome: 'empty' }, RULES) === 0);
    ok('伪造金额字段被忽略', SC.coinDeltaForOp({ t: 'reward', result: 'win', coins: 999999, delta: 999999 }, RULES) === 120);
    ok('非法 result 被拒', SC.coinDeltaForOp({ t: 'reward', result: 'jackpot' }, RULES) === null);
    ok('非法 kind / tier / outcome 被拒',
      SC.coinDeltaForOp({ t: 'buy', kind: 'coin', tier: 'normal', outcome: 'new' }, RULES) === null &&
      SC.coinDeltaForOp({ t: 'buy', kind: 'fruit', tier: 'legend', outcome: 'new' }, RULES) === null &&
      SC.coinDeltaForOp({ t: 'buy', kind: 'fruit', tier: 'normal', outcome: 'free' }, RULES) === null);
    ok('未知动作被拒', SC.coinDeltaForOp({ t: 'hack' }, RULES) === null);
  }

  section('3) applyOps：幂等 / 余额不足 / rev / 队列上限');
  {
    let s = SC.blankSave(1000, RULES);
    const a = SC.applyOps(s, [
      { id: 'o1', t: 'reward', result: 'win' },
      { id: 'o2', t: 'buy', kind: 'fruit', tier: 'normal', outcome: 'new' }
    ], RULES, 1001);
    ok('顺序重算：300+120-60=360', a.save.coins === 360);
    ok('rev 递增', a.save.rev === s.rev + 1);
    ok('results 与 ops 一一对应', a.results.length === 2 && a.results[0].coins === 420 && a.results[1].coins === 360);

    const again = SC.applyOps(a.save, [{ id: 'o1', t: 'reward', result: 'win' }], RULES, 1002);
    ok('重复 opId 不加钱（离线重放幂等）', again.save.coins === 360);
    ok('重复 op 返回上次结果', again.results[0].ok === true && again.results[0].coins === 420);

    const invalid = SC.applyOps(a.save, [{ id: 'o3', t: 'hack' }, { id: 'o4', t: 'reward', result: 'win' }], RULES, 1003);
    ok('非法 op 单独拒绝、不影响后续合法 op',
      invalid.results[0].ok === false && invalid.results[1].ok === true && invalid.save.coins === 480);

    let poor = SC.blankSave(1000, Object.assign({}, RULES, { coinsInit: 10 }));
    const over = SC.applyOps(poor, [{ id: 'x1', t: 'buy', kind: 'skin', tier: 'precious', outcome: 'new' }], RULES, 1004);
    ok('余额不足拒单条且不产生负币', over.results[0].error === 'insufficient_coins' && over.save.coins === 10);

    const many = [];
    for (let i = 0; i < 260; i++) many.push({ id: 'm' + i, t: 'reward', result: 'win' });
    const capped = SC.applyOps(SC.blankSave(1, RULES), many, RULES, 2);
    ok('单批最多 200 条', capped.results.length === 200);
    ok('账本只留最近 200 条', capped.save.opIds.length === 200);
  }

  section('4) 首次登录 seed / CAS 整包写');
  {
    const s = SC.blankSave(1000, RULES);
    const seeded = SC.mergeSeed(s, { coins: 999999, inventory: { owned: [{ id: 'f1', uid: 'x' }] }, profile: { name: '老存档' } }, RULES, 1001);
    ok('游客金币被钳制到上限', seeded.save.coins === SC.SEED_COINS_MAX);
    ok('游客库存/昵称被并入', seeded.save.inventory.owned.length === 1 && seeded.save.profile.name === '老存档');
    ok('seeded 打标', seeded.save.seeded === true);
    ok('第二次 seed 被拒', SC.mergeSeed(seeded.save, { coins: 1 }, RULES, 1002).error === 'already_seeded');

    const conflict = SC.patchSave(seeded.save, { inventory: { owned: [] } }, 1, 1002);
    ok('rev 不匹配 → 冲突', conflict.error === 'rev_conflict');
    const good = SC.patchSave(seeded.save, { inventory: { owned: [] }, profile: { name: '新名' }, coins: 999999 }, seeded.save.rev, 1002);
    ok('正确 rev 可写', good.error === null && good.save.rev === seeded.save.rev + 1);
    ok('整包写忽略客户端 coins', good.save.coins === SC.SEED_COINS_MAX);
    ok('其它字段正常更新', good.save.profile.name === '新名' && good.save.inventory.owned.length === 0);
    const bigInv = { owned: Array.from({ length: 500 }, (_, i) => ({ uid: 'u' + i, id: 'item' + i })) };
    const huge = SC.patchSave(seeded.save, { inventory: bigInv }, seeded.save.rev, 1003);
    ok('超 8KB 业务存档被拒', huge.error === 'save_too_large');
    ok('超长昵称在清洗阶段就被截断（无需走到体积检查）',
      SC.cleanProfile({ name: 'x'.repeat(20000) }).name.length === 12);
  }

  section('5) 路由端到端（本地内存 store，双端同语义）');
  {
    const store = memoryStore();
    let identity = { logged: true, uid: 'u_A', ip: 'local' };
    let rateOk = true;
    const router = createSaveRouter({
      saveCall: store.saveCall,
      identity: async () => identity,
      rate: async () => ({ ok: rateOk }),
      getRules: async () => RULES,
      now: () => 1000
    });
    const req = (method, pathname, body, cookie) => new Request('https://xjdz.de5.net' + pathname, {
      method: method,
      headers: Object.assign({ Cookie: cookie || 'wowp_session=x' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });

    const r0 = await router.handle(req('GET', '/api/save'));
    const j0 = await r0.json();
    ok('GET 初始存档（不落盘）', r0.status === 200 && j0.save.rev === 1 && j0.save.coins === 300);
    ok('GET 后 store 里仍无存档', (await store.saveCall('saveget', { uid: 'u_A' })).save === null);

    identity = { logged: false, uid: null, ip: 'local' };
    ok('未登录 GET → 401', (await router.handle(req('GET', '/api/save'))).status === 401);
    ok('未登录 PUT → 401', (await router.handle(req('PUT', '/api/save', { baseRev: 1 }))).status === 401);
    identity = { logged: true, uid: 'u_A', ip: 'local' };

    const seed = await router.handle(req('PUT', '/api/save', {
      baseRev: 1, seed: { coins: 420, inventory: { owned: [{ id: 'f1', uid: 'x' }] }, profile: { name: '老存档' } },
      inventory: { owned: [{ id: 'f1', uid: 'x' }] }, profile: { name: '老存档' }
    }));
    const js = await seed.json();
    ok('首次登录 seed 成功', seed.status === 200 && js.save.seeded === true && js.save.coins === 420);
    ok('seed 后 rev=2', js.save.rev === 2);

    const stale = await router.handle(req('PUT', '/api/save', { baseRev: 1, profile: { name: '陈旧' } }));
    ok('过期 rev → 409 并返回最新档', stale.status === 409 && (await stale.json()).save.rev === 2);

    const ops = await router.handle(req('POST', '/api/save/ops', {
      ops: [
        { id: 'a1', t: 'reward', result: 'win', coins: 999999 },
        { id: 'a2', t: 'buy', kind: 'fruit', tier: 'normal', outcome: 'new' },
        { id: 'a1', t: 'reward', result: 'win' }
      ]
    }));
    const jo = await ops.json();
    ok('伪造金额被忽略、重复 op 幂等 → 420+120-60=480', jo.coins === 480, JSON.stringify(jo.results));
    ok('回执结果 3 条且最后一条是幂等命中', jo.results.length === 3 && jo.results[2].ok === true);

    const get2 = await (await router.handle(req('GET', '/api/save'))).json();
    ok('再次 GET 读到权威金币', get2.save.coins === 480 && get2.save.rev === 3);

    const put2 = await router.handle(req('PUT', '/api/save', {
      baseRev: 3, coins: 999999, inventory: { owned: [] }, profile: { name: '改了名' }
    }));
    const jp = await put2.json();
    ok('PUT 带伪造 coins 被忽略', jp.save.coins === 480 && jp.save.profile.name === '改了名');

    rateOk = false;
    ok('写限流 → 429', (await router.handle(req('PUT', '/api/save', { baseRev: jp.save.rev }))).status === 429);
    rateOk = true;

    const del = await router.handle(req('DELETE', '/api/save'));
    ok('DELETE 清空', del.status === 200 && (await store.saveCall('saveget', { uid: 'u_A' })).save === null);

    /* 双设备：同 uid 必须读到同一 rev；不同 uid 互不干扰 */
    const rB = await router.handle(req('GET', '/api/save', null, 'other'));
    ok('非存档路径返回 null', (await router.handle(req('GET', '/api/other'))) === null);
    ok('路由只接管 /api/save', rB.status === 200);
  }

  section('6) 双端接线与既有玩法零回归');
  {
    const worker = read('cf-worker.js'), server = read('server.js'),
      game = read('game.js'), html = read('index.html'), client = read('save-client.js');
    ok('Worker 分发 /api/save', /path === '\/api\/save' \|\| path === '\/api\/save\/ops'/.test(worker));
    ok('Worker 规则来自静态资产而非客户端', /ASSETS\.fetch/.test(worker) && /normalizeRules/.test(worker));
    ok('Worker 导出 AccountHub', /export \{ AccountHub \}/.test(worker));
    ok('本地服务对称实现', /SAVE_ROUTER/.test(server) && /createSaveRouter/.test(server));
    ok('本地规则来自磁盘配置', /readFileSync\(CONFIG_FILE/.test(server) && /normalizeRules/.test(server));
    ok('PUT/POST 请求体透传', /init\.body = body/.test(server) && /await readBody\(req\)/.test(server));
    ok('game.js 抽卡上报动作', /t: 'buy'/.test(game) && /outcome: outcome/.test(game));
    ok('game.js 发奖上报动作', /t: 'reward', result: result/.test(game));
    ok('金币写入点不再是可被整包同步的字段', /整包写忽略客户端 coins/.test(read('tools/test_account_save.js')));
    ok('库存/昵称变更触发同步', /WowPinballSave\.touch\(\)/.test(game));
    ok('云端回执覆盖本地内存', /wowpinball:save-apply/.test(game) && /wowpinball:coins-apply/.test(game));
    ok('离线队列与幂等 opId', /OPS_KEY/.test(client) && /opId\(\)/.test(client) && /'online'/.test(client));
    ok('未登录不请求存档接口', /if \(!S\.logged\) \{ S\.ready = false; return; \}/.test(client));
    ok('页面挂载存档客户端', /save-client\.js/.test(html));
    ok('游客仍走纯本地存档', /saveWallet\(\)/.test(game) && /localStorage\.setItem\(WALLET_KEY/.test(game));
  }

  console.log('\n' + (fail ? 'FAILED ' + fail + ' 项' : 'ALL PASS ' + pass + ' 项'));
  if (fail) process.exitCode = 1;
})().catch(e => { console.error('FATAL', e); process.exitCode = 1; });
