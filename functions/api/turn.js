/**
 * Cloudflare Pages Function：TURN 凭证签发
 * 部署后在 https://xjdz.de5.net/api/turn 提供服务，
 * 页面的 DEFAULT_TURN_SVC 常量指向这里，所有访客自动拿到临时中继凭证。
 *
 * 环境变量在 Pages 项目 → 设置 → 环境变量（生产环境）里配置：
 *   TURN_KEY_ID          TURN 密钥的 ID            （普通变量）
 *   TURN_KEY_API_TOKEN   TURN 密钥的 API 令牌       （务必加密 / Secret）
 *   TURN_TTL             凭证有效期秒数，默认 86400 （可选）
 *   ALLOWED_ORIGIN       允许的来源，逗号分隔        （可选，填 https://xjdz.de5.net）
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

/* 统一计算 CORS 头；来源被拒时返回 denied=true */
function buildCors(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  // 同源 fetch 的 Origin 就是本站，必过；地址栏直开没有 Origin，放行便于排查
  const denied = !!(origin && allowed.length && !allowed.includes(origin.replace(/\/+$/, '')));

  return {
    denied,
    origin,
    headers: {
      'Access-Control-Allow-Origin': denied ? 'null' : (origin || '*'),
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    },
  };
}

export async function onRequestGet(context) {
  const request = context.request;
  const env = context.env;

  const { denied, origin, headers: cors } = buildCors(request, env);
  if (denied) {
    return json({ error: 'origin_not_allowed', origin }, 403, cors);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
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
}

/* CORS 预检：独立返回，不触发签发逻辑 */
export function onRequestOptions(context) {
  const { denied, headers: cors } = buildCors(context.request, context.env);
  return new Response(null, { status: denied ? 403 : 204, headers: cors });
}
