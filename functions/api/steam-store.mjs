/**
 * 账号存储适配器：同一份 router 在 Worker（Durable Object）与本地服务（内存）上都能跑。
 * 语义与 AccountHub 完全一致，本地测试得到的 uid 行为与线上一致。
 */

import { newUid, rateAllow } from './steam-auth.mjs';

/** Cloudflare：把 DO stub 包成 store 接口。所有写操作都落在单实例里，强一致。 */
export function durableStore(stub) {
  async function call(act, body) {
    const r = await stub.fetch('https://account.internal/' + act, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    if (!r.ok) throw new Error('account_hub_' + r.status);
    return await r.json();
  }
  return {
    resolve: b => call('resolve', b),
    get: uid => call('get', { uid: uid }),
    rate: b => call('rate', b),
    link: b => call('link', b)
  };
}

/** 本地开发：内存版，可选注入 load/save 做跨进程持久化。 */
export function memoryStore(options) {
  const opt = options || {};
  const persisted = (opt.load ? opt.load() : null) || {};
  const identities = new Map(Object.entries(persisted.identities || {}));
  const accounts = new Map(Object.entries(persisted.accounts || {}));
  const rates = new Map(Object.entries(persisted.rates || {}));

  function flush() {
    if (typeof opt.save !== 'function') return;
    try {
      opt.save({
        identities: Object.fromEntries(identities),
        accounts: Object.fromEntries(accounts),
        rates: Object.fromEntries(rates)
      });
    } catch (e) { /* 本地持久化失败不影响登录 */ }
  }

  return {
    async resolve(b) {
      const provider = String(b.provider || 'steam');
      const providerUid = String(b.providerUid || '');
      if (!providerUid) return { error: 'missing_provider_uid' };
      const now = Date.now();
      const ik = provider + ':' + providerUid;
      let uid = identities.get(ik);
      let acc = uid ? accounts.get(uid) : null;
      if (!acc) {
        uid = uid || newUid();
        acc = {
          uid: uid, identities: [{ provider: provider, providerUid: providerUid }],
          nick: String(b.nick || '').slice(0, 32), avatar: String(b.avatar || '').slice(0, 256),
          createdAt: now, lastLoginAt: now, loginCount: 1
        };
        identities.set(ik, uid);
      } else {
        acc.lastLoginAt = now;
        acc.loginCount = (acc.loginCount || 0) + 1;
        if (b.nick) acc.nick = String(b.nick).slice(0, 32);
        if (b.avatar) acc.avatar = String(b.avatar).slice(0, 256);
      }
      accounts.set(uid, acc);
      flush();
      return { uid: acc.uid, nick: acc.nick, avatar: acc.avatar, createdAt: acc.createdAt, loginCount: acc.loginCount };
    },
    async get(uid) {
      const acc = accounts.get(String(uid || ''));
      if (!acc) return { account: null };
      return { account: { uid: acc.uid, nick: acc.nick, avatar: acc.avatar, createdAt: acc.createdAt, loginCount: acc.loginCount } };
    },
    async link(b) {
      const uid = String(b.uid || '');
      const provider = String(b.provider || '');
      const providerUid = String(b.providerUid || '');
      if (!uid || !provider || !providerUid) return { error: 'missing_fields' };
      const acc = accounts.get(uid);
      if (!acc) return { error: 'account_not_found' };
      const ik = provider + ':' + providerUid;
      const taken = identities.get(ik);
      if (taken && taken !== uid) return { error: 'identity_bound_to_other_account' };
      acc.identities = acc.identities || [];
      if (!acc.identities.some(i => i.provider === provider && i.providerUid === providerUid)) {
        acc.identities.push({ provider: provider, providerUid: providerUid });
      }
      identities.set(ik, uid);
      accounts.set(uid, acc);
      flush();
      return { ok: true, uid: uid, identityCount: acc.identities.length };
    },
    async rate(b) {
      const key = String(b.key || '');
      const limit = Math.max(1, Math.min(10000, Number(b.limit) || 10));
      const windowMs = Math.max(1000, Math.min(3600000, Number(b.windowMs) || 60000));
      if (!key) return { ok: false, error: 'missing_key' };
      const r = rateAllow(rates.get(key), limit, windowMs);
      rates.set(key, r.hits);
      flush();
      return { ok: r.ok, remaining: Math.max(0, limit - r.hits.length), retryAfterMs: r.retryAfterMs || 0 };
    },
    _debug() { return { accounts: accounts.size, identities: identities.size, rates: rates.size }; }
  };
}
