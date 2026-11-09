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

    if (path === '/api/turn' || path === '/api/turn/') {
      if (request.method === 'OPTIONS') {
        return onRequestOptions({ request, env });
      }
      return onRequestGet({ request, env });
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
