/**
 * Cloudflare TURN 凭证 Worker 的离线回归测试
 *
 * 不需要真实 Cloudflare 账号：把上游 fetch 和 caches.default 都换成内存实现，
 * 验证鉴权、CORS、缓存、错误透传、ttl 下限这些容易写错的分支。
 *
 * 运行：node tools/test_turn_worker.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let pass = 0;
let fail = 0;

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''));
  }
}

/* ---------- 内存版 caches.default ---------- */
const store = new Map();
globalThis.caches = {
  default: {
    async match(req) {
      const rec = store.get(req.url);
      if (!rec) return undefined;
      if (rec.expireAt && Date.now() > rec.expireAt) {
        store.delete(req.url);
        return undefined;
      }
      return new Response(rec.body, { headers: { 'Content-Type': 'application/json' } });
    },
    async put(req, res) {
      const body = await res.text();
      const cc = res.headers.get('Cache-Control') || '';
      const m = cc.match(/max-age=(\d+)/);
      store.set(req.url, {
        body,
        expireAt: m ? Date.now() + Number(m[1]) * 1000 : 0,
      });
    },
  },
};

/* ---------- 可控的上游 ---------- */
let upstreamCalls = [];
let upstreamReply = null;

globalThis.fetch = async (url, init) => {
  if (String(url).indexOf('rtc.live.cloudflare.com') < 0) {
    throw new Error('未预期的请求: ' + url);
  }
  upstreamCalls.push({ url: String(url), init });
  const r = upstreamReply;
  if (r && r.throw) throw new Error(r.throw);
  return new Response(r && r.body !== undefined ? r.body : '', {
    status: (r && r.status) || 201,
    headers: { 'Content-Type': 'application/json' },
  });
};

const GOOD = JSON.stringify({
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478'] },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:443?transport=udp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: '0123456789abcdef0123456789abcdef',
      credential: 'fedcba9876543210fedcba9876543210',
    },
  ],
});

const ENV = {
  TURN_KEY_ID: 'key-abc',
  TURN_KEY_API_TOKEN: 'tok-secret',
  ALLOWED_ORIGIN: 'https://xjdz.de5.net',
};

/* ---------- 载入 Worker（ESM 走 data URL，避免 package.json 的 module 类型问题） ---------- */
async function loadWorker() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'worker', 'turn-credentials.js'), 'utf8');
  const url = 'data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64');
  const mod = await import(url);
  return mod.default;
}

function req(method, origin) {
  const headers = {};
  if (origin) headers.Origin = origin;
  return new Request('https://turn.example.workers.dev/', { method, headers });
}

(async () => {
  const worker = await loadWorker();

  console.log('\n[1] 正常签发');
  {
    store.clear();
    upstreamCalls = [];
    upstreamReply = { body: GOOD, status: 201 };
    const res = await worker.fetch(req('GET', 'https://xjdz.de5.net'), { ...ENV });
    const body = await res.json();
    ok('状态 200', res.status === 200, res.status);
    ok('返回 iceServers', !!(body.iceServers && body.iceServers.length === 2), body);
    ok('标 MISS', res.headers.get('X-Turn-Cache') === 'MISS', res.headers.get('X-Turn-Cache'));
    ok('CORS 回显来源', res.headers.get('Access-Control-Allow-Origin') === 'https://xjdz.de5.net',
      res.headers.get('Access-Control-Allow-Origin'));
    ok('上游被调用一次', upstreamCalls.length === 1, upstreamCalls.length);
    ok('上游 URL 拼接正确',
      upstreamCalls[0] && upstreamCalls[0].url === 'https://rtc.live.cloudflare.com/v1/turn/keys/key-abc/credentials/generate-ice-servers',
      upstreamCalls[0] && upstreamCalls[0].url);
    ok('请求带 Bearer', upstreamCalls[0] && upstreamCalls[0].init.headers.Authorization === 'Bearer tok-secret',
      upstreamCalls[0] && upstreamCalls[0].init.headers.Authorization);
    ok('默认 ttl 86400', JSON.parse(upstreamCalls[0].init.body).ttl === 86400,
      upstreamCalls[0].init.body);
  }

  console.log('\n[2] 缓存命中');
  {
    const before = upstreamCalls.length;
    const res = await worker.fetch(req('GET', 'https://xjdz.de5.net'), { ...ENV });
    await res.json();
    ok('标 HIT', res.headers.get('X-Turn-Cache') === 'HIT', res.headers.get('X-Turn-Cache'));
    ok('上游不再被调用', upstreamCalls.length === before, upstreamCalls.length - before);
  }

  console.log('\n[3] ttl 下限保护');
  {
    store.clear();
    upstreamCalls = [];
    upstreamReply = { body: GOOD, status: 201 };
    await worker.fetch(req('GET', ''), { ...ENV, TURN_TTL: '10' });
    ok('ttl 抬到 300', JSON.parse(upstreamCalls[0].init.body).ttl === 300,
      upstreamCalls[0].init.body);
  }

  console.log('\n[4] 自定义 ttl 与缓存键隔离');
  {
    store.clear();
    upstreamCalls = [];
    upstreamReply = { body: GOOD, status: 201 };
    await worker.fetch(req('GET', ''), { ...ENV, TURN_TTL: '600' });
    const cacheSize = store.size;
    upstreamCalls = [];
    await worker.fetch(req('GET', ''), { ...ENV, TURN_TTL: '7200' });
    ok('ttl 变化后重新取上游', upstreamCalls.length === 1, upstreamCalls.length);
    ok('缓存键随 ttl 分开', store.size === cacheSize + 1, [cacheSize, store.size]);
  }

  console.log('\n[5] 缺少 Secret');
  {
    store.clear();
    const a = await worker.fetch(req('GET', ''), { TURN_KEY_API_TOKEN: 'x' });
    ok('缺 TURN_KEY_ID 报 500', a.status === 500, a.status);
    ok('错误码为 missing_secret', (await a.json()).error === 'missing_secret');

    const b = await worker.fetch(req('GET', ''), { TURN_KEY_ID: 'k' });
    ok('缺 TOKEN 报 500', b.status === 500, b.status);
  }

  console.log('\n[6] 来源限制');
  {
    store.clear();
    const denied = await worker.fetch(req('GET', 'https://evil.example.com'), { ...ENV });
    ok('非白名单来源 403', denied.status === 403, denied.status);
    ok('错误码 origin_not_allowed', (await denied.json()).error === 'origin_not_allowed');

    upstreamReply = { body: GOOD, status: 201 };
    const allowedNoSlash = await worker.fetch(req('GET', 'https://xjdz.de5.net/'), { ...ENV });
    ok('带尾斜杠的来源也放行', allowedNoSlash.status === 200, allowedNoSlash.status);

    store.clear();
    const noOrigin = await worker.fetch(req('GET', ''), { ...ENV });
    ok('无 Origin（地址栏直开）放行', noOrigin.status === 200, noOrigin.status);

    store.clear();
    const open = await worker.fetch(req('GET', 'https://any.example.com'), {
      TURN_KEY_ID: 'k', TURN_KEY_API_TOKEN: 't',
    });
    ok('未设 ALLOWED_ORIGIN 时不限制', open.status === 200, open.status);
    ok('未设限制时回显请求来源', open.headers.get('Access-Control-Allow-Origin') === 'https://any.example.com',
      open.headers.get('Access-Control-Allow-Origin'));
    ok('回显时带 Vary: Origin', /Origin/i.test(open.headers.get('Vary') || ''), open.headers.get('Vary'));

    store.clear();
    const noOrigin2 = await worker.fetch(req('GET', ''), { TURN_KEY_ID: 'k', TURN_KEY_API_TOKEN: 't' });
    ok('无 Origin 时回 *', noOrigin2.headers.get('Access-Control-Allow-Origin') === '*',
      noOrigin2.headers.get('Access-Control-Allow-Origin'));
  }

  console.log('\n[7] 方法处理');
  {
    const opt = await worker.fetch(req('OPTIONS', 'https://xjdz.de5.net'), { ...ENV });
    ok('OPTIONS 返回 204', opt.status === 204, opt.status);
    ok('预检带允许方法', /GET/.test(opt.headers.get('Access-Control-Allow-Methods') || ''),
      opt.headers.get('Access-Control-Allow-Methods'));

    const post = await worker.fetch(req('POST', 'https://xjdz.de5.net'), { ...ENV });
    ok('POST 返回 405', post.status === 405, post.status);
    ok('错误码 method_not_allowed', (await post.json()).error === 'method_not_allowed');
  }

  console.log('\n[8] 上游异常');
  {
    store.clear();
    upstreamReply = { body: '{"error":"bad token"}', status: 401 };
    const a = await worker.fetch(req('GET', ''), { ...ENV });
    ok('上游 401 转 502', a.status === 502, a.status);
    const ja = await a.json();
    ok('带 upstream_error', ja.error === 'upstream_error', ja);
    ok('透传上游状态', ja.status === 401, ja.status);

    store.clear();
    upstreamReply = { body: 'not json at all', status: 201 };
    const b = await worker.fetch(req('GET', ''), { ...ENV });
    ok('上游坏 JSON 转 502', b.status === 502, b.status);
    ok('错误码 upstream_bad_json', (await b.json()).error === 'upstream_bad_json');

    store.clear();
    upstreamReply = { body: '{"foo":1}', status: 201 };
    const c = await worker.fetch(req('GET', ''), { ...ENV });
    ok('缺 iceServers 转 502', c.status === 502, c.status);
    ok('错误码 upstream_no_ice_servers', (await c.json()).error === 'upstream_no_ice_servers');

    store.clear();
    upstreamReply = { throw: 'ECONNRESET' };
    const d = await worker.fetch(req('GET', ''), { ...ENV });
    ok('网络异常转 502', d.status === 502, d.status);
    ok('错误码 upstream_unreachable', (await d.json()).error === 'upstream_unreachable');

    upstreamReply = { body: GOOD, status: 201 };
  }

  console.log('\n[9] 失败响应不写缓存');
  {
    store.clear();
    upstreamReply = { body: '{"x":1}', status: 500 };
    await worker.fetch(req('GET', ''), { ...ENV });
    ok('上游失败时缓存为空', store.size === 0, store.size);
    upstreamReply = { body: GOOD, status: 201 };
    upstreamCalls = [];
    const retry = await worker.fetch(req('GET', ''), { ...ENV });
    ok('恢复后重试走上游', upstreamCalls.length === 1 && retry.status === 200, upstreamCalls.length);
  }

  console.log('\n[10] 解析结果能被前端消费');
  {
    store.clear();
    upstreamCalls = [];
    upstreamReply = { body: GOOD, status: 201 };
    const res = await worker.fetch(req('GET', 'https://xjdz.de5.net'), { ...ENV });
    const text = await res.text();

    const html = fs.readFileSync(path.join(__dirname, '..', 'net-test.html'), 'utf8');
    const i = html.indexOf('function parseTurnInput');
    const j = html.indexOf('/* 数 SDP 里各类候选的数量');
    const parse = new Function(html.slice(i, j) + '; return parseTurnInput;')();
    const t = parse(text);
    ok('页面能解出 3 个 turn 地址', t.urls.length === 3, t.urls);
    ok('页面拿到用户名', t.username === '0123456789abcdef0123456789abcdef', t.username);
    ok('页面拿到凭证', t.credential === 'fedcba9876543210fedcba9876543210', t.credential);
    ok('没混入 stun', !t.urls.some((u) => /^stun:/i.test(u)), t.urls);
  }

  console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试异常：' + (e && e.stack || e));
  process.exit(1);
});
