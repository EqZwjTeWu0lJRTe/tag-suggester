# Tag Suggester

使用 AI 为 Obsidian 文档推荐标签和生成标题的插件。支持 ChatGPT、Ollama、DeepSeek。

## 功能

- 为当前文档生成标签建议
- 右键文件夹批量处理所有 Markdown 文件
- 根据文档内容自动生成文件名
- 支持 GPT / Ollama / DeepSeek 三种后端
- 标签和标题可分别设置专属提示词笔记
- 可替换不满意的标签，重新生成

## 安装

1. 下载 `main.js`、`manifest.json`、`styles.css` 放入 `<vault>/.obsidian/plugins/obsidian-tag-suggest/`
2. 打开 Obsidian 设置 → 第三方插件 → 启用 Tag Suggester

## 配置

| 设置项 | 说明 |
|--------|------|
| AI 模型 | 选择 ChatGPT / Ollama / DeepSeek |
| API 密钥 | 对应模型的 API Key |
| 标签提示词笔记 | 标签推荐的 AI 规则指令，留空使用默认提示词 |
| 标题提示词笔记 | 标题生成的 AI 规则指令，留空使用默认提示词 |
| 推荐标签数量 | 每次生成的标签数量 (1-10) |

## 使用

- 点击左侧标签图标 → 为当前文档推荐标签
- 点击左侧铅笔图标 → 为当前文档生成标题
- 在文件管理器右键 Markdown 文件 → AI 生成标签 / AI 重命名
- 在文件夹上右键 → 为所有文件生成标签
