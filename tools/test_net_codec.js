/* P2P 邀请码编解码回归测试
   覆盖：net-test.html 内的 pack/unpack 往返 / 链接形态解析 / 坏输入拒绝 /
        压缩率与字符集安全 / 长 SDP 不栈溢出
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

function loadCodec() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const start = html.indexOf('function u8ToB64');
  const end = html.indexOf('/* ---------- ICE 配置 ---------- */');
  if (start < 0 || end < 0 || end <= start) throw new Error('未能从 net-test.html 定位编解码实现');
  const code = html.slice(start, end);
  return new Function(code + '\nreturn { pack: pack, unpack: unpack, u8ToB64: u8ToB64, b64ToU8: b64ToU8 };')();
}

function makeSdp(candCount) {
  const lines = [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=ice-ufrag:Kq3p',
    'a=ice-pwd:x8Lm2Rt9VbN4wYc6',
    'a=ice-options:trickle',
    'a=fingerprint:sha-256 7B:8C:1D:2E:3F:40:51:62:73:84:95:A6:B7:C8:D9:EA:FB:0C:1D:2E:3F:40:51:62:73:84:95:A6:B7:C8:D9:EA',
    'a=setup:actpass',
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144'
  ];
  for (let i = 1; i <= candCount; i++) {
    const types = ['host', 'srflx', 'relay'];
    const t = types[i % 3];
    const ip = t === 'host' ? '192.168.1.' + i : t === 'srflx' ? '203.0.113.' + i : '198.51.100.' + i;
    lines.push('a=candidate:299974585' + i + ' ' + i + ' udp 2113937151 ' + ip + ' ' + (54000 + i) + ' typ ' + t + ' generation 0 network-cost 999');
  }
  return lines.join('\r\n') + '\r\n';
}

(async () => {
  console.log('\n1) 编解码往返');
  const codec = loadCodec();
  const sdpSmall = makeSdp(2);
  const offer = { t: 'offer', sdp: sdpSmall, ty: 'offer' };
  const packedOffer = await codec.pack(offer);
  const backOffer = await codec.unpack(packedOffer);
  ok('offer 往返 SDP 一致', backOffer.sdp === offer.sdp);
  ok('offer 往返类型一致', backOffer.t === 'offer' && backOffer.ty === 'offer');

  const answer = { t: 'answer', sdp: sdpSmall.replace('a=setup:actpass', 'a=setup:active'), ty: 'answer' };
  const backAnswer = await codec.unpack(await codec.pack(answer));
  ok('answer 往返一致', backAnswer.t === 'answer' && backAnswer.sdp === answer.sdp);

  console.log('\n2) 链接形态解析');
  const urlO = 'https://example.com/net-test.html#o=' + packedOffer;
  const urlA = 'http://127.0.0.1:8787/net-test.html#a=' + packedOffer;
  ok('#o= 链接可解析', (await codec.unpack(urlO)).sdp === offer.sdp);
  ok('#a= 链接可解析', (await codec.unpack(urlA)).sdp === offer.sdp);
  ok('裸邀请码可解析', (await codec.unpack('  ' + packedOffer + '\n')).sdp === offer.sdp);

  console.log('\n3) 坏输入拒绝');
  const badCases = [
    ['空字符串', ''],
    ['过短内容', 'abc'],
    ['未知前缀', 'x.' + packedOffer.slice(2)],
    ['损坏的基址内容', 'z.@@@@@@@@@@@@'],
    ['被截断的邀请码', packedOffer.slice(0, Math.floor(packedOffer.length / 2))]
  ];
  for (const [label, input] of badCases) {
    let rejected = false;
    let msg = '';
    try { await codec.unpack(input); }
    catch (e) { rejected = true; msg = e.message; }
    ok('拒绝 ' + label, rejected, msg || '竟然通过了');
  }

  console.log('\n4) 编码体积与字符集');
  const sdpBig = makeSdp(9);
  const packedBig = await codec.pack({ t: 'offer', sdp: sdpBig, ty: 'offer' });
  const packRatio = packedBig.length / sdpBig.length;
  ok('确实启用压缩（前缀 z.）', packedBig.slice(0, 2) === 'z.', packedBig.slice(0, 2));
  ok('编码后小于原始 SDP', packedBig.length < sdpBig.length, packedBig.length + ' vs ' + sdpBig.length);
  ok('压缩率在合理区间', packRatio > 0.2 && packRatio < 0.85, (packRatio * 100).toFixed(1) + '%');
  ok('仅含 URL 安全字符', /^[A-Za-z0-9\-_.]+$/.test(packedBig), packedBig.slice(0, 24));
  ok('9 候选全长 SDP 未触发栈溢出', (await codec.unpack(packedBig)).sdp === sdpBig);

  console.log('\n5) base64url 边界');
  const bytes = new Uint8Array(70000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  const b64 = codec.u8ToB64(bytes);
  ok('7 万字节编码不溢出', b64.length > 0);
  const round = codec.b64ToU8(b64);
  let same = round.length === bytes.length;
  if (same) { for (let i = 0; i < bytes.length; i++) { if (round[i] !== bytes[i]) { same = false; break; } } }
  ok('7 万字节解码一致', same);
  ok('不含 + / = 字符', b64.indexOf('+') < 0 && b64.indexOf('/') < 0 && b64.indexOf('=') < 0);

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('\n测试异常：' + e.message);
  process.exit(1);
});
