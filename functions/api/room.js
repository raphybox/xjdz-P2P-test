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
 * 2V2 星形房间：房主固定 seat0，与 seat1..N-1 各建一条 PeerConnection，
 * 因此 create 要一次提交 seats-1 个 offer；lookup 按「第一个空座位」分配，
 * answer / ready 都按 seat 写入；poll 返回全员 members 与 answers 数组。
 *
 * 房间记录：
 *   { code, mode:'1v1'|'2v2', seats:2|4,
 *     offers:[null,sdp1,sdp2,sdp3], answers:[null,ans1,ans2,ans3],
 *     nicks:['host','','',''], ready:[false,...], joined:[true,false,...], ts }
 *
 * 路由（由 cf-worker.js 转发到全局 RoomHub 实例）：
 *   POST /api/room/create   { mode, offers:[...], nick } → { code, mode, seats }
 *   GET  /api/room/lookup?code=XXXXXXXX                 → { ..., seat, offer, host } 或 409
 *   POST /api/room/answer   { code, seat, answer, nick } → { ok } 客机提交应答
 *   GET  /api/room/poll?code=XXXXXXXX                   → { members:[...], answers:[...] }
 *   POST /api/room/ready    { code, seat, ready, nick }  → { ok }
 *   POST /api/room/close    { code }                      → 关闭房间
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

/* 模式归一化：不传 / 非法值一律按 1v1（seats=2），行为与旧版等价 */
export function normalizeMode(v) {
  return (v === '2v2' || v === 4 || v === '4') ? '2v2' : '1v1';
}

export function seatsFromMode(v) {
  return normalizeMode(v) === '2v2' ? 4 : 2;
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

/* 构造长度 seats 的 offer 数组：offers[0] 恒为 null（房主自己不需要）。
   兼容旧版单 offer 字段 { offer }：降级成 1v1 的 offers[1]，保证旧客户端不回归。 */
function buildOffers(b, seats) {
  const offers = new Array(seats).fill(null);
  if (Array.isArray(b.offers)) {
    for (let i = 1; i < seats; i++) {
      const v = b.offers[i];
      if (typeof v === 'string' && v.length >= 8 && v.length <= 200000) offers[i] = v;
    }
  } else if (typeof b.offer === 'string') {
    if (b.offer.length >= 8 && b.offer.length <= 200000) offers[1] = b.offer;
  }
  // 至少要有一个有效 offer（seat1 必须有可下发的邀请码）
  let has = false;
  for (let i = 1; i < seats; i++) if (offers[i]) { has = true; break; }
  return has ? offers : null;
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
      if (act === 'ready' && request.method === 'POST') return await this.ready(request);
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

  /* 按 seat 反解析 body：优先用显式 seat；缺省时（兼容旧客户端）回落到
     「第一个已加入但未提交应答」的座位，再不行取第一个空座位。 */
  pickSeat(b, r, needJoined) {
    if (b && Number.isInteger(Number(b.seat))) {
      const seat = Number(b.seat);
      if (seat >= 1 && seat < r.seats) return seat;
      return -1;
    }
    for (let i = 1; i < r.seats; i++) {
      if ((!needJoined || r.joined[i]) && !r.answers[i]) return i;
    }
    for (let i = 1; i < r.seats; i++) if (!r.answers[i]) return i;
    return -1;
  }

  async create(request) {
    const b = await bodyOf(request);
    if (!b) return json({ error: 'invalid_offer' }, 400);
    const mode = normalizeMode(b.mode);
    const seats = seatsFromMode(mode);
    const offers = buildOffers(b, seats);
    if (!offers) return json({ error: 'invalid_offer' }, 400);
    let code = null;
    for (let i = 0; i < 12; i++) {
      const c = genCode();
      if (!(await this.read(c))) { code = c; break; }
    }
    if (!code) return json({ error: 'code_exhausted' }, 503);
    const nicks = new Array(seats).fill('');
    const joined = new Array(seats).fill(false);
    nicks[0] = cleanNick(b.nick);
    joined[0] = true;                 // 房主占 seat0
    await this.storage.put('room:' + code, {
      code, mode, seats,
      offers,
      answers: new Array(seats).fill(null),
      nicks,
      ready: new Array(seats).fill(false),
      joined,
      ts: Date.now(),
    });
    return json({ code, mode, seats });
  }

  async lookup(url) {
    const code = normalizeCode(url.searchParams.get('code'));
    if (!isValidCode(code)) return json({ error: '房间码格式不对，请输入 8 位字母和数字' }, 400);
    const r = await this.read(code);
    if (!r) return json({ error: '房间不存在或已过期，请让房主重新创建' }, 404);
    let seat = -1;
    for (let i = 1; i < r.seats; i++) {
      if (!r.joined[i]) { seat = i; break; }
    }
    if (seat < 0) return json({ error: '这个房间已经满员了' }, 409);
    r.joined[seat] = true;           // 预占该座位，避免并发 lookup 撞座
    await this.storage.put('room:' + code, r);
    return json({
      code, mode: r.mode, seats: r.seats, seat,
      offer: r.offers[seat], host: r.nicks[0] || '',
    });
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
    const seat = this.pickSeat(b, r, true);
    if (seat < 1 || seat >= r.seats) return json({ error: '座位号无效或房间已满' }, 409);
    if (r.answers[seat]) return json({ error: '这个座位已经提交过应答了' }, 409);
    r.answers[seat] = b.answer;
    r.nicks[seat] = cleanNick(b.nick);
    r.joined[seat] = true;
    await this.storage.put('room:' + code, r);
    return json({ ok: true });
  }

  async poll(url) {
    const code = normalizeCode(url.searchParams.get('code'));
    if (!isValidCode(code)) return json({ error: '房间码格式不对' }, 400);
    const r = await this.read(code);
    if (!r) return json({ error: '房间已过期' }, 404);
    const members = [];
    for (let i = 0; i < r.seats; i++) {
      members.push({
        seat: i,
        nick: r.nicks[i] || '',
        ready: !!r.ready[i],
        joined: !!r.joined[i],
      });
    }
    // 兼容旧版房主轮询字段（joined/answer/guest/host），新客户端读 members/answers
    let firstAnswer = null, guest = '';
    for (let i = 1; i < r.seats; i++) {
      if (r.answers[i]) { firstAnswer = r.answers[i]; break; }
    }
    for (let i = 1; i < r.seats; i++) {
      if (r.nicks[i]) { guest = r.nicks[i]; break; }
    }
    return json({
      code, mode: r.mode, seats: r.seats,
      members, answers: r.answers.slice(),
      joined: !!firstAnswer, answer: firstAnswer, guest, host: r.nicks[0] || '',
    });
  }

  async ready(request) {
    const b = await bodyOf(request);
    const code = normalizeCode(b && b.code);
    if (!isValidCode(code)) return json({ error: '房间码格式不对' }, 400);
    const r = await this.read(code);
    if (!r) return json({ error: '房间不存在或已过期' }, 404);
    if (b && Number.isInteger(Number(b.seat))) {
      const seat = Number(b.seat);
      if (seat >= 0 && seat < r.seats) {
        r.ready[seat] = !!b.ready;
        if (b.nick != null) r.nicks[seat] = cleanNick(b.nick);
        await this.storage.put('room:' + code, r);
      }
    }
    return json({ ok: true });
  }

  async close(request) {
    const b = await bodyOf(request);
    await this.storage.delete('room:' + normalizeCode(b && b.code));
    return json({ ok: true });
  }
}
