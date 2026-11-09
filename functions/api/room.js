/**
 * 联机房间信令服务（Cloudflare Durable Object）
 *
 * 为什么需要服务端：8 位短邀请码无法容纳 SDP，客机又不再回传应答码，
 * 因此 offer/answer 必须由服务端中转一次。这里只交换建连信令（几 KB，
 * 10 分钟自动过期），对战数据仍然完全走两端 WebRTC 直连。
 *
 * 用 Durable Object 而非 KV：单实例强一致，避免 KV 跨 PoP 最终一致性
 * 导致「客机写入 answer，房主几十秒后才轮询到」。
 *
 * 路由（由 cf-worker.js 转发到全局 RoomHub 实例）：
 *   POST /api/room/create   { offer, nick }        → { code } 生成 8 位码
 *   GET  /api/room/lookup?code=XXXXXXXX            → { offer, host } 或 404
 *   POST /api/room/answer   { code, answer, nick } → { ok } 客机提交应答
 *   GET  /api/room/poll?code=XXXXXXXX              → { joined, answer, guest } 房主轮询
 *   POST /api/room/close    { code }               → 关闭房间
 */

/* 去掉 I / O / 0 / 1，避免肉眼混淆；32^8 ≈ 1.1 万亿种组合 */
export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 8;
export const ROOM_TTL = 10 * 60 * 1000;

export function normalizeCode(v) {
  return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
}

export function isValidCode(v) {
  return /^[A-HJ-NP-Z2-9]{8}$/.test(String(v || ''));
}

export function genCode() {
  const bytes = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

export function cleanNick(v) {
  return String(v == null ? '' : v).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 12);
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: corsHeaders() });
}

/* 204 不能带 body，单独处理预检 */
function noContent() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function bodyOf(request) {
  try { return await request.json(); } catch (e) { return null; }
}

export class RoomHub {
  constructor(state) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const act = (url.pathname.split('/').filter(Boolean).pop() || '').toLowerCase();
    if (request.method === 'OPTIONS') return noContent();
    try {
      if (act === 'create' && request.method === 'POST') return await this.create(request);
      if (act === 'lookup' && request.method === 'GET') return await this.lookup(url);
      if (act === 'answer' && request.method === 'POST') return await this.answer(request);
      if (act === 'poll' && request.method === 'GET') return await this.poll(url);
      if (act === 'close' && request.method === 'POST') return await this.close(request);
      return json({ error: 'unknown_action' }, 404);
    } catch (e) {
      return json({ error: 'server_error', detail: String((e && e.message) || e) }, 500);
    }
  }

  async read(code) {
    const key = 'room:' + code;
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
    if (!b || typeof b.offer !== 'string' || b.offer.length < 8 || b.offer.length > 200000) {
      return json({ error: 'invalid_offer' }, 400);
    }
    let code = null;
    for (let i = 0; i < 12; i++) {
      const c = genCode();
      if (!(await this.read(c))) { code = c; break; }
    }
    if (!code) return json({ error: 'code_exhausted' }, 503);
    await this.storage.put('room:' + code, {
      offer: b.offer,
      answer: null,
      host: cleanNick(b.nick),
      guest: '',
      ts: Date.now(),
    });
    return json({ code });
  }

  async lookup(url) {
    const code = normalizeCode(url.searchParams.get('code'));
    if (!isValidCode(code)) return json({ error: '房间码格式不对，请输入 8 位字母和数字' }, 400);
    const r = await this.read(code);
    if (!r) return json({ error: '房间不存在或已过期，请让房主重新创建' }, 404);
    if (r.answer) return json({ error: '这个房间已经有玩家加入了' }, 409);
    return json({ code, offer: r.offer, host: r.host });
  }

  async answer(request) {
    const b = await bodyOf(request);
    const code = normalizeCode(b && b.code);
    if (!isValidCode(code)) return json({ error: '房间码格式不对' }, 400);
    if (!b || typeof b.answer !== 'string' || b.answer.length < 8 || b.answer.length > 200000) {
      return json({ error: 'invalid_answer' }, 400);
    }
    const r = await this.read(code);
    if (!r) return json({ error: '房间不存在或已过期' }, 404);
    if (r.answer) return json({ error: '已经有其他玩家加入了这个房间' }, 409);
    r.answer = b.answer;
    r.guest = cleanNick(b.nick);
    r.joinedAt = Date.now();
    await this.storage.put('room:' + code, r);
    return json({ ok: true });
  }

  async poll(url) {
    const code = normalizeCode(url.searchParams.get('code'));
    if (!isValidCode(code)) return json({ error: '房间码格式不对' }, 400);
    const r = await this.read(code);
    if (!r) return json({ error: '房间已过期' }, 404);
    return json({
      code,
      joined: !!r.answer,
      answer: r.answer || null,
      guest: r.guest || '',
      host: r.host || '',
    });
  }

  async close(request) {
    const b = await bodyOf(request);
    await this.storage.delete('room:' + normalizeCode(b && b.code));
    return json({ ok: true });
  }
}
