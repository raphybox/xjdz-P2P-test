# -*- coding: utf-8 -*-
"""方案 A 安装器（Windows / macOS / Linux 通用）

用法：
    python 安装.py                      # 项目根 = 当前目录
    python 安装.py "E:\\AI临时文件夹\\.workbuddy\\魔兽弹珠"

做四件事：
  1. 备份现有 admin.html（无论它是不是已经打过别的补丁）
  2. 在 <script src="admin.js"></script> 之后插入 1 行（已有则跳过）
  3. 把包内 y3/ 目录复制到项目根（已有则先备份旧目录）
  4. 静态验收：原逻辑零改动、引用齐全、数据 key 隔离

不碰：admin.js / admin.css / data/game-config.json / 任何正式 localStorage key
"""
import os, sys, shutil, datetime, re

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

PKG = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.getcwd()
ANCHOR = '<script src="admin.js"></script>'
LINE = '<script src="y3/embed.js"></script>'
STAMP = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')


def log(s=''):
    print(s)


def fail(msg):
    log('\n✗ 安装中止：' + msg)
    sys.exit(1)


def main():
    log('=' * 66)
    log('方案 A · 新增「果实编辑器（Y3版）」测试页签')
    log('=' * 66)
    log('项目根：' + ROOT)
    log('包目录：' + PKG)

    for f in ['admin.html', 'admin.js', 'admin.css']:
        if not os.path.isfile(os.path.join(ROOT, f)):
            fail('项目根里找不到 ' + f + '，请确认路径（或把本包放到项目根目录再运行）')

    admin = os.path.join(ROOT, 'admin.html')
    raw = open(admin, 'rb').read()
    nl = '\r\n' if b'\r\n' in raw else '\n'
    # 兼容 Windows 记事本存成 GBK/ANSI 的情况：按原编码读、按原编码写，绝不破坏中文
    try:
        text = raw.decode('utf-8')
        ENC = 'utf-8'
    except UnicodeDecodeError:
        text = raw.decode('gb18030')
        ENC = 'gb18030'
        log('[提示] admin.html 不是 UTF-8，已按 GBK 读取并会用 GBK 原样写回')
    before_lines = len(text.splitlines())

    # ---- 1. 备份 ----
    bak = os.path.join(ROOT, 'admin.html.bak_方案A前_' + STAMP)
    shutil.copy2(admin, bak)
    log('\n[1/4] 已备份 → ' + os.path.basename(bak))

    # ---- 2. 插入 1 行 ----
    if 'y3/embed.js' in text:
        log('[2/4] 检测到已存在 Y3 引用，跳过插入（不会重复添加）')
        changed = False
    else:
        if ANCHOR not in text:
            fail('找不到锚点 ' + ANCHOR + '。你的 admin.html 可能改过 script 顺序，'
                 '请手动在 </body> 前加一行：' + LINE)
        text = text.replace(ANCHOR, ANCHOR + nl + LINE, 1)
        open(admin, 'wb').write(text.encode(ENC))
        changed = True
        after_lines = len(text.splitlines())
        log('[2/4] 已插入 1 行：' + LINE + '  （行数 %d → %d）' % (before_lines, after_lines))
        if after_lines - before_lines != 1:
            fail('净增行数不是 1，请检查文件')

    # ---- 3. 复制 y3/ ----
    src_y3 = os.path.join(PKG, 'y3')
    dst_y3 = os.path.join(ROOT, 'y3')
    if os.path.isdir(dst_y3):
        old = os.path.join(ROOT, 'y3.bak_' + STAMP)
        shutil.move(dst_y3, old)
        log('[3/4] 旧 y3/ 已备份 → ' + os.path.basename(old))
    shutil.copytree(src_y3, dst_y3)
    files = sorted(os.listdir(dst_y3))
    log('[3/4] 已部署 y3/：' + '、'.join(files))

    # ---- 4. 静态验收 ----
    log('\n[4/4] 静态验收')
    ok = True

    def chk(cond, msg):
        nonlocal_ok[0] = nonlocal_ok[0] and bool(cond)
        log(('  ✓ ' if cond else '  ✗ ') + msg)

    nonlocal_ok = [True]

    # 原逻辑零改动
    now = open(admin, 'rb').read().decode(ENC)
    old = open(bak, 'rb').read().decode(ENC)
    if changed:
        chk(now.replace(nl + LINE, '', 1) == old, 'admin.html 除新增 1 行外，与原文件逐字一致')
    else:
        chk('y3/embed.js' in now, 'admin.html 已包含 Y3 引用')
    for f in ['admin.js', 'admin.css']:
        chk(os.path.isfile(os.path.join(ROOT, f)), f + ' 存在且未被本安装器改动')

    # 引用齐全
    need = ['embed.js', 'embed.css', 'index.html', 'editor.css', 'editor.js',
            '语句树_schema.js', '果实库.js']
    for f in need:
        chk(os.path.isfile(os.path.join(dst_y3, f)), 'y3/' + f + ' 存在')

    idx = open(os.path.join(dst_y3, 'index.html'), encoding='utf-8').read()
    for m in re.findall(r'(?:src|href)="([^"#:]+)"', idx):
        chk(os.path.isfile(os.path.join(dst_y3, m)), 'index.html 引用 ' + m + ' 可解析')

    emb = open(os.path.join(dst_y3, 'embed.js'), encoding='utf-8').read()
    chk('data-tab' not in emb.split("btn.innerHTML")[1].split('var anchor')[0],
        '新侧栏按钮未设置 data-tab（不会触发原 switchTab）')
    edjs = open(os.path.join(dst_y3, 'editor.js'), encoding='utf-8').read()
    # 只看真正传给 localStorage 的字符串字面量；注释里提到正式 key 不算违规
    hard = re.findall(r"localStorage\.(?:setItem|getItem|removeItem)\(\s*['\"]([^'\"]+)", edjs)
    chk(all(not k.startswith('wowpinball.config') and
            not k.startswith('wowpinball.snapshots') and
            not k.startswith('wowpinball.preview') for k in hard),
        'Y3 编辑器不读写正式配置 key（实际 localStorage 调用）')
    chk("'wowpinball.y3.test.v1'" in edjs, 'Y3 使用独立 key wowpinball.y3.test.v1')
    chk('isolated=1&embed=1' in emb, 'iframe 以 isolated=1&embed=1 加载（数据隔离）')

    log('\n' + '=' * 66)
    if nonlocal_ok[0]:
        log('✓ 安装完成。现在用 8787 服务打开 admin.html，Ctrl+F5 强刷。')
    else:
        log('⚠ 有验收项未通过，请按上面 ✗ 项排查；备份文件可直接回滚。')
    log('=' * 66)
    log('''
下一步（验收清单）：
  1. 左侧「内容配置」里应多出「果实编辑器 · Y3版 [TEST]」，紧挨原「果实管理」
  2. 点原「果实管理」→ 旧的画布连线编辑器照常工作，功能、数据全部不变
  3. 点 Y3 页签 → iframe 打开语句树编辑器，顶部保存/发布按钮被禁用
  4. 在 Y3 里新建/改果实 → 只写 wowpinball.y3.test.v1，不碰 wowpinball.config.v1
  5. 点「暂存到主后台」→ 存 wowpinball.y3.staging.v1，可下载 JSON 核对
  6. 点「← 返回原后台」或任意原页签 → 视图、标题、按钮全部还原
  7. 直接访问 admin.html?y3=1 可一键进测试页，方便反复回归

回滚：运行 卸载_回滚.py，或把 admin.html.bak_方案A前_* 覆盖回 admin.html
''')


if __name__ == '__main__':
    main()
