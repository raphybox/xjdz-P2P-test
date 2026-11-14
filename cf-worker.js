/**
 * Cloudflare Worker 入口：静态资产 + TURN 凭证签发
 *
 * 站点 xjdz.de5.net 是「Workers 静态资产」部署（不是 Pages），由 wrangler deploy
 * 一起发布：匹配到静态文件的请求直接由资产层返回（不进本脚本），
 * 只有 /api/turn 这类没有对应资产的路径才会进 fetch()。
 *
 * 凭证签发逻辑单源在 functions/api/turn.js（wrangler 打包时会内联），
 * 该文件同时被 tools/test_turn_function.js 的 48 项回归测试覆盖。
 */

import { onRequestGet, onRequestOptions } from './functions/api/turn.js';
import { createAuthRouter } from './functions/api/steam-auth-router.mjs';
import { durableStore } from './functions/api/steam-store.mjs';

/* DO 类必须从主模块具名导出，wrangler 才能注册 Durable Object binding */
export { RoomHub } from './functions/api/room.js';
export { AccountHub } from './functions/api/account-hub.mjs';

/* Steam OpenID 登录：账号 / 限流全落在 AccountHub 单实例里。
   SESSION_SECRET 是 wrangler secret（不进 vars、不进仓库）；
   STEAM_API_KEY 只用于可选地拉昵称头像，没配也能完成登录。 */
function authFor(env) {
  const stub = env.AUTH ? env.AUTH.get(env.AUTH.idFromName('global')) : null;
  return createAuthRouter({
    secret: String(env.SESSION_SECRET || ''),
    apiKey: String(env.STEAM_API_KEY || ''),
    store: stub ? durableStore(stub) : null,
    devMock: false,                       // 线上永远不开放 mock 登录
    log: (k, v) => console.log('[steam-auth] ' + k + (v ? ' ' + v : ''))
  });
}

/* 区域边缘缓存自助清理：
   静态资产响应被区域级缓存规则（如 Cache Everything）钉住时，wrangler 部署
   虽然成功但用户拿到的仍是旧文件。Cache API 只在 Worker 内可用，因此提供
   /api/purge 白名单清理。仅允许站内静态路径（防滥用），单次最多 20 条。 */
async function purgeAssets(request) {
  const url = new URL(request.url);
  const targets = url.searchParams.getAll('u').slice(0, 20);
  if (!targets.length) {
    return new Response(JSON.stringify({ error: '用法：/api/purge?u=/net.js&u=/game.js' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  const purged = [], skipped = [];
  for (const t of targets) {
    // 白名单：仅站内绝对路径，字母数字与 ./-/_ 组成
    if (!/^\/[A-Za-z0-9._\-/]*$/.test(t)) { skipped.push(t); continue; }
    try {
      const ok = await caches.default.delete(url.origin + t);
      (ok ? purged : skipped).push(t);
    } catch (e) { skipped.push(t); }
  }
  return new Response(JSON.stringify({ purged, skipped }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    /* Steam OpenID 2.0：login / callback / me / logout 全部由单源路由器处理 */
    if (path.indexOf('/api/auth/steam/') === 0) {
      return authFor(env).handle(request);
    }

    if (path === '/api/turn' || path === '/api/turn/') {
      if (request.method === 'OPTIONS') {
        return onRequestOptions({ request, env });
      }
      return onRequestGet({ request, env });
    }

    if (path === '/api/room' || path.indexOf('/api/room/') === 0) {
      if (!env.ROOMS) return new Response(JSON.stringify({ error: 'room_service_unavailable' }), { status: 503 });
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      }
      /* 风控：建房额度与加入频次在服务端按内部 uid 限流（未登录按 IP）。
         poll / list 是联机心跳，频率高且无副作用，故意不限流，避免误伤对局。 */
      const roomAct = (path.split('/').filter(Boolean).pop() || '').toLowerCase();
      const guardAct = roomAct === 'create' ? 'roomCreate' : (roomAct === 'lookup' ? 'roomLookup' : '');
      if (guardAct && env.AUTH) {
        const g = await authFor(env).guard(request, guardAct);
        if (!g.ok) {
          return new Response(JSON.stringify({ error: 'rate_limited', scope: guardAct, retryAfterMs: g.retryAfterMs }), {
            status: 429,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Retry-After': String(Math.ceil((g.retryAfterMs || 1000) / 1000)),
              'Cache-Control': 'no-store'
            }
          });
        }
      }
      // 全局单实例：所有房间信令强一致，避免 KV 跨 PoP 的读取延迟
      const id = env.ROOMS.idFromName('global');
      return env.ROOMS.get(id).fetch(request);
    }

    if (path === '/api/purge' || path.indexOf('/api/purge-') === 0) {
      return purgeAssets(request);
    }

    // 其余请求交给静态资产层（正常情况下轮不到这里：资产命中不会进 Worker）
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Not Found', { status: 404 });
  },
};
