/**
 * 账号存档路由 · Worker / 本地 server.js 单源
 *
 * GET    /api/save        读云端存档（未登录返回 401，不落盘）
 * PUT    /api/save        整包更新库存 / 昵称（rev CAS；coins 字段一律忽略）
 * POST   /api/save/ops    提交动作，服务端按 SHOP 规则重算金币并回执
 * DELETE /api/save        清空账号存档
 *
 * uid 只从签名会话里解，绝不接受请求体自带的 uid。
 * 金币永远不出现在 PUT 里 —— 客户端提交金额等于把可伪造数据同步上云。
 */

import * as SC from './save-core.mjs';

function jsonRes(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export function createSaveRouter(deps) {
  const cfg = Object.assign({
    saveCall: null,
    identity: async () => ({ logged: false, uid: null, ip: 'local' }),
    rate: async () => ({ ok: true }),
    getRules: async () => SC.DEFAULT_RULES,
    now: () => Date.now(),
    writeLimit: 30,
    writeWindowMs: 60 * 1000,
    log: () => {}
  }, deps || {});

  async function handle(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    if (path !== '/api/save' && path !== '/api/save/ops') return null;
    if (!cfg.saveCall) return jsonRes({ error: 'save_service_unavailable' }, 503);

    const id = await cfg.identity(request);
    if (!id.logged || !id.uid) return jsonRes({ error: 'not_logged_in' }, 401);
    const uid = id.uid;
    const rules = await cfg.getRules();

    /* ---- 读：云端为空时给一份初始存档视图，但不落盘 ---- */
    if (path === '/api/save' && request.method === 'GET') {
      const r = await cfg.saveCall('saveget', { uid: uid });
      if (r && r.error) return jsonRes({ error: r.error }, 500);
      const save = (r && r.save) ? r.save : SC.blankSave(cfg.now(), rules);
      return jsonRes({ ok: true, logged: true, save: SC.publicSave(save) });
    }

    /* ---- 删除 ---- */
    if (path === '/api/save' && request.method === 'DELETE') {
      const ok = await cfg.rate('save:' + uid + ':write', cfg.writeLimit, cfg.writeWindowMs);
      if (!ok.ok) return jsonRes({ error: 'rate_limited' }, 429);
      const r = await cfg.saveCall('savedelete', { uid: uid });
      return jsonRes({ ok: true, deleted: !!(r && r.ok) });
    }

    let body = null;
    if (request.method === 'PUT' || request.method === 'POST') {
      try { body = await request.json(); } catch (e) { return jsonRes({ error: 'bad_json' }, 400); }
    }
    if (!body || typeof body !== 'object') return jsonRes({ error: 'bad_body' }, 400);

    const ok = await cfg.rate('save:' + uid + ':write', cfg.writeLimit, cfg.writeWindowMs);
    if (!ok.ok) return jsonRes({ error: 'rate_limited' }, 429);

    /* ---- 整包更新（含首次登录的 seed 合并） ---- */
    if (path === '/api/save' && request.method === 'PUT') {
      const payload = {
        uid: uid,
        rules: rules,
        baseRev: Number(body.baseRev),
        patch: {
          inventory: body.inventory,
          profile: body.profile
        }
      };
      if (body.seed !== undefined) payload.seed = body.seed;
      const r = await cfg.saveCall('saveput', payload);
      if (r && r.error === 'rev_conflict') return jsonRes({ error: 'rev_conflict', save: r.save }, 409);
      if (r && r.error) return jsonRes({ error: r.error }, r.error === 'save_too_large' ? 413 : 400);
      cfg.log('save_put', uid);
      return jsonRes({ ok: true, save: r.save });
    }

    /* ---- 金币动作事务 ---- */
    if (path === '/api/save/ops' && request.method === 'POST') {
      const ops = Array.isArray(body.ops) ? body.ops.slice(0, SC.OPS_QUEUE_LIMIT) : [];
      if (!ops.length) return jsonRes({ error: 'no_ops' }, 400);
      const r = await cfg.saveCall('saveops', { uid: uid, ops: ops, rules: rules });
      if (r && r.error) return jsonRes({ error: r.error, results: r.results }, 413);
      cfg.log('save_ops', uid + ':' + ops.length);
      return jsonRes({ ok: true, coins: r.coins, rev: r.rev, results: r.results, save: r.save });
    }

    return jsonRes({ error: 'method_not_allowed' }, 405);
  }

  return { handle: handle };
}
