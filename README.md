# Tag Suggester

使用 AI 为 Obsidian 文档推荐标签的插件。支持 ChatGPT、Ollama、DeepSeek 三种 AI 模型。

## 功能

- 为当前文档生成标签建议
- 右键文件夹批量处理所有 Markdown 文件
- 支持 GPT / Ollama / DeepSeek 三种后端
- 可选的系统提示词笔记 — 选择 vault 内任意笔记作为 AI 规则指令
- 可替换不满意的标签，重新生成

## 安装

1. 下载 `main.js`、`manifest.json`、`styles.css` 放入 `<vault>/.obsidian/plugins/obsidian-tag-suggest/`
2. 打开 Obsidian 设置 → 第三方插件 → 启用 Tag Suggester

## 配置

| 设置项 | 说明 |
|--------|------|
| AI 模型 | 选择 ChatGPT / Ollama / DeepSeek |
| API 密钥 | 对应模型的 API Key |
| 系统提示词笔记 | 选择一篇笔记内容作为 AI 规则指令，留空使用默认提示词 |
| 推荐标签数量 | 每次生成的标签数量 (1-10) |

## 使用

- 点击左侧图标按钮为当前文档生成标签
- 在文件管理器右键 Markdown 文件 → AI 生成标签
- 在文件夹上右键 → 为所有文件生成标签
