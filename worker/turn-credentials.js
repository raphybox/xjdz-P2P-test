/**
 * Cloudflare TURN 凭证签发 Worker
 *
 * 作用：把 TURN Key 的长期密钥留在服务端，只向前端下发短效临时凭证。
 * 页面上的「凭证服务地址」填这个 Worker 的 URL 即可，好友打开链接自动生效，
 * 不用每个人手工去控制台换凭证。
 *
 * 需要配置的环境变量（Settings → Variables and Secrets）：
 *   TURN_KEY_ID          TURN Key 的 ID            （普通变量即可）
 *   TURN_KEY_API_TOKEN   TURN Key 的 API Token     （务必设为 Secret）
 *   TURN_TTL             凭证有效期秒数，默认 86400 （可选）
 *   ALLOWED_ORIGIN       允许的来源，逗号分隔        （可选，不填则不限制）
 *                        例如 https://xjdz.de5.net
 *
 * 部署方式（Cloudflare 控制台，不用命令行）：
 *   1. Workers & Pages → Create → Worker，命名如 turn-xjdz
 *   2. Edit code，把本文件内容整体粘进去，Deploy
 *   3. Settings → Variables and Secrets，加 TURN_KEY_ID / TURN_KEY_API_TOKEN，
 *      API Token 选 Secret 类型；再加 ALLOWED_ORIGIN = https://xjdz.de5.net
 *   4. 打开 Worker 的 URL，能看到 {"iceServers":[...]} 就算成功
 */

const UPSTREAM = 'https://rtc.live.cloudflare.com/v1/turn/keys';

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8' },
      extra || {}
    ),
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGIN || '')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean);

    // 浏览器地址栏直开没有 Origin，放行方便排查；带 Origin 的跨域请求才校验
    if (origin && allowed.length && !allowed.includes(origin.replace(/\/+$/, ''))) {
      return json({ error: 'origin_not_allowed', origin }, 403);
    }

    const cors = {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'GET') {
      return json({ error: 'method_not_allowed' }, 405, cors);
    }

    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
      return json(
        { error: 'missing_secret', detail: 'TURN_KEY_ID 或 TURN_KEY_API_TOKEN 未配置' },
        500,
        cors
      );
    }

    const ttl = Math.max(300, parseInt(env.TURN_TTL || '86400', 10) || 86400);
    // 缓存到有效期的 80%，既减少上游调用，又留出安全余量
    const cacheTtl = Math.floor(ttl * 0.8);

    const cache = caches.default;
    const cacheKey = new Request(`https://turn-credentials.internal/?ttl=${ttl}`, { method: 'GET' });

    const hit = await cache.match(cacheKey);
    if (hit) {
      return new Response(await hit.text(), {
        headers: Object.assign({}, cors, {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Turn-Cache': 'HIT',
        }),
      });
    }

    let upstream;
    try {
      upstream = await fetch(`${UPSTREAM}/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl }),
      });
    } catch (e) {
      return json({ error: 'upstream_unreachable', detail: String(e && e.message) }, 502, cors);
    }

    const text = await upstream.text();

    if (!upstream.ok) {
      return json(
        { error: 'upstream_error', status: upstream.status, detail: text.slice(0, 400) },
        502,
        cors
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return json({ error: 'upstream_bad_json', detail: text.slice(0, 400) }, 502, cors);
    }

    if (!parsed || !parsed.iceServers) {
      return json({ error: 'upstream_no_ice_servers', detail: text.slice(0, 400) }, 502, cors);
    }

    await cache.put(
      cacheKey,
      new Response(text, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': `public, max-age=${cacheTtl}`,
        },
      })
    );

    return new Response(text, {
      headers: Object.assign({}, cors, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Turn-Cache': 'MISS',
      }),
    });
  },
};
