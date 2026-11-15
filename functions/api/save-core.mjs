/**
 * 账号存档 · 纯逻辑核心（Cloudflare Worker / 本地 server.js / 离线测试单源）
 *
 * 设计要点（方案 B：云同步 + 经济权威）
 *   1) 存档按内部 uid 存，绝不用 SteamID64 作 key（uid 与 Steam 身份已解耦）。
 *   2) 金币不接受客户端整包覆盖：客户端只提交「动作」，服务端按自己的
 *      SHOP 规则重算 delta，回执覆盖本地乐观值 —— 这是防刷的关键。
 *   3) 其它存档（库存 / 昵称）走 rev 乐观锁整包 PUT，金币字段一律忽略。
 *   4) 每条 op 带 id，服务端记账去重，离线重放不会重复加钱。
 *   5) 首次登录仅当云端为空时接受一次游客存档（seeded），之后云端恒为权威。
 */

export const SAVE_LIMIT_BYTES = 8 * 1024;
export const OPS_QUEUE_LIMIT = 200;
export const SEED_COINS_MAX = 5000;      // 游客档首次并入时金币上限，避免刷满再登录
export const REV_START = 1;

const TIERS = ['normal', 'rare', 'precious'];
const KINDS = ['fruit', 'skin'];
const OUTCOMES = ['new', 'duplicate', 'empty'];
const RESULTS = ['win', 'draw', 'lose'];

function int(v, def, lo, hi) {
  const n = Number(v);
  return isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : def;
}
function obj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }

/** 把后台 shop 配置收敛成服务端权威规则；缺字段一律回落到与 game.js 一致的默认值。 */
export function normalizeRules(shop) {
  const s = obj(shop);
  const p = obj(s.prices), r = obj(s.rewards);
  /* 果实与外观的默认价不同，别复用同一组（与 game.js 的 SHOP.prices 一致） */
  const DEFAULT_PRICES = {
    fruit: { normal: 60, rare: 150, precious: 360 },
    skin: { normal: 80, rare: 200, precious: 480 }
  };
  const prices = {};
  KINDS.forEach(k => {
    const pk = obj(p[k]);
    prices[k] = {};
    TIERS.forEach(t => { prices[k][t] = int(pk[t], DEFAULT_PRICES[k][t], 0, 100000); });
  });
  const rewards = {};
  RESULTS.forEach(k => { rewards[k] = int(r[k], { win: 120, draw: 60, lose: 30 }[k], 0, 100000); });
  return {
    coinsInit: int(s.coinsInit, 300, 0, 100000),
    initialSkins: int(s.initialSkins, 3, 1, 100),
    duplicateRefund: Math.max(0, Math.min(1, Number(s.duplicateRefund) || 0.5)),
    prices: prices,
    rewards: rewards
  };
}
export const DEFAULT_RULES = normalizeRules(null);

/* -------------------------------------------------------------------------
   存档字段清洗：只保留已知键，防止脏数据 / 超长字符串把存档撑爆
   ------------------------------------------------------------------------- */
export function cleanInventory(v, validIds) {
  const x = obj(v);
  const ids = validIds && typeof validIds.has === 'function' ? validIds : null;
  const owned = Array.isArray(x.owned) ? x.owned.filter(o => o && typeof o.id === 'string' && (!ids || ids.has(o.id)))
    .slice(0, 500).map(o => ({ uid: String(o.uid || '').slice(0, 40), id: o.id })) : [];
  let skinsOwned = Array.isArray(x.skinsOwned) ? x.skinsOwned.filter(s => typeof s === 'string').slice(0, 200) : [];
  if (!skinsOwned.length) skinsOwned = [];
  return {
    owned: owned,
    skinId: String(x.skinId || '').slice(0, 80),
    skinTheme: String(x.skinTheme || 'all').slice(0, 40),
    skinsOwned: skinsOwned
  };
}
export function cleanProfile(v) {
  const x = obj(v);
  return { name: String(x.name || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 12) };
}
export function blankSave(now, rules) {
  return {
    rev: REV_START,
    coins: rules.coinsInit,
    inventory: { owned: [], skinId: '', skinTheme: 'all', skinsOwned: [] },
    profile: { name: '' },
    seeded: false,
    updatedAt: now,
    opIds: [],
    opResults: []
  };
}
/* 8KB 限额只管业务存档字段；opIds / opResults 是服务端幂等账本，
   已有 200 条硬上限，不该被业务体积误伤（否则批量重放会被自身账本撑爆）。 */
function sizeOk(save) {
  try {
    return JSON.stringify({
      inventory: save.inventory, profile: save.profile, coins: save.coins
    }).length <= SAVE_LIMIT_BYTES;
  } catch (e) { return false; }
}

/** 首次登录合并：只有云端还是空白存档时接受一次，且金币钳制到上限。 */
export function mergeSeed(save, seed, rules, now) {
  if (save.seeded || save.rev > REV_START || save.opIds.length) {
    return { save: save, error: 'already_seeded' };
  }
  const s = obj(seed);
  const next = Object.assign({}, save, {
    coins: int(s.coins, rules.coinsInit, 0, SEED_COINS_MAX),
    inventory: cleanInventory(s.inventory),
    profile: cleanProfile(s.profile),
    seeded: true,
    updatedAt: now,
    rev: save.rev + 1
  });
  if (!sizeOk(next)) return { save: save, error: 'save_too_large' };
  return { save: next, error: null };
}

/** 整包 PUT：CAS + 字段白名单（coins 一律忽略，只能由 ops 改）。 */
export function patchSave(save, patch, baseRev, now) {
  if (baseRev !== save.rev) return { save: save, error: 'rev_conflict' };
  const p = obj(patch);
  const next = Object.assign({}, save, {
    inventory: p.inventory === undefined ? save.inventory : cleanInventory(p.inventory),
    profile: p.profile === undefined ? save.profile : cleanProfile(p.profile),
    updatedAt: now,
    rev: save.rev + 1
  });
  if (!sizeOk(next)) return { save: save, error: 'save_too_large' };
  return { save: next, error: null };
}

/** 单条动作的金币 delta，完全由服务端规则算；返回 null 表示非法动作。 */
export function coinDeltaForOp(op, rules) {
  if (!op || typeof op !== 'object') return null;
  if (op.t === 'reward') {
    if (RESULTS.indexOf(op.result) < 0) return null;
    return rules.rewards[op.result];
  }
  if (op.t === 'buy') {
    if (KINDS.indexOf(op.kind) < 0 || TIERS.indexOf(op.tier) < 0 || OUTCOMES.indexOf(op.outcome) < 0) return null;
    const price = rules.prices[op.kind][op.tier];
    if (!(price > 0)) return null;
    let d = -price;
    if (op.outcome === 'duplicate') d += Math.round(price * rules.duplicateRefund);
    else if (op.outcome === 'empty') d += price;   // 池空全额退款
    return d;
  }
  return null;
}

/**
 * 批量重放 ops。逐条幂等（已见过的 id 直接返回上次结果）、余额不足拒单条而不污染其它。
 * 返回 { save, results }，results 与输入 ops 一一对应。
 */
export function applyOps(save, ops, rules, now) {
  const list = Array.isArray(ops) ? ops.slice(0, OPS_QUEUE_LIMIT) : [];
  let cur = Object.assign({}, save, { opIds: save.opIds.slice(), opResults: save.opResults.slice() });
  const results = [];
  for (let i = 0; i < list.length; i++) {
    const op = obj(list[i]);
    const id = String(op.id || '').slice(0, 80);
    if (!id) { results.push({ ok: false, error: 'missing_op_id' }); continue; }
    const seenAt = cur.opIds.indexOf(id);
    if (seenAt >= 0) { results.push(cur.opResults[seenAt] || { ok: false, error: 'duplicate_op' }); continue; }

    const delta = coinDeltaForOp(op, rules);
    if (delta === null) { results.push({ ok: false, error: 'invalid_op' }); continue; }
    const nextCoins = cur.coins + delta;
    if (nextCoins < 0) { results.push({ ok: false, error: 'insufficient_coins', coins: cur.coins }); continue; }

    cur.coins = Math.max(0, Math.round(nextCoins));
    cur.opIds.push(id);
    const res = { ok: true, coins: cur.coins, delta: delta };
    cur.opResults.push(res);
    results.push(res);
  }
  // 账本只保留最近 N 条，下标对齐
  if (cur.opIds.length > OPS_QUEUE_LIMIT) {
    const cut = cur.opIds.length - OPS_QUEUE_LIMIT;
    cur.opIds = cur.opIds.slice(cut);
    cur.opResults = cur.opResults.slice(cut);
  }
  cur.rev = save.rev + 1;
  cur.updatedAt = now;
  if (!sizeOk(cur)) return { save: save, results: results, error: 'save_too_large' };
  return { save: cur, results: results, error: null };
}

/** 回给前端的存档视图：不含内部账本，避免把 opIds 暴露出去。 */
export function publicSave(save) {
  return {
    rev: save.rev,
    coins: save.coins,
    inventory: save.inventory,
    profile: save.profile,
    seeded: !!save.seeded,
    updatedAt: save.updatedAt
  };
}
