'use strict';
/* 无头 Edge 冒烟：主页商店 / 金币 / 外观解锁 / 界面编辑器图层
   依赖本地服务 127.0.0.1:8787 与调试端口 9222。 */
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const wait = ms => new Promise(r => setTimeout(r, ms));
function getJson(p) {
  return new Promise((res, rej) => {
    http.get('http://127.0.0.1:9222' + p, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}
(async () => {
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=9222',
    '--user-data-dir=/tmp/edge_shop_' + Date.now(), '--window-size=1400,950', 'about:blank'], { stdio: 'ignore' });
  await wait(2600);
  const list = await getJson('/json/list');
  const page = list.find(t => t.type === 'page') || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = new Map(); const errors = [];
  ws.on('message', m => {
    const d = JSON.parse(m);
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception || {}).description || 'exception');
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error')
      errors.push('console.error: ' + (d.params.args || []).map(a => a.value || a.description || '').join(' '));
  });
  await new Promise(r => ws.on('open', r));
  const send = (method, params) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  // ---------- A 游戏端 ----------
  await send('Page.navigate', { url: 'http://127.0.0.1:8787/' });
  await wait(4200);
  // 清掉上一次冒烟留下的存档，保证金币 / 外观解锁从初始状态开始
  await ev(`(function(){
    ['wowpinball.config.v1','wowpinball.wallet.v1','wowpinball.fruits.v1','wowpinball.profile.v1'].forEach(function(k){localStorage.removeItem(k);});
    return 'cleared';
  })()`);
  await wait(200);
  await send('Page.reload', { ignoreCache: true });   // 绕开脚本的 memory cache
  await wait(5200);
  const boot = await ev(`({ url:location.href, data:typeof window.WOWPINBALL_DATA,
    shop:!!(window.WOWPINBALL_DATA&&window.WOWPINBALL_DATA.shop),
    keys:(window.WOWPINBALL_DATA&&Object.keys(window.WOWPINBALL_DATA).slice(0,20))||[],
    defShop:!!(window.WOWPINBALL_DEFAULT&&window.WOWPINBALL_DEFAULT.shop),
    pubShop:!!(window.WOWPINBALL_PUBLISHED&&window.WOWPINBALL_PUBLISHED.shop),
    pubKeys:(window.WOWPINBALL_PUBLISHED&&Object.keys(window.WOWPINBALL_PUBLISHED).slice(-4))||[],
    dataIsPub:window.WOWPINBALL_DATA===window.WOWPINBALL_PUBLISHED,
    localShop:!!(JSON.parse(localStorage.getItem('wowpinball.config.v1')||'{}').shop),
    source:window.WOWPINBALL_CONFIG_SOURCE })`);
  console.log('① 游戏页:', JSON.stringify(boot));

  const seeded = await ev(`(function(){
    try {
      var D=window.WOWPINBALL_DATA; if(!D||!D.skills||!D.skills.length) return 'no data';
      localStorage.setItem('wowpinball.profile.v1', JSON.stringify({name:'probe'}));
      localStorage.setItem('wowpinball.fruits.v1', JSON.stringify({owned:[{uid:'p_seed',id:D.skills[0].id}],skinId:'',skinTheme:'all'}));
      return 'ok';
    } catch(e){ return String(e&&e.message||e); }
  })()`);
  console.log('② 预置存档:', seeded);
  await send('Page.navigate', { url: 'http://127.0.0.1:8787/' });
  await wait(5000);

  const initial = await ev(`(function(){
    return {
      coin: (document.getElementById('coinAmount')||{}).textContent,
      shopBtn: !!document.getElementById('shopBtn'),
      skins: document.querySelectorAll('#skinGrid .skin-card').length,
      fruits: document.querySelectorAll('#fruitGrid .fruit-card').length,
      lockHint: !!document.querySelector('.shop-lock-hint')
    };
  })()`);
  console.log('③ 初始状态:', JSON.stringify(initial));

  const opened = await ev(`(function(){
    document.getElementById('shopBtn').click();
    var cards=[].slice.call(document.querySelectorAll('.shop-pool-item'));
    return {
      open: !document.getElementById('shopModal').hidden,
      cards: cards.length,
      prices: cards.map(function(c){return (c.querySelector('.shop-egg-price')||{}).textContent.trim();}),
      names: cards.map(function(c){return (c.querySelector('.shop-egg-name')||{}).textContent;}),
      shopCoin: (document.getElementById('shopCoinAmount')||{}).textContent
    };
  })()`);
  console.log('④ 商店弹层:', JSON.stringify(opened));

  const drewFruit = await ev(`(function(){
    var b=document.querySelector('.shop-egg-btn[data-kind="fruit"][data-tier="normal"]');
    if(!b) return 'no btn';
    b.click();
    return {
      coin:(document.getElementById('coinAmount')||{}).textContent,
      shopCoin:(document.getElementById('shopCoinAmount')||{}).textContent,
      result:(document.getElementById('shopResult')||{}).textContent,
      fruits:document.querySelectorAll('#fruitGrid .fruit-card').length,
      againDisabled:(document.getElementById('shopDrawBtn')||{}).disabled
    };
  })()`);
  console.log('⑤ 抽普通果实蛋:', JSON.stringify(drewFruit));

  const drewSkin = await ev(`(function(){
    var b=document.querySelector('.shop-egg-btn[data-kind="skin"][data-tier="normal"]');
    if(!b) return 'no btn';
    b.click();
    return {
      coin:(document.getElementById('coinAmount')||{}).textContent,
      result:(document.getElementById('shopResult')||{}).textContent,
      skins:document.querySelectorAll('#skinGrid .skin-card').length
    };
  })()`);
  console.log('⑥ 抽普通外观蛋:', JSON.stringify(drewSkin));

  // ---------- B 后台界面编辑器图层 ----------
  await ev(`(function(){document.getElementById('shopDoneBtn')&&document.getElementById('shopDoneBtn').click();})()`);
  await send('Page.navigate', { url: 'http://127.0.0.1:8787/admin.html' });
  await wait(5200);
  const layers = await ev(`(function(){
    try {
      var UI=window.WowPinballUI, S=UI&&UI.screens; if(!S) return 'no screens';
      function keys(id){var s=S.filter(function(x){return x.id===id;})[0];return s?(s.items||[]).map(function(i){return i[0];}):[];}
      var start=keys('start'), shop=keys('shop');
      return { startHas:start.filter(function(k){return ['coinBadge','coinAmount','coinIcon','shopBtn','shopLockHint'].indexOf(k)>=0;}),
               shopHas:shop.filter(function(k){return ['fruitPool','skinPool','eggCard','eggIcon','eggName','eggTier','eggPrice','eggBtn','result','drawBtn','doneBtn'].indexOf(k)>=0;}),
               shopCount:shop.length, startCount:start.length };
    } catch(e){ return {__err:String(e&&e.message||e)}; }
  })()`);
  console.log('⑦ 界面编辑器图层:', JSON.stringify(layers));

  await ev(`(function(){var b=document.querySelector('[data-tab="ui"]');if(b)b.click();})()`);
  await wait(1400);
  const uiTab = await ev(`(function(){
    var sel=document.getElementById('uiScreen');
    return { hasSel:!!sel, hasShop: !!(sel&&[].slice.call(sel.options).some(function(o){return o.value==='shop';})),
             hasStart: !!(sel&&[].slice.call(sel.options).some(function(o){return o.value==='start';})) };
  })()`);
  console.log('⑧ 界面编辑器屏幕下拉:', JSON.stringify(uiTab));
  const shopLayers = await ev(`(function(){
    var sel=document.getElementById('uiScreen'); if(!sel) return 'no sel';
    sel.value='shop'; sel.dispatchEvent(new Event('change',{bubbles:true}));
    return 'ok';
  })()`);
  await wait(900);
  await ev(`(function(){
    var b=document.querySelector('[data-act="ui-select"][data-id="eggIcon"]'); if(b)b.click();
  })()`);
  await wait(700);
  const layerList = await ev(`(function(){
    var h=document.body.innerHTML;
    return {
      eggIcon:/蛋图标|eggIcon/.test(h),
      eggCard:/蛋卡|eggCard/.test(h),
      hasDrop:!!document.getElementById('uiDrop'),
      hasSize:/位置与尺寸/.test(h)
    };
  })()`);
  console.log('⑧b 切到 shop 屏的图层与属性:', shopLayers, JSON.stringify(layerList));

  await ev(`(function(){var b=document.querySelector('[data-tab="balance"]');if(b)b.click();})()`);
  await wait(1000);
  const balance = await ev(`(function(){
    var ids=['cfg_shop_coinsInit','cfg_shop_prices_fruit_normal','cfg_shop_prices_skin_precious','cfg_shop_initialSkins'];
    return ids.map(function(x){return [x,!!document.getElementById(x)];});
  })()`);
  console.log('⑨ 数值平衡商店字段:', JSON.stringify(balance));

  console.log('⑩ 捕获到的错误数:', errors.length, errors.slice(0, 3).join(' | '));

  const checks = {
    '游戏页读到 shop 配置': boot && boot.shop === true,
    '初始金币 300、商店入口存在': initial && initial.coin === '300' && initial.shopBtn === true,
    '初始只解锁 3 个外观，并提示未解锁': initial && initial.skins === 3 && initial.lockHint === true,
    '商店弹层 6 张蛋卡（两类 × 三品质）': opened && opened.open === true && opened.cards === 6,
    '六档价格各不相同且按品质递增': opened && opened.prices.join(',') === '60,150,360,80,200,480',
    '抽果实蛋扣 60 金币且果实入库': drewFruit && drewFruit.coin === '240' && /开出果实/.test(drewFruit.result) && drewFruit.fruits === initial.fruits + 1,
    '「再抽一次」按钮已启用': drewFruit && drewFruit.againDisabled === false,
    '抽外观蛋结果合法（解锁或返还）': drewSkin && (/解锁新外观/.test(drewSkin.result) || /返还/.test(drewSkin.result)),
    '界面编辑器 start 屏登记金币/商店元素': layers && layers.startHas && layers.startHas.length === 5,
    '界面编辑器 shop 屏登记全部蛋卡元素': layers && layers.shopHas && layers.shopHas.length === 11,
    '编辑界面下拉含 shop 屏': uiTab && uiTab.hasShop === true,
    'shop 屏可选中蛋图标并出现素材上传/尺寸控件': layerList && layerList.eggCard === true && layerList.eggIcon === true && layerList.hasDrop === true && layerList.hasSize === true,
    '数值平衡页含商店价格与初始金币字段': balance && balance.every(x => x[1] === true)
  };
  let fail = 0;
  Object.keys(checks).forEach(k => { console.log('  ' + (checks[k] ? '✓' : '✗') + ' ' + k); if (!checks[k]) fail++; });
  const pass = !fail && !errors.length;
  console.log('RESULT:', pass ? 'PASS' : 'FAIL');
  ws.close(); edge.kill(); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
