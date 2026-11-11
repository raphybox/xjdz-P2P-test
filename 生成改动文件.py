# -*- coding: utf-8 -*-
"""基于用户上传的原始 admin.html，生成「仅新增 1 行」的方案 A 改动版 + 对照文件。"""
import os, difflib

D = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(D, 'admin.原始备份.html')
DST = os.path.join(D, 'admin.html')
DIFF = os.path.join(D, '改动对照.txt')

ANCHOR = '<script src="admin.js"></script>'
LINE = '<script src="y3/embed.js"></script>'
MARK = 'y3/embed.js'

raw = open(SRC, 'rb').read()
nl = b'\r\n' if b'\r\n' in raw else b'\n'
text = raw.decode('utf-8')

assert ANCHOR in text, '未找到 <script src="admin.js"></script> 锚点'
assert MARK not in text, '原始文件里已经包含 Y3 引用'

# 保留原换行风格，只在锚点行后插入一行
out = text.replace(ANCHOR, ANCHOR + nl.decode() + LINE, 1)
open(DST, 'wb').write(out.encode('utf-8'))

a = text.splitlines(keepends=False)
b = out.splitlines(keepends=False)
d = list(difflib.unified_diff(a, b, fromfile='admin.html（原）', tofile='admin.html（方案A）',
                              lineterm='', n=2))
report = '\n'.join([
    '方案 A · admin.html 改动对照',
    '=' * 64,
    '改动类型：仅新增 1 行，无删除、无修改、无属性变更',
    '新增位置：<script src="admin.js"></script> 之后',
    '新增内容：<script src="y3/embed.js"></script>',
    '',
    '说明：样式、页签按钮、iframe 面板全部由 y3/embed.js 在运行时注入；',
    '      admin.js / admin.css / 任何存档 key 均未改动。',
    '',
    '完整差异：',
    *d,
    '',
    f'原始行数：{len(a)}    改动后行数：{len(b)}    净增：{len(b)-len(a)} 行',
])
open(DIFF, 'w', encoding='utf-8').write(report)
print(report)
print('\n已写出：', DST)
