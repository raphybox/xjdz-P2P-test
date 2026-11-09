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

    // 其余请求交给静态资产层（正常情况下轮不到这里：资产命中不会进 Worker）
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Not Found', { status: 404 });
  },
};
