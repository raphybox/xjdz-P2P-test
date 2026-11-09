var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// functions/api/turn.js
var UPSTREAM = "https://rtc.live.cloudflare.com/v1/turn/keys";
function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign(
      { "Content-Type": "application/json; charset=utf-8" },
      extra || {}
    )
  });
}
__name(json, "json");
function buildCors(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  const denied = !!(origin && allowed.length && !allowed.includes(origin.replace(/\/+$/, "")));
  return {
    denied,
    origin,
    headers: {
      "Access-Control-Allow-Origin": denied ? "null" : origin || "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin"
    }
  };
}
__name(buildCors, "buildCors");
async function onRequestGet(context) {
  const request = context.request;
  const env = context.env;
  const { denied, origin, headers: cors } = buildCors(request, env);
  if (denied) {
    return json({ error: "origin_not_allowed", origin }, 403, cors);
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "method_not_allowed" }, 405, cors);
  }
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
    return json(
      { error: "missing_secret", detail: "TURN_KEY_ID \u6216 TURN_KEY_API_TOKEN \u672A\u914D\u7F6E" },
      500,
      cors
    );
  }
  const ttl = Math.max(300, parseInt(env.TURN_TTL || "86400", 10) || 86400);
  const cacheTtl = Math.floor(ttl * 0.8);
  const cache = caches.default;
  const cacheKey = new Request(`https://turn-credentials.internal/?ttl=${ttl}`, { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) {
    return new Response(await hit.text(), {
      headers: Object.assign({}, cors, {
        "Content-Type": "application/json; charset=utf-8",
        "X-Turn-Cache": "HIT"
      })
    });
  }
  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM}/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ttl })
    });
  } catch (e) {
    return json({ error: "upstream_unreachable", detail: String(e && e.message) }, 502, cors);
  }
  const text = await upstream.text();
  if (!upstream.ok) {
    return json(
      { error: "upstream_error", status: upstream.status, detail: text.slice(0, 400) },
      502,
      cors
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return json({ error: "upstream_bad_json", detail: text.slice(0, 400) }, 502, cors);
  }
  if (!parsed || !parsed.iceServers) {
    return json({ error: "upstream_no_ice_servers", detail: text.slice(0, 400) }, 502, cors);
  }
  await cache.put(
    cacheKey,
    new Response(text, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${cacheTtl}`
      }
    })
  );
  return new Response(text, {
    headers: Object.assign({}, cors, {
      "Content-Type": "application/json; charset=utf-8",
      "X-Turn-Cache": "MISS"
    })
  });
}
__name(onRequestGet, "onRequestGet");
function onRequestOptions(context) {
  const { denied, headers: cors } = buildCors(context.request, context.env);
  return new Response(null, { status: denied ? 403 : 204, headers: cors });
}
__name(onRequestOptions, "onRequestOptions");

// functions/api/room.js
var ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var CODE_LEN = 8;
var ROOM_TTL = 10 * 60 * 1e3;
function normalizeCode(v) {
  return String(v == null ? "" : v).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LEN);
}
__name(normalizeCode, "normalizeCode");
function isValidCode(v) {
  return /^[A-HJ-NP-Z2-9]{8}$/.test(String(v || ""));
}
__name(isValidCode, "isValidCode");
function genCode() {
  const bytes = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(bytes);
  let s = "";
  for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}
__name(genCode, "genCode");
function cleanNick(v) {
  return String(v == null ? "" : v).replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 12);
}
__name(cleanNick, "cleanNick");
function corsHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
__name(corsHeaders, "corsHeaders");
function json2(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: corsHeaders() });
}
__name(json2, "json");
function noContent() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
__name(noContent, "noContent");
async function bodyOf(request) {
  try {
    return await request.json();
  } catch (e) {
    return null;
  }
}
__name(bodyOf, "bodyOf");
var RoomHub = class {
  static {
    __name(this, "RoomHub");
  }
  constructor(state) {
    this.state = state;
    this.storage = state.storage;
  }
  async fetch(request) {
    const url = new URL(request.url);
    const act = (url.pathname.split("/").filter(Boolean).pop() || "").toLowerCase();
    if (request.method === "OPTIONS") return noContent();
    try {
      if (act === "create" && request.method === "POST") return await this.create(request);
      if (act === "lookup" && request.method === "GET") return await this.lookup(url);
      if (act === "answer" && request.method === "POST") return await this.answer(request);
      if (act === "poll" && request.method === "GET") return await this.poll(url);
      if (act === "close" && request.method === "POST") return await this.close(request);
      return json2({ error: "unknown_action" }, 404);
    } catch (e) {
      return json2({ error: "server_error", detail: String(e && e.message || e) }, 500);
    }
  }
  async read(code) {
    const key = "room:" + code;
    const r = await this.storage.get(key);
    if (!r) return null;
    if (Date.now() - (r.ts || 0) > ROOM_TTL) {
      await this.storage.delete(key);
      return null;
    }
    return r;
  }
  async create(request) {
    const b = await bodyOf(request);
    if (!b || typeof b.offer !== "string" || b.offer.length < 8 || b.offer.length > 2e5) {
      return json2({ error: "invalid_offer" }, 400);
    }
    let code = null;
    for (let i = 0; i < 12; i++) {
      const c = genCode();
      if (!await this.read(c)) {
        code = c;
        break;
      }
    }
    if (!code) return json2({ error: "code_exhausted" }, 503);
    await this.storage.put("room:" + code, {
      offer: b.offer,
      answer: null,
      host: cleanNick(b.nick),
      guest: "",
      ts: Date.now()
    });
    return json2({ code });
  }
  async lookup(url) {
    const code = normalizeCode(url.searchParams.get("code"));
    if (!isValidCode(code)) return json2({ error: "\u623F\u95F4\u7801\u683C\u5F0F\u4E0D\u5BF9\uFF0C\u8BF7\u8F93\u5165 8 \u4F4D\u5B57\u6BCD\u548C\u6570\u5B57" }, 400);
    const r = await this.read(code);
    if (!r) return json2({ error: "\u623F\u95F4\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u8BA9\u623F\u4E3B\u91CD\u65B0\u521B\u5EFA" }, 404);
    if (r.answer) return json2({ error: "\u8FD9\u4E2A\u623F\u95F4\u5DF2\u7ECF\u6709\u73A9\u5BB6\u52A0\u5165\u4E86" }, 409);
    return json2({ code, offer: r.offer, host: r.host });
  }
  async answer(request) {
    const b = await bodyOf(request);
    const code = normalizeCode(b && b.code);
    if (!isValidCode(code)) return json2({ error: "\u623F\u95F4\u7801\u683C\u5F0F\u4E0D\u5BF9" }, 400);
    if (!b || typeof b.answer !== "string" || b.answer.length < 8 || b.answer.length > 2e5) {
      return json2({ error: "invalid_answer" }, 400);
    }
    const r = await this.read(code);
    if (!r) return json2({ error: "\u623F\u95F4\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F" }, 404);
    if (r.answer) return json2({ error: "\u5DF2\u7ECF\u6709\u5176\u4ED6\u73A9\u5BB6\u52A0\u5165\u4E86\u8FD9\u4E2A\u623F\u95F4" }, 409);
    r.answer = b.answer;
    r.guest = cleanNick(b.nick);
    r.joinedAt = Date.now();
    await this.storage.put("room:" + code, r);
    return json2({ ok: true });
  }
  async poll(url) {
    const code = normalizeCode(url.searchParams.get("code"));
    if (!isValidCode(code)) return json2({ error: "\u623F\u95F4\u7801\u683C\u5F0F\u4E0D\u5BF9" }, 400);
    const r = await this.read(code);
    if (!r) return json2({ error: "\u623F\u95F4\u5DF2\u8FC7\u671F" }, 404);
    return json2({
      code,
      joined: !!r.answer,
      answer: r.answer || null,
      guest: r.guest || "",
      host: r.host || ""
    });
  }
  async close(request) {
    const b = await bodyOf(request);
    await this.storage.delete("room:" + normalizeCode(b && b.code));
    return json2({ ok: true });
  }
};

// cf-worker.js
async function purgeAssets(request) {
  const url = new URL(request.url);
  const targets = url.searchParams.getAll("u").slice(0, 20);
  if (!targets.length) {
    return new Response(JSON.stringify({ error: "\u7528\u6CD5\uFF1A/api/purge?u=/net.js&u=/game.js" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
  const purged = [], skipped = [];
  for (const t of targets) {
    if (!/^\/[A-Za-z0-9._\-/]*$/.test(t)) {
      skipped.push(t);
      continue;
    }
    try {
      const ok = await caches.default.delete(url.origin + t);
      (ok ? purged : skipped).push(t);
    } catch (e) {
      skipped.push(t);
    }
  }
  return new Response(JSON.stringify({ purged, skipped }), {
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
__name(purgeAssets, "purgeAssets");
var cf_worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/api/turn" || path === "/api/turn/") {
      if (request.method === "OPTIONS") {
        return onRequestOptions({ request, env });
      }
      return onRequestGet({ request, env });
    }
    if (path === "/api/room" || path.indexOf("/api/room/") === 0) {
      if (!env.ROOMS) return new Response(JSON.stringify({ error: "room_service_unavailable" }), { status: 503 });
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
          }
        });
      }
      const id = env.ROOMS.idFromName("global");
      return env.ROOMS.get(id).fetch(request);
    }
    if (path === "/api/purge" || path.indexOf("/api/purge-") === 0) {
      return purgeAssets(request);
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not Found", { status: 404 });
  }
};
export {
  RoomHub,
  cf_worker_default as default
};
//# sourceMappingURL=cf-worker.js.map
