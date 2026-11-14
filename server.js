/* =============================================================
   选技弹珠 · 本地开发服务（零依赖）
   启动：node server.js        打开：http://127.0.0.1:8787/admin.html
   作用：托管游戏与后台，并把后台配置真正落盘到 data/game-config.json
   不启动本服务也可以：后台配置会写入 localStorage，游戏刷新即生效
   ============================================================= */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'game-config.json');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const PORT = Number(process.env.PORT || 8787);
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.map': 'application/json; charset=utf-8'
};

/* 历史遗留清理：特效模块曾自带「持续伤害」字段（tickDamage/tickDps/tickRadius/tickInterval），
   现已统一归到「伤害·结算」模块。若后台仍持有迁移前的旧内存数据，保存时会把死字段写回，
   这里在落盘前统一剥掉，保证「持续伤害只存在于伤害模块」的口径不被旧草稿污染。 */
const FX_LEGACY_TICK_KEYS = ['tickDamage', 'tickDps', 'tickRadius', 'tickInterval'];
function stripLegacyFxTick(data) {
  if (!data || !Array.isArray(data.skills)) return data;
  data.skills.forEach(sk => {
    const nodes = (sk && sk.graph && Array.isArray(sk.graph.nodes)) ? sk.graph.nodes : [];
    nodes.forEach(n => {
      if (n && n.type === 'fx' && n.params) {
        FX_LEGACY_TICK_KEYS.forEach(k => { if (n.params[k] != null) delete n.params[k]; });
      }
    });
  });
  return data;
}

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(body);
}
function json(res, code, obj) { send(res, code, JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 20 * 1024 * 1024) reject(new Error('配置过大')); });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}
function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
}
function stamp() {
  const d = new Date();
  const p = n => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function safePath(urlPath) {
  const rel = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  const target = path.resolve(ROOT, rel || 'index.html');
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;
  return target;
}

/* 在系统默认浏览器里打开 URL（开发启动台「打开入口页」用）。
   浏览器本身不能直接起进程，所以由本地服务代开。 */
function openBrowser(targetUrl) {
  const u = String(targetUrl);
  try {
    if (process.platform === 'win32') {
      try {
        spawn('cmd', ['/c', 'start', '', u], { stdio: 'ignore', detached: false, windowsHide: true });
      } catch (e) {
        try { spawn('explorer', [u], { stdio: 'ignore', windowsHide: true }); } catch (e2) { /* 忽略 */ }
      }
    } else if (process.platform === 'darwin') {
      spawn('open', [u], { stdio: 'ignore', windowsHide: true });
    } else {
      spawn('xdg-open', [u], { stdio: 'ignore', windowsHide: true });
    }
  } catch (e) { /* 开浏览器失败不应中断服务 */ }
}

/* -------------------------------------------------------------
   本地开发服务：先在这里测试，确认无误后再由后台「同步上线」发布。
   - 管理后台(admin.*)已在 .gitignore 排除，不会进入仓库。
   - 代理做 HTTPS 中间人，git 必须 http.sslVerify=false（内置）。
   - 非交互、带超时，避免弹窗卡死；失败不影响本地落盘结果。
   ------------------------------------------------------------- */
/* -------------------------------------------------------------
   本地开发版房间信令 / TURN 代理
   与 functions/api/room.js 的 Durable Object 协议完全一致，数据只在内存里，
   重启服务即清空。目的是让「先本地测试」对 P2P 房间功能也成立：
   本地 127.0.0.1 是安全上下文，两个浏览器窗口可直接建连对打。
   ------------------------------------------------------------- */
const ROOM_TTL = 10 * 60 * 1000;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOCAL_ROOMS = new Map();
function localCode() {
  const b = require('crypto').randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += ROOM_ALPHABET[b[i] % ROOM_ALPHABET.length];
  return s;
}
function normCode(v) { return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }
function validCode(v) { return /^[A-HJ-NP-Z2-9]{8}$/.test(String(v || '')); }
function cleanRoomNick(v) { return String(v == null ? '' : v).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 12); }
function localMode(v) { return (v === '2v2' || v === 4 || v === '4') ? '2v2' : '1v1'; }
function localSeats(v) { return localMode(v) === '2v2' ? 4 : 2; }
function readRoom(code) {
  const r = LOCAL_ROOMS.get(code);
  if (!r) return null;
  if (Date.now() - r.ts > ROOM_TTL) { LOCAL_ROOMS.delete(code); return null; }
  return r;
}
/* 与 functions/api/room.js 的 buildOffers 完全一致：offers[0] 恒 null，
   兼容旧版单 offer 字段（降级为 1v1 的 offers[1]）。 */
function localBuildOffers(b, seats) {
  const offers = new Array(seats).fill(null);
  if (Array.isArray(b.offers)) {
    for (let i = 1; i < seats; i++) {
      const v = b.offers[i];
      if (typeof v === 'string' && v.length >= 8 && v.length <= 200000) offers[i] = v;
    }
  } else if (typeof b.offer === 'string') {
    if (b.offer.length >= 8 && b.offer.length <= 200000) offers[1] = b.offer;
  }
  let has = false;
  for (let i = 1; i < seats; i++) if (offers[i]) { has = true; break; }
  return has ? offers : null;
}
/* 与 room.js 的 pickSeat 一致：优先显式 seat，缺省回落到空座位 */
function localPickSeat(b, r, needJoined) {
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
async function handleLocalRoom(req, res, url) {
  const u = new URL(url, 'http://' + HOST + ':' + PORT);
  const act = (u.pathname.split('/').filter(Boolean).pop() || '').toLowerCase();
  if (req.method === 'OPTIONS') return send(res, 204, '');
  let body = null;
  if (req.method === 'POST') {
    try { body = JSON.parse(await readBody(req) || 'null'); }
    catch (e) { return json(res, 400, { ok: false, error: 'JSON 解析失败' }); }
  }
  if (act === 'create' && req.method === 'POST') {
    if (!body) return json(res, 400, { error: 'invalid_offer' });
    const mode = localMode(body.mode);
    const seats = localSeats(mode);
    // 房主可能还没收集 ICE，允许 offers 为空；之后逐个补传
    let offers = localBuildOffers(body, seats);
    if (!offers) offers = new Array(seats).fill(null);
    let code = null;
    if (validCode(body.preferredCode) && !readRoom(body.preferredCode)) code = body.preferredCode;
    if (!code) {
      for (let i = 0; i < 12; i++) { const c = localCode(); if (!readRoom(c)) { code = c; break; } }
    }
    if (!code) return json(res, 503, { error: 'code_exhausted' });
    const nicks = new Array(seats).fill('');
    const joined = new Array(seats).fill(false);
    nicks[0] = cleanRoomNick(body.nick);
    joined[0] = true;                 // 房主占 seat0
    LOCAL_ROOMS.set(code, {
      code, mode, seats,
      offers,
      answers: new Array(seats).fill(null),
      nicks,
      ready: new Array(seats).fill(false),
      joined,
      public: !!body.public,
      ts: Date.now(),
    });
    return json(res, 200, { code, mode, seats });
  }
  if (act === 'list' && req.method === 'GET') {
    const now = Date.now();
    const out = [];
    for (const [k, r] of LOCAL_ROOMS) {
      if (!r || now - (r.ts || 0) > ROOM_TTL) continue;
      if (!r.public) continue;
      let joined = 0, ready = 0;
      for (let i = 0; i < (r.seats || 0); i++) {
        if (r.joined && r.joined[i]) joined++;
        if (r.ready && r.ready[i]) ready++;
      }
      if (joined >= (r.seats || 0)) continue;
      out.push({ code: r.code, mode: r.mode, seats: r.seats, host: (r.nicks && r.nicks[0]) || '', joined, ready, ts: r.ts });
    }
    out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return json(res, 200, { rooms: out });
  }
  if (act === 'offer' && req.method === 'POST') {
    const code = normCode(body && body.code);
    if (!validCode(code)) return json(res, 400, { error: '房间码格式不对' });
    const r = readRoom(code);
    if (!r) return json(res, 404, { error: '房间不存在或已过期' });
    const seat = Number(body && body.seat);
    if (!Number.isInteger(seat) || seat < 1 || seat >= r.seats) return json(res, 400, { error: '座位号无效' });
    if (typeof body.offer !== 'string' || body.offer.length < 8 || body.offer.length > 200000) {
      return json(res, 400, { error: 'invalid_offer' });
    }
    r.offers[seat] = body.offer;
    LOCAL_ROOMS.set(code, r);
    return json(res, 200, { ok: true });
  }
  if (act === 'lookup' && req.method === 'GET') {
    const code = normCode(u.searchParams.get('code'));
    if (!validCode(code)) return json(res, 400, { error: '房间码格式不对，请输入 8 位字母和数字' });
    const r = readRoom(code);
    if (!r) return json(res, 404, { error: '房间不存在或已过期，请让房主重新创建' });
    let seat = -1;
    for (let i = 1; i < r.seats; i++) if (!r.joined[i]) { seat = i; break; }
    if (seat < 0) return json(res, 409, { error: '这个房间已经满员了' });
    r.joined[seat] = true;           // 预占，避免并发 lookup 撞座
    const offer = r.offers[seat];
    LOCAL_ROOMS.set(code, r);
    if (!offer) return json(res, 200, { code, mode: r.mode, seats: r.seats, seat, offer: null, host: r.nicks[0] || '', waiting: true });
    return json(res, 200, { code, mode: r.mode, seats: r.seats, seat, offer, host: r.nicks[0] || '' });
  }
  if (act === 'answer' && req.method === 'POST') {
    const code = normCode(body && body.code);
    if (!validCode(code)) return json(res, 400, { error: '房间码格式不对' });
    if (!body || typeof body.answer !== 'string' || body.answer.length < 8 || body.answer.length > 200000) {
      return json(res, 400, { error: 'invalid_answer' });
    }
    const r = readRoom(code);
    if (!r) return json(res, 404, { error: '房间不存在或已过期' });
    const seat = localPickSeat(body, r, true);
    if (seat < 1 || seat >= r.seats) return json(res, 409, { error: '座位号无效或房间已满' });
    if (r.answers[seat]) return json(res, 409, { error: '这个座位已经提交过应答了' });
    r.answers[seat] = body.answer;
    r.nicks[seat] = cleanRoomNick(body.nick);
    r.joined[seat] = true;
    LOCAL_ROOMS.set(code, r);
    return json(res, 200, { ok: true });
  }
  if (act === 'poll' && req.method === 'GET') {
    const code = normCode(u.searchParams.get('code'));
    if (!validCode(code)) return json(res, 400, { error: '房间码格式不对' });
    const r = readRoom(code);
    if (!r) return json(res, 404, { error: '房间已过期' });
    const members = [];
    for (let i = 0; i < r.seats; i++) {
      members.push({ seat: i, nick: r.nicks[i] || '', ready: !!r.ready[i], joined: !!r.joined[i] });
    }
    // 兼容旧版房主轮询字段（joined/answer/guest/host），新客户端读 members/answers
    let firstAnswer = null, guest = '';
    for (let i = 1; i < r.seats; i++) if (r.answers[i]) { firstAnswer = r.answers[i]; break; }
    for (let i = 1; i < r.seats; i++) if (r.nicks[i]) { guest = r.nicks[i]; break; }
    return json(res, 200, {
      code, mode: r.mode, seats: r.seats,
      members, answers: r.answers.slice(), offers: r.offers.slice(),
      joined: !!firstAnswer, answer: firstAnswer, guest, host: r.nicks[0] || '',
    });
  }
  if (act === 'ready' && req.method === 'POST') {
    const code = normCode(body && body.code);
    if (!validCode(code)) return json(res, 400, { error: '房间码格式不对' });
    const r = readRoom(code);
    if (!r) return json(res, 404, { error: '房间不存在或已过期' });
    if (body && Number.isInteger(Number(body.seat))) {
      const seat = Number(body.seat);
      if (seat >= 0 && seat < r.seats) {
        r.ready[seat] = !!body.ready;
        if (body.nick != null) r.nicks[seat] = cleanRoomNick(body.nick);
        LOCAL_ROOMS.set(code, r);
      }
    }
    return json(res, 200, { ok: true });
  }
  if (act === 'close' && req.method === 'POST') {
    LOCAL_ROOMS.delete(normCode(body && body.code));
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'unknown_action' });
}

/* 本地页面拿不到 xjdz.de5.net 的 TURN 凭证（CORS 白名单只放线上域），
   由本地服务服务端转发一次，保证本地联机也能走中继。 */
async function handleLocalTurn(res) {
  try {
    const r = await fetch('https://xjdz.de5.net/api/turn');
    const text = await r.text();
    return send(res, r.status, text, 'application/json; charset=utf-8');
  } catch (e) {
    return json(res, 502, { error: 'turn_proxy_failed', detail: String((e && e.message) || e) });
  }
}

function isGitRepo() {
  try { return fs.existsSync(path.join(ROOT, '.git')); } catch (e) { return false; }
}
function runCmd(file, args, timeoutMs) {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, {
      GCM_INTERACTIVE: 'never',   // 无缓存凭据时直接失败，不弹窗
      GIT_TERMINAL_PROMPT: '0',
      WRANGLER_SEND_METRICS: 'false'
    });
    let settled = false;
    const p = execFile(file, args, { cwd: ROOT, timeout: timeoutMs || 120000, windowsHide: true, env },
      (err, stdout, stderr) => {
        if (settled) return; settled = true;
        resolve({
          ok: !err,
          code: err && err.code,
          killed: err && err.killed,
          stdout: String(stdout || ''),
          stderr: String(stderr || '')
        });
      });
    p.on('error', (e) => { if (!settled) { settled = true; resolve({ ok: false, error: String(e) }); } });
  });
}
function runGit(args, timeoutMs) {
  return runCmd('git', ['-c', 'http.sslVerify=false'].concat(args), timeoutMs);
}
/* 一键同步上线：与当前正式发布链路完全一致
   提交 → prepare_site.js → wrangler deploy → 推 xjdz（域名绑定仓库）与 origin。
   部署失败不阻断推送，但会在结果里明确提示。 */
async function deploySync() {
  const out = { ok: true, pushed: false, deployed: false, message: '', mirrorWarning: '', detail: [] };
  if (!isGitRepo()) { out.ok = false; out.message = '未检测到 git 仓库，跳过同步上线'; return out; }
  try {
    const inside = await runGit(['rev-parse', '--is-inside-work-tree'], 30000);
    if (!inside.ok || inside.stdout.trim() !== 'true') {
      out.ok = false; out.message = '当前目录不是 git 工作区，跳过同步上线'; return out;
    }
    const add = await runGit(['add', '-A'], 60000);
    if (!add.ok) { out.ok = false; out.message = 'git add 失败：' + (add.stderr || add.error || '未知错误'); return out; }
    const st = await runGit(['status', '--porcelain'], 60000);
    if (!st.ok) { out.ok = false; out.message = 'git status 失败，跳过推送'; return out; }
    if (st.stdout.trim()) {
      const msg = 'chore: 本地后台发布同步 ' + stamp();
      const commit = await runGit(['commit', '-m', msg], 60000);
      if (!commit.ok) { out.ok = false; out.message = 'commit 失败：' + (commit.stderr || commit.error || ''); return out; }
    } else {
      out.detail.push('没有新的代码改动');
    }

    // prepare_site 按 git ls-files 取文件，必须在 git add 之后执行
    const site = await runCmd(process.execPath, [path.join(ROOT, 'tools', 'prepare_site.js')], 60000);
    if (!site.ok) out.detail.push('站点产物生成失败：' + (site.stderr || site.error || '').split('\n').filter(Boolean).pop());

    // 发布到 xjdz.de5.net（Workers 静态资产 + Worker 脚本）
    const wrangler = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    if (fs.existsSync(wrangler)) {
      const dep = await runCmd(process.execPath, [wrangler, 'deploy'], 300000);
      if (dep.ok) {
        out.deployed = true;
        const m = (dep.stdout || '').match(/Current Version ID:\s*([0-9a-f-]+)/i);
        out.detail.push('已发布到 xjdz.de5.net' + (m ? '（版本 ' + m[1].slice(0, 8) + '）' : ''));
      } else {
        const tail = (dep.stderr || dep.stdout || dep.error || '未知错误').split('\n').map(s => s.trim()).filter(Boolean).pop();
        out.ok = false;
        out.detail.push('站点部署失败：' + tail);
      }
    } else {
      out.ok = false;
      out.detail.push('未找到本地 wrangler，跳过站点部署');
    }

    const tailOf = r => ((r.stderr || r.error || '未知错误').split('\n').map(s => s.trim()).filter(Boolean).pop());
    // 主仓库 = xjdz.de5.net 绑定的 xjdz-P2P-test，必须成功
    const main = await runGit(['push', 'xjdz', 'main'], 100000);
    if (main.ok) { out.pushed = true; out.detail.push('已推送 xjdz-P2P-test'); }
    else { out.ok = false; out.detail.push('主仓库推送失败：' + tailOf(main)); }

    // 镜像仓库 = 旧仓库 xuanji-pinball，仅尽力而为：失败不影响整体结果
    const mirror = await runGit(['push', 'origin', 'main'], 100000);
    if (mirror.ok) out.detail.push('已推送 xuanji-pinball');
    else {
      out.mirrorWarning = '镜像仓库 xuanji-pinball 未同步：' + tailOf(mirror);
      out.detail.push(out.mirrorWarning);
    }
    out.message = out.detail.length ? out.detail.join('；') : '已同步上线';
    return out;
  } catch (e) {
    out.ok = false; out.message = '同步异常：' + (e && e.message || e); return out;
  }
}

/* =============================================================
   Steam OpenID 2.0 登录 · 本地镜像
   与线上 cf-worker.js 共用 functions/api/steam-auth-router.mjs 这一份实现，
   只把 Durable Object 换成内存版 AccountHub，本地不依赖 Cloudflare。
   mock 模式（STEAM_OPENID_MOCK 默认开启）：不连 Steam 也能走完整链路，
   供无头浏览器验证 login → callback → session → me → logout。
   ============================================================= */
const { pathToFileURL } = require('url');
let STEAM_ROUTER = null;
async function getSteamRouter() {
  if (STEAM_ROUTER) return STEAM_ROUTER;
  const [routerMod, storeMod] = await Promise.all([
    import(pathToFileURL(path.join(ROOT, 'functions', 'api', 'steam-auth-router.mjs')).href),
    import(pathToFileURL(path.join(ROOT, 'functions', 'api', 'steam-store.mjs')).href)
  ]);
  STEAM_ROUTER = routerMod.createAuthRouter({
    secret: process.env.SESSION_SECRET || 'wowpinball-local-dev-secret-do-not-use-in-prod',
    apiKey: process.env.STEAM_API_KEY || '',
    store: storeMod.memoryStore(),
    devMock: process.env.STEAM_OPENID_MOCK !== '0',
    log: (k, v) => console.log('[steam-auth:local] ' + k + (v ? ' ' + v : ''))
  });
  return STEAM_ROUTER;
}
/* Node http.IncomingMessage → 标准 Request，让本地也能跑同一份路由 */
function toWebRequest(req) {
  const host = req.headers.host || (HOST + ':' + PORT);
  const h = new Headers();
  const skip = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive']);
  Object.keys(req.headers).forEach(k => {
    if (skip.has(k.toLowerCase())) return;
    const v = req.headers[k];
    if (Array.isArray(v)) v.forEach(x => h.append(k, String(x)));
    else if (v != null) h.set(k, String(v));
  });
  return new Request('http://' + host + (req.url || '/'), { method: req.method || 'GET', headers: h });
}
/* 标准 Response → Node http.ServerResponse（含多个 Set-Cookie） */
async function sendWebResponse(res, webRes) {
  webRes.headers.forEach((v, k) => {
    if (k.toLowerCase() !== 'set-cookie') res.setHeader(k, v);
  });
  const cookies = typeof webRes.headers.getSetCookie === 'function'
    ? webRes.headers.getSetCookie()
    : [webRes.headers.get('set-cookie')].filter(Boolean);
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.statusCode = webRes.status;
  if (webRes.status === 204 || webRes.status === 304) { res.end(); return; }
  const buf = Buffer.from(await webRes.arrayBuffer());
  res.end(buf);
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });

  if (url.startsWith('/api/')) {
    try {
      ensureDirs();
      if (url.startsWith('/api/auth/steam/')) {
        const router = await getSteamRouter();
        const webRes = await router.handle(toWebRequest(req));
        if (webRes) return await sendWebResponse(res, webRes);
      }
      if (url.startsWith('/api/room')) {
        // 与线上一致的「建房 / 加入」按账号维度限流；poll / list 心跳不限流
        const ru = new URL(url, 'http://' + HOST + ':' + PORT);
        const roomAct = (ru.pathname.split('/').filter(Boolean).pop() || '').toLowerCase();
        const guardAct = roomAct === 'create' ? 'roomCreate' : (roomAct === 'lookup' ? 'roomLookup' : '');
        if (guardAct) {
          const g = await (await getSteamRouter()).guard(toWebRequest(req), guardAct);
          if (!g.ok) return json(res, 429, { error: 'rate_limited', scope: guardAct, retryAfterMs: g.retryAfterMs });
        }
        return await handleLocalRoom(req, res, url);
      }
      if (req.method === 'GET' && url.startsWith('/api/turn')) return await handleLocalTurn(res);
      // 开发启动台控制接口（launcher.html 用）。服务自身即游戏服务，故 status 恒为运行中。
      if (url.startsWith('/api/status')) {
        return json(res, 200, { ok: true, running: true, port: PORT, launcher: true });
      }
      if (url.startsWith('/api/open')) {
        let target = '/index.html';
        try { target = new URL(url, 'http://' + HOST + ':' + PORT).searchParams.get('path') || '/index.html'; } catch (e) {}
        const safe = String(target).replace(/[^a-zA-Z0-9_.\/-]/g, '');
        const openUrl = 'http://' + HOST + ':' + PORT + safe;
        openBrowser(openUrl);
        return json(res, 200, { ok: true, url: openUrl });
      }
      if (req.method === 'POST' && url.startsWith('/api/stop')) {
        send(res, 200, JSON.stringify({ ok: true }));
        setTimeout(() => process.exit(0), 200);   // 先回响应再退出，避免连接被掐断
        return;
      }
      if (req.method === 'GET' && url.startsWith('/api/config')) {
        if (!fs.existsSync(CONFIG_FILE)) return json(res, 200, { ok: true, data: null });
        const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        stripLegacyFxTick(data);   // 读取时也剥一次：旧页面即使缓存了死字段，回写也不会再带回来
        return json(res, 200, { ok: true, data: data });
      }
      if (req.method === 'POST' && url.startsWith('/api/config')) {
        // push=1 同步上线（部署 xjdz.de5.net + 推仓库，版本号 +1）；否则仅本地预览
        const wantPush = /[?&]push=1/.test(url);
        const raw = await readBody(req);
        let data;
        try { data = JSON.parse(raw); } catch (e) { return json(res, 400, { ok: false, error: 'JSON 解析失败' }); }
        // v3 核心玩法：classes（职业表）已移除，果实池 skills 与外观库 skins 为必需结构
        if (!data || !data.config || !Array.isArray(data.skills) || !Array.isArray(data.skins)) {
          return json(res, 400, { ok: false, error: '配置结构不完整（需要 skills 果实池与 skins 外观库）' });
        }
        if (fs.existsSync(CONFIG_FILE)) {
          fs.writeFileSync(path.join(HISTORY_DIR, stamp() + '.json'), fs.readFileSync(CONFIG_FILE));
        }
        // 私有版本号：以「已落盘文件」里的计数作为权威，不信任浏览器草稿回传，避免重复计数。
        // 正式同步 GitHub：严格 +1 重编码；本地预览：沿用已落盘的版本号（测试不消耗版本）。
        // 编码格式只有我们自己理解（见 tools/version-codec.js）。
        let verInfo;
        try {
          const prevObj = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : null;
          if (wantPush) {
            verInfo = require('./tools/version-codec').nextVersion(prevObj || data);
          } else {
            verInfo = {
              version: (prevObj && prevObj.version) || data.version || '',
              versionSeq: (prevObj && prevObj.versionSeq) || data.versionSeq || 0
            };
          }
        } catch (e) { verInfo = wantPush ? { versionSeq: 1, version: 'WJ-DEV' } : { versionSeq: 0, version: '' }; }
        data.versionSeq = verInfo.versionSeq;
        data.version = verInfo.version;
        stripLegacyFxTick(data);   // 剥掉特效模块的历史 tick 死字段，防止旧草稿回潮
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
        // 同步刷新静态站副本；失败只告警，不影响本次发布结果
        try { require('./tools/export-static-config')(); }
        catch (e) { console.warn('静态配置副本生成失败：' + (e && e.message || e)); }
        // 同步到 GitHub（后台文件已 gitignore，不会进仓库）；本地预览跳过，失败仅告警
        let github = null;
        if (wantPush) {
          try { github = await deploySync(); }
          catch (e) { github = { ok: false, message: '同步未执行：' + (e && e.message || e) }; }
          if (github) {
            if (github.ok && github.pushed) console.log('[deploy] 已同步上线并推送仓库');
            else console.warn('[deploy] ' + (github.message || '未同步'));
          }
        } else {
          github = { ok: true, pushed: false, message: '本地预览已更新，未上线' };
        }
        return json(res, 200, { ok: true, savedAt: new Date().toISOString(), github: github,
          version: data.version, versionSeq: data.versionSeq });
      }
      if (req.method === 'GET' && url.startsWith('/api/history')) {
        const files = fs.existsSync(HISTORY_DIR)
          ? fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 30)
          : [];
        return json(res, 200, { ok: true, files: files });
      }
      return json(res, 404, { ok: false, error: '未知接口' });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e && e.message || e) });
    }
  }

  const target = safePath(url);
  if (!target) return json(res, 403, { ok: false, error: '禁止访问' });
  let file = target;
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, 'Not Found', 'text/plain; charset=utf-8');
  }
  const ext = path.extname(file).toLowerCase();
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 500, 'Read Error', 'text/plain; charset=utf-8');
    send(res, 200, buf, MIME[ext] || 'application/octet-stream');
  });
});

server.listen(PORT, HOST, () => {
  ensureDirs();
  console.log('选技弹珠开发服务已启动');
  console.log('  开发启动台： http://' + HOST + ':' + PORT + '/launcher.html');
  console.log('  后台工具： http://' + HOST + ':' + PORT + '/admin.html');
  console.log('  游戏预览： http://' + HOST + ':' + PORT + '/index.html');
  console.log('  配置文件： ' + CONFIG_FILE);
  console.log('按 Ctrl+C 停止');
  // 自动打开开发启动台，让「双击 bat → 页面出现」。设 WB_NO_OPEN=1 可关闭。
  if (!process.env.WB_NO_OPEN) {
    setTimeout(() => openBrowser('http://' + HOST + ':' + PORT + '/launcher.html'), 600);
  }
});
