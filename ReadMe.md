# 拼接子文档到主文档联动编辑

[![GitHub release (latest by date)](https://img.shields.io/github/v/release/yifengjob/siyuan-concat-subdocs)](https://github.com/yifengjob/siyuan-concat-subdocs/releases)
[![GitHub license](https://img.shields.io/github/license/yifengjob/siyuan-concat-subdocs)](LICENSE)

一个思源笔记插件，可以在主文档底部自动拼接其子文档的内容，并保持完美的渲染效果。支持实时编辑同步、悬停预览、一键清除所有拼接状态等功能。

## 功能特性

- 🔗 **一键切换拼接**：点击工具栏/状态栏图标，即可将当前文档的所有子文档按文件树顺序拼接到底部。
- 🎨 **完美渲染**：使用思源内核引擎渲染 Markdown，子文档内容与单独打开时完全一致。
- ✏️ **实时编辑同步**：在悬停浮窗或新标签页中编辑子文档后，拼接区域的内容会自动刷新。
- 🖱️ **悬停预览**：鼠标悬停在子文档右上角的铅笔图标上，会显示思源原生的块引用浮窗，可预览并打开子文档。
- 🧹 **一键重置**：在插件设置中可一键清除所有文档的拼接状态（将 `custom-concat` 属性重置为 `false`）。
- 💾 **状态记忆**：每个文档的拼接状态会被自动记忆，重新打开文档后自动恢复。

## 安装

### 手动安装
1. 在[思源笔记工作空间](https://github.com/siyuan-note/siyuan)的 `data/plugins/` 目录下创建文件夹 `concat-subdocs`。
2. 将本仓库中的以下所有文件放入该文件夹：
   - `index.js`
   - `index.css`
   - `plugin.json`
   - `icon.png`
   - `preview.png`
   - `README.md`
   - `README.en_US.md`
   - `LICENSE`
   - `i18n/`
      - `zh_CN.json`
      - `en_US.json`
3. 重启思源笔记，或在「设置 – 集市 – 已下载」中启用插件。

### 使用社区集市（待上架）
计划将插件提交至思源官方集市，未来可通过集市一键安装。

## 使用说明

### 切换拼接模式
- 点击顶部工具栏的 **子文档拼接图标**，即可切换当前文档的拼接状态。
- 开启后，所有子文档内容将按文件树顺序显示在主文档底部，每个子文档之间用虚线分隔。
- 再次点击图标可关闭拼接，恢复原始视图。

### 子文档操作
- **悬停预览**：鼠标悬停在子文档右上角的 **铅笔图标** 上，会弹出思源原生的块引用浮窗，显示该子文档的预览内容，并可通过浮窗内的「打开」按钮跳转。
- **编辑子文档**：
  - 点击铅笔图标，会在新标签页中打开该子文档，方便直接编辑。
  - 也可以在拼接区域直接编辑子文档。
  - 在浮窗中点击「打开」按钮同样会打开新标签页。
- **同步更新**：在子文档编辑器中修改内容并保存后，返回主文档，拼接区域的内容会自动刷新。

### 清除所有拼接状态
插件设置中提供了一键清除功能，可将所有文档的 `custom-concat` 属性重置为 `false`，并关闭当前已打开文档的拼接容器。
- 进入「设置 – 插件 – 拼接子文档内容到主文档」。
- 点击「立即清除」按钮，并确认操作。

## 配置

插件无复杂配置项，仅提供上述清除功能。所有拼接状态通过文档属性 `custom-concat` 存储，值为 `true` 或 `false`。

## 兼容性

- 思源笔记版本：**v3.5.8 及以上**（已测试 v3.5.8、v3.5.9）
- 支持 Windows / macOS / Linux 全平台

## 开发与贡献

欢迎提交 issue 或 PR。如需本地开发，请确保已安装 Node.js 并熟悉思源插件开发流程。

### 项目结构
```
concat-subdocs/
├── i18n/
|   ├── zh_CN.json    # 中文本地化文件
|   └── en_US.json    # 英文本地化文件
├── index.js          # 主插件代码
├── index.css         # 样式文件
├── icon.png          # 图标文件
├── plugin.json       # 插件配置
├── preview.png       # 界面预览
├── README.en_US.md   # 英文说明文档
└── README.md         # 默认说明档
```

## 许可证

[Apache-2.0](LICENSE)

## 致谢

- 感谢 [思源笔记](https://github.com/siyuan-note/siyuan) 提供的优秀平台。
- 感谢所有用户的反馈与支持。

---

如果您觉得这个插件有用，欢迎点个 ⭐！
