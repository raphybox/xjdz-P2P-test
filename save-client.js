/**
 * 账号存档客户端 · Steam uid 绑定 + 经济权威回执 + 离线队列
 *
 * 原则：
 *   - 未登录 = 纯本地玩法，不请求任何存档接口，行为与接入前完全一致。
 *   - 已登录 = 云端存档是权威。本地只做乐观 UI，服务端回执覆盖本地值。
 *   - 金币不接受整包同步：每条动作发一条 op，服务端按自己的 SHOP 规则重算。
 *   - 断网时把 op 暂存在 localStorage，恢复后按序重放（opId 幂等，不重复加钱）。
 *
 * 与 game.js 的契约（全部通过事件，互不直接依赖内部变量）：
 *   派发 wowpinball:save-apply    → game.js 用 detail 里的存档重建内存状态
 *   派发 wowpinball:coins-apply   → game.js 用 detail.coins 覆盖本地金币
 *   监听 game.js 调用 touch()/op() 上报变更与动作
 */
(function () {
  'use strict';

  var API = '/api/save';
  var OPS_API = '/api/save/ops';
  var ME_API = '/api/auth/steam/me';
  var OPS_KEY = 'wowpinball.ops.v1';
  var INV_KEY = 'wowpinball.fruits.v1';
  var WALLET_KEY = 'wowpinball.wallet.v1';
  var PROFILE_KEY = 'wowpinball.profile.v1';
  var WRITE_DEBOUNCE = 800;
  var ME_POLL = 30000;
  var OPS_LIMIT = 200;

  var S = {
    logged: false, uid: null, rev: 1, seeded: false, ready: false,
    ops: [], timer: null, flushing: false, online: true, seq: 0
  };

  function lsGet(k, fallback) {
    try { var v = window.localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function lsSet(k, v) {
    try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {}
  }
  function opId() {
    S.seq += 1;
    return 'o' + Date.now().toString(36) + '_' + S.seq.toString(36) + '_' +
      Math.random().toString(36).slice(2, 7);
  }
  function currentLocal() {
    return {
      inventory: lsGet(INV_KEY, { owned: [], skinId: '', skinTheme: 'all', skinsOwned: [] }),
      profile: lsGet(PROFILE_KEY, { name: '' }),
      coins: (function () { var w = lsGet(WALLET_KEY, {}); return isFinite(Number(w.coins)) ? Number(w.coins) : 300; })()
    };
  }
  function applySave(save) {
    if (!save) return;
    S.rev = save.rev;
    S.seeded = !!save.seeded;
    if (save.inventory) lsSet(INV_KEY, save.inventory);
    if (save.profile) lsSet(PROFILE_KEY, save.profile);
    if (isFinite(Number(save.coins))) lsSet(WALLET_KEY, { coins: Number(save.coins) });
    emit('wowpinball:save-apply', save);
  }
  function applyCoins(coins) {
    if (!isFinite(Number(coins))) return;
    lsSet(WALLET_KEY, { coins: Number(coins) });
    emit('wowpinball:coins-apply', { coins: Number(coins) });
  }

  async function api(url, method, body) {
    var init = { method: method || 'GET', credentials: 'same-origin', cache: 'no-store' };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    var r = await fetch(url, init);
    var j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    return { status: r.status, ok: r.ok, body: j || {} };
  }

  /* ---------------- 首次登录：合并游客存档 ---------------- */
  async function bootstrap(save) {
    var local = currentLocal();
    if (!save.seeded && (local.inventory.owned && local.inventory.owned.length ||
        local.profile.name || local.coins !== 300)) {
      var r = await api(API, 'PUT', {
        baseRev: save.rev,
        seed: { coins: local.coins, inventory: local.inventory, profile: local.profile },
        inventory: local.inventory,
        profile: local.profile
      });
      if (r.ok && r.body.save) { applySave(r.body.save); return; }
      if (r.status === 409 && r.body.save) { applySave(r.body.save); return; }
    }
    applySave(save);      // 云端已有存档：直接以云端为准
  }

  async function pull() {
    var r = await api(API, 'GET');
    if (!r.ok) return;
    await bootstrap(r.body.save);
  }

  /* ---------------- 整包写（库存 / 昵称） ---------------- */
  var pending = false;
  async function push() {
    if (!S.logged || !S.ready) return;
    var local = currentLocal();
    var r = await api(API, 'PUT', {
      baseRev: S.rev, inventory: local.inventory, profile: local.profile
    });
    if (r.ok && r.body.save) {
      S.rev = r.body.save.rev;
      S.seeded = !!r.body.save.seeded;
      // 云端回执覆盖金币，防止本地乐观值漂移
      if (isFinite(Number(r.body.save.coins)) && Number(r.body.save.coins) !== local.coins) {
        applyCoins(r.body.save.coins);
      }
    } else if (r.status === 409 && r.body.save) {
      applySave(r.body.save);                 // rev 冲突：以云端为准，下次 touch 再试
      schedule();
    }
  }
  function schedule() {
    if (S.timer) clearTimeout(S.timer);
    S.timer = setTimeout(function () { S.timer = null; push().catch(function () {}); }, WRITE_DEBOUNCE);
    pending = true;
  }

  /* ---------------- 动作队列（金币事务） ---------------- */
  function loadOps() {
    var a = lsGet(OPS_KEY, []);
    S.ops = Array.isArray(a) ? a.slice(-OPS_LIMIT) : [];
  }
  function saveOps() { lsSet(OPS_KEY, S.ops.slice(-OPS_LIMIT)); }

  async function flush() {
    if (!S.logged || !S.ready || S.flushing || !S.ops.length) return;
    S.flushing = true;
    try {
      var batch = S.ops.slice(0, OPS_LIMIT);
      var r = await api(OPS_API, 'POST', { ops: batch });
      if (r.ok && r.body) {
        // 幂等：服务端已处理过的 op 会被跳过，回执给出权威金币
        S.ops = S.ops.slice(batch.length);
        saveOps();
        if (isFinite(Number(r.body.coins))) applyCoins(r.body.coins);
        if (r.body.save && isFinite(Number(r.body.save.rev))) S.rev = r.body.save.rev;
      } else if (r.status === 429 || r.status >= 500) {
        // 限流 / 服务端故障：保留队列，下次 online 或定时再试
      } else {
        S.ops = S.ops.slice(batch.length);   // 4xx：动作非法，丢弃避免卡住队列
        saveOps();
      }
    } catch (e) { /* 断网：保留队列 */ }
    finally { S.flushing = false; }
  }

  /* ---------------- 登录态轮询 ---------------- */
  async function checkMe() {
    var r = await api(ME_API, 'GET');
    var me = r.body || {};
    var was = S.logged;
    S.logged = !!me.logged;
    S.uid = me.uid || null;
    if (!S.logged) { S.ready = false; return; }
    if (!was || !S.ready) {
      try { await pull(); } catch (e) {}
      S.ready = true;
      await flush();
    }
  }

  function init() {
    loadOps();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) S.online = false;
    checkMe().catch(function () {});
    setInterval(function () { checkMe().catch(function () {}); }, ME_POLL);
    window.addEventListener('online', function () {
      S.online = true;
      checkMe().then(flush).catch(function () {});
    });
    window.addEventListener('offline', function () { S.online = false; });
    window.addEventListener('beforeunload', function () { if (pending) saveOps(); });
  }

  /* ---------------- 对外 API ---------------- */
  window.WowPinballSave = {
    /** 库存 / 昵称变了：防抖后整包提交（不含金币） */
    touch: function () { if (S.logged && S.ready) schedule(); },
    /** 金币动作：只报动作，不报金额；离线自动入队 */
    op: function (action) {
      if (!S.logged || !S.ready || !action || typeof action !== 'object') return;
      var o = Object.assign({}, action);
      if (!o.id) o.id = opId();
      S.ops.push(o);
      if (S.ops.length > OPS_LIMIT) S.ops = S.ops.slice(-OPS_LIMIT);
      saveOps();
      flush().catch(function () {});
    },
    status: function () {
      return { logged: S.logged, uid: S.uid, rev: S.rev, seeded: S.seeded,
        ready: S.ready, queued: S.ops.length, online: S.online };
    },
    flush: flush,
    _reset: function () { S.ops = []; saveOps(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
