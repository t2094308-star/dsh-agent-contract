#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dsh-agent-contract 当前架构拓扑图（自动渲染 v2）
用法: python3 architecture.py [输出路径.png]
左面板=分层结构；右面板=数据流（写入/读取/审计/面板）+ 检查项 + 里程碑条。
几何约定：每个 band 的标题占顶部 ~2.2 单位，内容框一律从 band_top-3.4 起，避免压字。
"""
import os
import sys
from matplotlib import pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from matplotlib.font_manager import FontProperties

CANDIDATES = [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc',
    '/mnt/c/Windows/Fonts/msyh.ttc',
    '/mnt/c/Windows/Fonts/simhei.ttf',
]
FONT = next((f for f in CANDIDATES if os.path.exists(f)), None)
if not FONT:
    sys.exit('未找到可用 CJK 字体')
FP = lambda size, weight='normal': FontProperties(fname=FONT, size=size, weight=weight)
print('使用字体:', FONT)


def box(ax, x, y, w, h, text, fc, ec='#334155', fs=7.6, weight='normal', tc='#0f172a'):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle='round,pad=0.5,rounding_size=1.1',
                                linewidth=0.9, edgecolor=ec, facecolor=fc, zorder=2))
    ax.text(x + w / 2, y + h / 2, text, ha='center', va='center',
            fontproperties=FP(fs, weight), color=tc, zorder=3, linespacing=1.45)


def arrow(ax, xy1, xy2, color='#475569', lw=0.9, ls='-', rad=0.0, ms=9):
    ax.add_patch(FancyArrowPatch(xy1, xy2, arrowstyle='-|>', mutation_scale=ms, linewidth=lw,
                                 color=color, linestyle=ls, zorder=1,
                                 connectionstyle=f'arc3,rad={rad}'))


def label(ax, x, y, text, fs=7, color='#475569', weight='normal', ha='center'):
    ax.text(x, y, text, ha=ha, va='center', fontproperties=FP(fs, weight), color=color, zorder=5)


def band(ax, y, h, title, fc):
    ax.add_patch(FancyBboxPatch((1, y), 98, h, boxstyle='round,pad=0.4,rounding_size=1.5',
                                linewidth=0.8, edgecolor='#cbd5e1', facecolor=fc, zorder=0))
    label(ax, 3.2, y + h - 1.5, title, fs=8, color='#334155', weight='bold', ha='left')


C = {'agent': '#dbeafe', 'plugin': '#dcfce7', 'svc': '#fef9c3', 'store': '#f1f5f9',
     'truth': '#ffe4e6', 'law': '#ede9fe', 'flow': '#e0f2fe', 'done': '#bbf7d0', 'todo': '#e5e7eb'}

fig = plt.figure(figsize=(21, 12), dpi=150, facecolor='white')
gs = fig.add_gridspec(1, 2, width_ratios=[1.3, 1], wspace=0.055,
                      left=0.012, right=0.988, top=0.918, bottom=0.035)
fig.suptitle('dsh-agent-contract · 多智能体契约工作流 —— 当前架构拓扑（2026-10-02）',
             fontproperties=FP(15.5, 'bold'), color='#0f172a', y=0.972)
fig.text(0.5, 0.932, '真相在磁盘 · 台账为可重建索引 · 元数据自动派生优先 · 检索指路不搬运 · 审计只警告不拦截',
         ha='center', fontproperties=FP(9.5), color='#64748b')

# ==================== 左：分层结构 ====================
axL = fig.add_subplot(gs[0, 0]); axL.set_xlim(0, 100); axL.set_ylim(0, 100); axL.axis('off')
label(axL, 50, 97.6, 'A. 分层结构（执行者 → 插件 → 宿主服务 → 宿主存储 → 项目真相）',
      fs=10.5, weight='bold', color='#1e293b')

band(axL, 84.5, 12, '① 执行者（模型侧）', '#f8fafc')
for i, (t, v) in enumerate([('主代理 lead', '唯一可写共享文件'), ('子智能体·前台', 'one-shot 跑完释放'),
                            ('子智能体·后台', 'continuable 可续派'), ('审查 / 对抗审查', '异源模型 · 只读'),
                            ('图书管理员', '便宜档 · 不派单')]):
    box(axL, 2.5 + i * 19.2, 86.0, 18, 7.6, f'{t}\n{v}', C['agent'], fs=6.6)

band(axL, 61.0, 22, '② 插件本体 dsh-agent-contract（ESM 直写 / 无构建 / peer=*）', '#f7fee7')
mods = [('contract/', '契约装配\nmandate·roles\nslices·assemble'),
        ('delegation/', '委派通道\ncontract_delegate_<角色>'),
        ('tools', '产出契约\ndoc_emit·progress_upsert\nbugfix_note·contract_status'),
        ('ledger/', '台账+派生器\ndomains·store\nrebuild·derive·naming'),
        ('search/', '检索 L0\ndoc_search'),
        ('audit/', '审计(警告制)\nchecks·report'),
        ('librarian/', '馆员\nduties·fixer·ask'),
        ('client/', '面板 tab\nregisterTab')]
for i, (t, v) in enumerate(mods):
    box(axL, 2.5 + (i % 4) * 24.4, 61.8 + (1 - i // 4) * 8.8, 22.4, 8.0, f'{t}\n{v}', C['plugin'], fs=6.4)

band(axL, 46.5, 12.5, '③ 宿主服务（dsh 原生，白捡）', '#fefce8')
for i, (t, v) in enumerate([('ctx.subagents', 'start / startContinuable\nsendMessage / interrupt · list'),
                            ('ctx.storageDomain', 'schema 校验 KV\n+ domain/changed'),
                            ('session-query', '全文检索 · 关系追踪\nZIP 导出'),
                            ('ctx.betterSidebar', 'registerTab\nregisterFileViewer'),
                            ('ctx.tools', 'defineTool\n工具注册')]):
    box(axL, 2.5 + i * 19.2, 48.0, 18, 7.6, f'{t}\n{v}', C['svc'], fs=6.3)

band(axL, 30.5, 14.5, '④ 宿主存储 ~/.dsh/（按 profile 隔离）', '#f8fafc')
for i, (t, v) in enumerate([('.credentials.yaml', 'API key\n（不进插件配置）'),
                            ('sessions/<工作区>/', '会话日志 + 血缘\nparentSession'),
                            ('storages/<领域>/', 'json 后端\nagent_contract_*'),
                            ('profiles/desktop/', 'bundles · cordis.patch\n.yml · node_modules'),
                            ('_backups / attachments\ncache / llm-deepseek', '快照回滚 · 附件\n· 缓存')]):
    box(axL, 2.5 + i * 19.2, 32.0, 18, 8.0, f'{t}\n{v}', C['store'], fs=6.2)

band(axL, 14.5, 14, '⑤ 项目真相（磁盘 = 唯一真相源）', '#fff1f2')
for i, (t, v) in enumerate([('任务/', '任务登记 T*.md'), ('[Agent进度]/', '进度档 ≤400 字'),
                            ('仓库/docs/子agent/', '[位置] 三档产出\nfront-matter + 固定小节'),
                            ('仓库/docs/坑/', '坑库 / 研究档\n（检索源）')]):
    box(axL, 2.5 + i * 24.4, 16.2, 22.4, 8.0, f'{t}\n{v}', C['truth'], fs=6.6)

band(axL, 1.5, 11.5, '⑥ 铁律（架构层约定）', '#f5f3ff')
for i, t in enumerate(['真相在磁盘\n台账可重建', '元数据自动派生优先\nneeds_librarian 才叫馆员',
                       '检索指路不搬运\nL0→L5 成本递增', '警告制不拦截\n（审计只出红黄绿）',
                       '相邻寻址\n仅直接层级通信']):
    box(axL, 2.5 + i * 19.2, 3.0, 18, 7.2, t, C['law'], fs=6.3)

for x in (18, 50, 82):
    for y1, y2 in [(85.8, 83.4), (60.9, 59.2), (46.4, 45.2), (30.4, 28.7)]:
        arrow(axL, (x, y1), (x, y2), color='#94a3b8', ls=(0, (3, 2)), lw=0.8)

# ==================== 右：数据流 ====================
axR = fig.add_subplot(gs[0, 1]); axR.set_xlim(0, 100); axR.set_ylim(0, 100); axR.axis('off')
label(axR, 50, 97.6, 'B. 数据流（写入 / 读取 / 审计 / 面板）', fs=10.5, weight='bold', color='#1e293b')

# 写入链
band(axR, 72.0, 24, '写入链（内容 → 磁盘真相 → 索引）', '#f0f9ff')
box(axR, 3, 86.6, 20, 6.4, '主代理派单', C['flow'], fs=7.2)
box(axR, 27, 86.6, 22, 6.4, 'contract_delegate_*\n现场装配注入', C['plugin'], fs=6.6)
box(axR, 53, 86.6, 20, 6.4, '子智能体执行', C['agent'], fs=7.2)
box(axR, 77, 86.6, 20, 6.4, 'doc_emit\nprogress_upsert', C['plugin'], fs=6.6)
box(axR, 77, 76.6, 20, 6.4, '磁盘真相\n（项目 5 目录）', C['truth'], fs=6.9)
box(axR, 53, 76.6, 20, 6.4, '派生器\n零模型调用', C['plugin'], fs=6.9)
box(axR, 27, 76.6, 22, 6.4, '台账三领域\nmembers / tasks / docs', C['store'], fs=6.6)
box(axR, 3, 76.6, 20, 6.4, 'needs_librarian[]\n→ 唤醒馆员', C['law'], fs=6.5)
for a, b in [((23, 89.8), (27, 89.8)), ((49, 89.8), (53, 89.8)), ((73, 89.8), (77, 89.8)),
             ((87, 86.5), (87, 83.2)), ((77, 79.8), (73, 79.8)), ((53, 79.8), (49, 79.8)),
             ((27, 79.8), (23, 79.8))]:
    arrow(axR, a, b, color='#0369a1')
label(axR, 64, 84.6, '只此一条：内容工具落盘（工具返回绝对路径）', fs=6.5, color='#0369a1')
label(axR, 40, 84.6, '失败才升级', fs=6.4, color='#7c3aed')

# 读取链
band(axR, 50.0, 19.5, '读取链（检索阶梯：指路 → 精读）', '#f0fdf4')
ladder = [('L0 doc_search', '台账过滤\n候选+摘要+建议'), ('L1 glob', '文件名规范\n<任务号>_*_L3.md'),
          ('L2 grep', '全文正则\n文件+行号'), ('L3 read', '按 readHints\n只读指定小节'),
          ('L4 session-query', '跨会话检索\n溯源'), ('L5 FTS / 向量', '到量再加\n签名不变')]
for i, (t, v) in enumerate(ladder):
    fc = C['plugin'] if i == 0 else (C['svc'] if i < 5 else C['todo'])
    box(axR, 2.5 + i * 16.3, 52.5, 14.6, 7.2, f'{t}\n{v}', fc, fs=6.0)
for i in range(5):
    arrow(axR, (17.2 + i * 16.3, 56.1), (18.9 + i * 16.3, 56.1), color='#15803d')
label(axR, 50, 64.6, '注入只给 路径 + 摘要 + readHints；正文由子智能体按需精读（不搬运）',
      fs=6.8, color='#15803d')

# 审计链
band(axR, 29.5, 18, '审计链（警告制）+ 面板', '#fef2f2')
box(axR, 3, 38.0, 22, 6.6, 'audit_scan\n台账 ↔ 磁盘对账', C['plugin'], fs=6.7)
box(axR, 29, 38.0, 24, 6.6, '红黄绿 + 人话报告\n（馆员整理）', C['law'], fs=6.7)
box(axR, 57, 38.0, 18, 6.6, '面板 tab\n订阅 domain.changed', C['plugin'], fs=6.4)
box(axR, 79, 38.0, 18, 6.6, '谱系树 + 徽章\n点击跳会话', C['flow'], fs=6.4)
for a, b in [((25, 41.3), (29, 41.3)), ((53, 41.3), (57, 41.3)), ((75, 41.3), (79, 41.3))]:
    arrow(axR, a, b, color='#b91c1c')
arrow(axR, (14, 44.7), (14, 52.4), color='#b91c1c', ls=(0, (3, 2)))
label(axR, 14, 48.6, '只读对账', fs=6.2, color='#b91c1c')

# 检查项
band(axR, 16.0, 12.5, '审计检查项（8 + 3）', '#f8fafc')
checks = ['missing_doc', 'over_budget', 'unfilled_slot', 'stale_progress', 'cross_vendor', 'ghost_run',
          'orphan_task', 'unreleased_run', 'doc_meta_missing', 'doc_tags_stale', 'archive_suggest']
for i, t in enumerate(checks):
    box(axR, 2.5 + (i % 6) * 16.3, 20.8 - (i // 6) * 3.6, 14.6, 3.2, t, C['store'], fs=5.7)

# 里程碑
band(axR, 1.5, 13.0, '里程碑', '#f8fafc')
ms = [('M0 ✓', '骨架+配置', True), ('M1 ✓', '契约装配+委派', True), ('M2 ✓', '三工具+台账+rebuild', True),
      ('M2.5', 'doc_search+阶梯', False), ('M3', '面板 tab', False), ('M4', '审计+馆员', False), ('M5', '端到端', False)]
w = 96 / len(ms)
for i, (t, v, done) in enumerate(ms):
    box(axR, 2.0 + i * w, 7.4, w - 1.2, 4.4, f'{t}  {v}', C['done'] if done else C['todo'], fs=5.9)
label(axR, 50, 4.2, '当前：M2 已完成（verify.sh 25 项）→ 下一步 M2.5；馆员唤醒由 needs_librarian 闸门控制',
      fs=6.8, color='#475569')

out = sys.argv[1] if len(sys.argv) > 1 else 'architecture.png'
fig.savefig(out, dpi=150, facecolor='white', bbox_inches='tight')
print('已渲染:', out)
