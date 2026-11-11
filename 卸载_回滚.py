# -*- coding: utf-8 -*-
"""方案 A 回滚：移除那 1 行引用，恢复备份；y3/ 与暂存数据默认保留。

    python 卸载_回滚.py [项目根]
    python 卸载_回滚.py [项目根] --purge     # 额外删除 y3/ 目录（暂存 localStorage 仍在浏览器里）
"""
import os, sys, glob, shutil, re

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else os.getcwd()
PURGE = '--purge' in sys.argv
LINE = '<script src="y3/embed.js"></script>'

print('项目根：' + ROOT)
admin = os.path.join(ROOT, 'admin.html')

# 方案 1：优先用「不含 Y3 引用」的备份原样恢复
# （重复运行安装器会产生多份备份，最新的那份可能已含引用，不能盲取最后一个）
# 同时兼容两种安装器生成的备份名：PowerShell 的 bak_PlanA_* 与 Python 的 bak_方案A前_*
patterns = ['admin.html.bak_PlanA_*', 'admin.html.bak_方案A前_*']
baks = sorted({p for pat in patterns for p in glob.glob(os.path.join(ROOT, pat))})
NEEDLE = LINE.encode('ascii')          # 引用行是纯 ASCII，UTF-8 / GBK 下字节一致


def strip_ref_bytes(data):
    """字节级删除引用行，完全不碰其余字节，因此与文件编码无关。"""
    return data.replace(NEEDLE, b'')


clean = [b for b in baks if NEEDLE not in open(b, 'rb').read()]
if clean:
    shutil.copy2(clean[0], admin)
    print('✓ 已从原始备份恢复：' + os.path.basename(clean[0]))
elif baks:
    shutil.copy2(baks[0], admin)
    print('✓ 已恢复最早一份备份：' + os.path.basename(baks[0]) + '（仍会按字节清理引用）')
    open(admin, 'wb').write(strip_ref_bytes(open(admin, 'rb').read()))
else:
    # 方案 2：只删那一行（兼容用户手动改过 admin.html 的情况）
    if os.path.isfile(admin):
        open(admin, 'wb').write(strip_ref_bytes(open(admin, 'rb').read()))
        print('✓ 已移除 Y3 引用行（未找到备份，按字节删除，不重新编码）')
    else:
        print('✗ 找不到 admin.html')

if PURGE and os.path.isdir(os.path.join(ROOT, 'y3')):
    shutil.rmtree(os.path.join(ROOT, 'y3'))
    print('✓ 已删除 y3/ 目录')

print('''
回滚完成。注意：
  · 原 admin.js / admin.css / data/game-config.json 全程未被改动
  · 浏览器里的 Y3 测试数据仍在 localStorage：
        wowpinball.y3.test.v1      （Y3 编辑器自己的果实）
        wowpinball.y3.staging.v1   （暂存的导出配置）
    正式配置 wowpinball.config.v1 从未被写入。
    如需清掉测试数据，在浏览器控制台执行：
        localStorage.removeItem('wowpinball.y3.test.v1');
        localStorage.removeItem('wowpinball.y3.staging.v1');
''')
