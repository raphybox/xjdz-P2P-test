/**
 * AccountHub · 账号与风控的 Durable Object（单实例强一致）
 *
 * 设计要点（对应「内部用户 ID 与 SteamID 解耦」）：
 *   accounts.identities 里记的是 {provider, providerUid}，uid 是本系统随机生成的主键。
 *   业务侧（金币、建房额度、匹配频次）只认 uid，永远不要把 SteamID 当业务主键。
 *   将来要换 / 增加登录方式，只需往同一个 uid 追加一条 identity（见 link），
 *   不用迁移任何业务数据 —— 这也是给 OpenID 2.0 技术债留的退路。
 *
 * 与 RoomHub 保持一致，使用 storage.get/put 的 KV 风格接口，不写裸 SQL：
 *   identity:<provider>:<providerUid>  → uid
 *   account:<uid>                      → { uid, identities, nick, avatar, ... }
 *   rate:<key>                         → number[]（滑动窗口时间戳）
 */

import { newUid, rateAllow } from './steam-auth.mjs';

const RATE_TTL_MS = 15 * 60 * 1000;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export class AccountHub {
  constructor(state) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const act = (url.pathname.split('/').filter(Boolean).pop() || '').toLowerCase();
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
    }
    try {
      let body = null;
      if (request.method === 'POST') { try { body = await request.json(); } catch (e) { body = null; } }
      const b = body || Object.fromEntries(url.searchParams);

      if (act === 'resolve' && request.method === 'POST') return json(await this.resolve(b));
      if (act === 'get') return json(await this.get(b.uid));
      if (act === 'link' && request.method === 'POST') return json(await this.link(b));
      if (act === 'rate' && request.method === 'POST') return json(await this.rate(b));
      if (act === 'stats') return json(await this.stats());
      return json({ error: 'unknown_action' }, 404);
    } catch (e) {
      return json({ error: 'server_error', detail: String((e && e.message) || e) }, 500);
    }
  }

  /** 按外部身份找到（或首次创建）内部 uid。同一 SteamID 永远返回同一个 uid。 */
  async resolve(b) {
    const provider = String(b.provider || 'steam').slice(0, 24);
    const providerUid = String(b.providerUid || '').slice(0, 64);
    if (!providerUid) return { error: 'missing_provider_uid' };
    const now = Date.now();
    const idxKey = 'identity:' + provider + ':' + providerUid;
    let uid = await this.storage.get(idxKey);
    let acc = uid ? await this.storage.get('account:' + uid) : null;

    if (!acc) {
      uid = uid || newUid();
      acc = {
        uid: uid,
        identities: [{ provider: provider, providerUid: providerUid }],
        nick: String(b.nick || '').slice(0, 32),
        avatar: String(b.avatar || '').slice(0, 256),
        createdAt: now,
        lastLoginAt: now,
        loginCount: 1
      };
      await this.storage.put(idxKey, uid);
    } else {
      acc.lastLoginAt = now;
      acc.loginCount = (acc.loginCount || 0) + 1;
      if (b.nick) acc.nick = String(b.nick).slice(0, 32);
      if (b.avatar) acc.avatar = String(b.avatar).slice(0, 256);
    }
    await this.storage.put('account:' + uid, acc);
    // 不把 providerUid 回吐给前端：身份层与业务层只传 uid
    return { uid: acc.uid, nick: acc.nick, avatar: acc.avatar, createdAt: acc.createdAt, loginCount: acc.loginCount };
  }

  async get(uid) {
    if (!uid) return { account: null };
    const acc = await this.storage.get('account:' + String(uid));
    if (!acc) return { account: null };
    return { account: { uid: acc.uid, nick: acc.nick, avatar: acc.avatar, createdAt: acc.createdAt, loginCount: acc.loginCount } };
  }

  /** 预留：把另一种登录方式绑到已有 uid，实现「换登录方式而业务数据不变」。 */
  async link(b) {
    const uid = String(b.uid || '');
    const provider = String(b.provider || '').slice(0, 24);
    const providerUid = String(b.providerUid || '').slice(0, 64);
    if (!uid || !provider || !providerUid) return { error: 'missing_fields' };
    const acc = await this.storage.get('account:' + uid);
    if (!acc) return { error: 'account_not_found' };
    const idxKey = 'identity:' + provider + ':' + providerUid;
    const taken = await this.storage.get(idxKey);
    if (taken && taken !== uid) return { error: 'identity_bound_to_other_account' };
    acc.identities = acc.identities || [];
    if (!acc.identities.some(i => i.provider === provider && i.providerUid === providerUid)) {
      acc.identities.push({ provider: provider, providerUid: providerUid });
    }
    await this.storage.put(idxKey, uid);
    await this.storage.put('account:' + uid, acc);
    return { ok: true, uid: uid, identityCount: acc.identities.length };
  }

  /** 滑动窗口限流。key 由调用方按 uid（未登录按 IP）构造，服务端不信任前端传的 uid。 */
  async rate(b) {
    const key = String(b.key || '').slice(0, 160);
    const limit = Math.max(1, Math.min(10000, Number(b.limit) || 10));
    const windowMs = Math.max(1000, Math.min(3600000, Number(b.windowMs) || 60000));
    if (!key) return { ok: false, error: 'missing_key' };
    const rk = 'rate:' + key;
    const hits = await this.storage.get(rk) || [];
    const r = rateAllow(hits, limit, windowMs);
    await this.storage.put(rk, r.hits);
    return { ok: r.ok, remaining: Math.max(0, limit - r.hits.length), retryAfterMs: r.retryAfterMs || 0 };
  }

  async stats() {
    const accounts = await this.storage.list({ prefix: 'account:' });
    const identities = await this.storage.list({ prefix: 'identity:' });
    return { accounts: accounts.size, identities: identities.size };
  }
}

/* 过期的 rate 窗口只是少量内存，DO 生命周期内无需主动清理；
   真要清理可在 stats 后跑一次，这里保持简单，避免影响登录主链路延迟。 */
export const RATE_TTL = RATE_TTL_MS;
