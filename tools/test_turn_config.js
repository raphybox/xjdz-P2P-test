/* TURN 凭证解析与候选统计回归测试
   覆盖：parseTurnInput 三种输入格式 / 坏输入拒绝 / 端口与协议别名 /
        countCand 对远端 SDP 的候选类型计数
   说明：直接从 net-test.html 截取真实实现，避免测试副本与页面代码脱节 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'net-test.html');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra != null ? '  [' + extra + ']' : '')); }
}

function loadImpl() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const start = html.indexOf('function parseTurnInput');
  const end = html.indexOf('/* ---------- 日志与状态 ---------- */');
  if (start < 0 || end < 0 || end <= start) throw new Error('未能从 net-test.html 定位 parseTurnInput / countCand');
  const code = html.slice(start, end);
  return new Function(code + '\nreturn { parseTurnInput: parseTurnInput, countCand: countCand };')();
}

const api = loadImpl();
const P = api.parseTurnInput;
const C = api.countCand;

function throws(name, fn, keyword) {
  try { fn(); ok(name, false, '未抛错'); }
  catch (e) { ok(name, keyword ? String(e.message).indexOf(keyword) >= 0 : true, e.message); }
}

console.log('\n== 手写格式 ==');
{
  const r = P('turn:turn.example.com:3478|alice|s3cret');
  ok('单地址解析', r.urls.length === 1 && r.urls[0] === 'turn:turn.example.com:3478');
  ok('用户名正确', r.username === 'alice');
  ok('密码正确', r.credential === 's3cret');

  const r2 = P('  turns:turn.example.com:443?transport=tcp | bob | pw  ');
  ok('turns + TCP 参数', r2.urls[0] === 'turns:turn.example.com:443?transport=tcp');
  ok('两端空白被裁掉', r2.username === 'bob' && r2.credential === 'pw');

  const r3 = P('turn:a.com:3478,turn:a.com:80?transport=tcp|u|p');
  ok('逗号分隔多地址', r3.urls.length === 2 && r3.urls[1] === 'turn:a.com:80?transport=tcp');

  const r4 = P('turn:a.com:3478|u|p|with|pipe');
  ok('密码含竖线不丢字符', r4.credential === 'p|with|pipe');
  ok('密码含竖线时用户名不被污染', r4.username === 'u');
}

console.log('\n== JSON 格式 ==');
{
  const cf = {
    iceServers: [{
      urls: [
        'stun:stun.cloudflare.com:3478',
        'stun:stun.cloudflare.com:53',
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turn:turn.cloudflare.com:3478?transport=tcp',
        'turn:turn.cloudflare.com:80?transport=tcp',
        'turns:turn.cloudflare.com:5349?transport=tcp',
        'turns:turn.cloudflare.com:443?transport=tcp'
      ],
      username: 'user-token-abc',
      credential: 'cred-token-def'
    }]
  };
  const r = P(JSON.stringify(cf));
  ok('Cloudflare 整段响应可解析', r.urls.length === 6, r.urls.length);
  ok('只保留 turn/turns，剔除 stun', r.urls.every(u => /^turns?:/.test(u)));
  ok('末尾 turns:443 保留', r.urls.indexOf('turns:turn.cloudflare.com:443?transport=tcp') >= 0);
  ok('凭证沿用原文', r.username === 'user-token-abc' && r.credential === 'cred-token-def');

  const single = P(JSON.stringify({ urls: 'turn:x.com:3478', username: 'a', credential: 'b' }));
  ok('单个对象（非数组）也能解析', single.urls[0] === 'turn:x.com:3478');

  const arr = P(JSON.stringify([{ urls: ['turn:y.com:3478'], username: 'c', credential: 'd' }]));
  ok('数组根节点也能解析', arr.urls[0] === 'turn:y.com:3478');
}

console.log('\n== 坏输入拒绝 ==');
throws('空字符串报错', () => P(''), '粘贴');
throws('只有两段报错', () => P('turn:a.com:3478|u'), '竖线');
throws('缺少 turn: 前缀报错', () => P('http://a.com|u|p'), 'turn:');
throws('JSON 无 turn 地址报错', () => P(JSON.stringify({ iceServers: [{ urls: ['stun:a.com'] }] })), 'turn:');
throws('JSON 缺 username 报错', () => P(JSON.stringify({ iceServers: [{ urls: ['turn:a.com'], credential: 'x' }] })), 'username');
throws('JSON 语法错误报错', () => P('{oops}'), '');

console.log('\n== 候选计数 ==');
{
  const sdp = [
    'v=0',
    'a=candidate:1 1 udp 2113937151 192.168.1.5 5000 typ host',
    'a=candidate:2 1 udp 2113937151 192.168.1.6 5001 typ host',
    'a=candidate:3 1 udp 1677729535 203.0.113.44 5000 typ srflx raddr 0.0.0.0 rport 0',
    'a=candidate:4 1 tcp 1518280447 198.51.100.9 62000 typ relay raddr 0.0.0.0 rport 0',
    'a=end-of-candidates'
  ].join('\r\n');
  const s = C(sdp);
  ok('host 计 2', s.host === 2, s.host);
  ok('srflx 计 1', s.srflx === 1, s.srflx);
  ok('relay 计 1', s.relay === 1, s.relay);
  ok('prflx 计 0', s.prflx === 0, s.prflx);

  const s2 = C('');
  ok('空 SDP 全为 0', s2.host === 0 && s2.srflx === 0 && s2.relay === 0);
  ok('null 不报错', C(null).relay === 0);
  ok('无候选的 SDP 全为 0', C('v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel').host === 0);
}

console.log('\n== 结果 ==');
console.log(pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exit(1);
