# -*- coding: utf-8 -*-
"""代码自绘：方案 A 接入后的后台效果图（复用 Y3 编辑器全貌图作为 iframe 内容）"""
from PIL import Image, ImageDraw, ImageFont, ImageEnhance

OUT = '/data/workspace/后台_方案A_新增Y3页签/方案A_后台效果示意图.png'
INNER = '/data/workspace/果实编辑器_通用后台/编辑器全貌示意图.png'
FONT = '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc'
f10 = ImageFont.truetype(FONT, 10); f11 = ImageFont.truetype(FONT, 11)
f12 = ImageFont.truetype(FONT, 12); f13 = ImageFont.truetype(FONT, 13)
f14 = ImageFont.truetype(FONT, 14); f15 = ImageFont.truetype(FONT, 15)
fb = ImageFont.truetype(FONT, 15); f17 = ImageFont.truetype(FONT, 17); f20 = ImageFont.truetype(FONT, 20)

W, H = 1680, 1000
SIDEBAR = 224
BG='#0b1017'; SB='#0e141e'; MAIN='#121823'; TOP='#151d29'
LINE='#26313f'; DIM='#7d8794'; TXT='#d4dbe4'
GOLD='#e8b248'; BLUE='#a9c6ef'; GREEN='#7ec874'; RED='#e06c6c'; MINT='#56cdba'

img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)

# ============ 侧栏 ============
d.rectangle((0, 0, SIDEBAR, H), fill=SB)
d.line((SIDEBAR, 0, SIDEBAR, H), fill=LINE, width=1)
# brand
d.rounded_rectangle((20, 20, 52, 52), radius=9, fill='#2b3547', outline='#3a4760')
d.ellipse((26, 26, 36, 36), fill=GOLD); d.ellipse((36, 36, 46, 46), fill='#6ba8e8')
d.text((62, 22), '选技弹珠', font=f17, fill=TXT)
d.text((62, 44), '内容管理后台', font=f11, fill=DIM)
d.line((0, 68, SIDEBAR, 68), fill=LINE)

def group(t, y):
    d.text((20, y), t, font=f10, fill='#5f6a78')

def nav(text, y, active=False, test=False, icon=''):
    if active:
        d.rounded_rectangle((10, y-4, SIDEBAR-10, y+28), radius=8, fill='#1d2b3d', outline='#4a6a92', width=1)
    d.rounded_rectangle((20, y+3, 34, y+17), radius=3, fill=('#6ba8e8' if active else '#4a5870'))
    d.text((44, y+1), text, font=f13, fill=(BLUE if active else '#9aa7bd'))
    if test:
        w = 46
        d.rounded_rectangle((SIDEBAR-62, y+2, SIDEBAR-16, y+20), radius=5, fill='#3a3120', outline='#6b542a')
        d.text((SIDEBAR-55, y+4), 'TEST', font=f10, fill=GOLD)

group('内容配置', 82)
items = [('总览', True), ('外观管理', False), ('状态图标', False), ('果实管理', False)]
y = 104
for t, a in items:
    nav(t, y, active=False, icon=''); y += 36
# 单独标出「果实管理」仍在（items 里索引 3）
d.rounded_rectangle((10, 104+3*36-4, SIDEBAR-10, 104+3*36+28), radius=6, outline='#2f6249', width=1)
d.text((SIDEBAR-58, 104+3*36+4), '保留', font=f10, fill=GREEN)

# 新增 Y3 页签（紧接果实管理）
y = 104 + 4*36
nav('果实编辑器 · Y3版', y, active=True, test=True)
y += 36
for t in ['数值平衡', '实时编排', '界面编辑器', '文案编辑']:
    nav(t, y); y += 36
group('场景与运营', y+6)
y += 30
for t in ['地图编辑器', '活动事件', '对局天气']:
    nav(t, y); y += 36
group('交付', y+6)
y += 30
nav('校验与发布', y)

d.line((10, H-64, SIDEBAR-10, H-64), fill=LINE)
d.ellipse((20, H-46, 27, H-39), fill=GREEN)
d.text((34, H-48), '本地服务已连接', font=f11, fill=DIM)
d.text((20, H-28), '配置 schema v1 · 本地优先', font=f10, fill='#5f6a78')

# ============ 顶栏 ============
d.rectangle((SIDEBAR, 0, W, 72), fill=TOP)
d.line((SIDEBAR, 71, W, 71), fill=LINE)
d.text((SIDEBAR+26, 14), '果实编辑器 · Y3版（测试）', font=f20, fill=TXT)
d.text((SIDEBAR+26, 44), '独立数据集 · 不写入正式配置 · 原「果实管理」保持不变', font=f11, fill=MINT)
bx = W - 470
for t in ['保存到本地', '发布到本地', '同步 GitHub']:
    w = 96 if t != '保存到本地' else 92
    d.rounded_rectangle((bx, 22, bx+w, 50), radius=7, fill='#1a2230', outline='#2a3444', width=1)
    d.text((bx+12, 29), t, font=f11, fill='#5f6a78')
    # 打叉表示禁用
    d.line((bx+w-20, 26, bx+w-10, 46), fill=RED, width=2)
    bx += w + 10
d.text((W-120, 28), '已禁用', font=f11, fill=RED)

# ============ 主区：警告条 ============
BY = 72
d.rectangle((SIDEBAR, BY, W, BY+46), fill='#20242b')
d.line((SIDEBAR, BY+45, W, BY+45), fill='#343a42')
d.rounded_rectangle((SIDEBAR+16, BY+11, SIDEBAR+118, BY+35), radius=10, fill='#3a3120', outline='#6b542a', width=1)
d.text((SIDEBAR+26, BY+15), 'Y3 版 · 测试中', font=f11, fill='#ffd479')
d.text((SIDEBAR+132, BY+16), '独立数据集 · 原「果实管理」完全保留 · 此页编辑不会写入 data/game-config.json',
       font=f11, fill='#9aa5b4')
d.text((W-620, BY+16), '已暂存 6 个果实（未写入正式配置）', font=f11, fill=GREEN)
for i, t in enumerate(['暂存到主后台', '下载暂存', '清空暂存', '← 返回原后台']):
    x = W - 440 + i*104
    col = MINT if i == 3 else TXT
    d.rounded_rectangle((x, BY+10, x+96, BY+36), radius=5, fill='#2b3038', outline='#3b434e', width=1)
    d.text((x+8, BY+16), t, font=f10, fill=col)

# ============ iframe 内容（复用全貌图） ============
FY = BY + 46
inner = Image.open(INNER).convert('RGB')
iw = W - SIDEBAR
ih = int(inner.height * iw / inner.width)
inner = inner.resize((iw, ih), Image.LANCZOS)
# 裁到可用高度
avail = H - FY - 4
if ih > avail:
    inner = inner.crop((0, 0, iw, avail))
img.paste(inner, (SIDEBAR, FY))
d.rectangle((SIDEBAR, FY, W-1, H-1), outline='#3b434e', width=2)
# iframe 边框角标
d.rounded_rectangle((SIDEBAR+10, FY+8, SIDEBAR+196, FY+30), radius=4, fill='#1d2b3d', outline='#4a6a92')
d.text((SIDEBAR+18, FY+12), 'iframe · y3/index.html', font=f10, fill=BLUE)

# ============ 右侧标注卡 ============
CX, CY = W - 372, FY + 46
d.rounded_rectangle((CX-8, CY-8, W-16, CY+256), radius=8, fill='#111820', outline='#3a4a5e', width=2)
d.text((CX+4, CY), '方案 A · 三条硬约束', font=f15, fill=GOLD)
lines = [
    ('①', 'admin.html 仅新增 1 行', 'admin.js / admin.css 零改动'),
    ('②', '新页签不带 data-tab', '不触发原 switchTab，12 个页签照常'),
    ('③', '数据完全隔离', 'y3.test.v1 / y3.staging.v1'),
]
y2 = CY + 32
for num, t, sub in lines:
    d.rounded_rectangle((CX+2, y2, CX+26, y2+24), radius=5, fill='#233040', outline='#3a4a5e')
    d.text((CX+9, y2+4), num, font=f12, fill=BLUE)
    d.text((CX+36, y2), t, font=f13, fill=TXT)
    d.text((CX+36, y2+20), sub, font=f11, fill=DIM)
    y2 += 46
d.line((CX+2, y2+2, W-30, y2+2), fill=LINE)
d.text((CX+4, y2+12), '顶部保存 / 发布按钮在测试态自动禁用', font=f11, fill=GREEN)
d.text((CX+4, y2+34), 'Ctrl+S 改为暂存，不写正式配置', font=f11, fill=GREEN)
d.text((CX+4, y2+56), '点任意原页签即完整还原', font=f11, fill=GREEN)

# 左下角改动对照小卡
LX, LY = SIDEBAR + 16, H - 132
d.rounded_rectangle((LX, LY, LX+438, LY+116), radius=7, fill='#0f151d', outline='#3a4a5e', width=2)
d.text((LX+12, LY+8), 'admin.html 全部改动', font=f13, fill=GOLD)
d.text((LX+12, LY+32), '  <script src="admin.js"></script>', font=f11, fill=DIM)
d.text((LX+12, LY+52), '+ <script src="y3/embed.js"></script>', font=f11, fill=GREEN)
d.text((LX+12, LY+76), '156 行 → 157 行 · 无删除 · 无修改 · 可一键回滚', font=f11, fill=TXT)

img.save(OUT)
print('已生成', OUT, img.size)
