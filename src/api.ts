import { TagSuggestPlugin } from './main';

const MAX_CONTENT_LENGTH = 1500;

async function resolveSystemPrompt(plugin: TagSuggestPlugin): Promise<string> {
  const noteContent = await plugin.getSystemPromptContent();
  if (noteContent) return noteContent;
  return `你是一个文档标签推荐专家。请为文档内容推荐 ${plugin.settings.tagCount} 个最合适的标签。`;
}

async function resolveSystemPromptForTitle(plugin: TagSuggestPlugin): Promise<string> {
  const noteContent = await plugin.getSystemPromptTitleContent();
  if (noteContent) return noteContent;
  return `你是一个文档标题命名专家。请根据文档内容生成一个简洁准确的标题。`;
}

export async function suggestTagsWithChatGPT(
  plugin: TagSuggestPlugin,
  content: string,
): Promise<string[]> {
  const systemPrompt = await resolveSystemPrompt(plugin);
  const response = await plugin.openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: `请为以下文档内容推荐标签。只返回标签列表，用逗号分隔，不要包含其他解释。

${content.slice(0, MAX_CONTENT_LENGTH)}`,
      },
    ],
  });

  const result = response.choices[0]?.message?.content || '';
  return result
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, plugin.settings.tagCount);
}

export async function suggestTagsWithOllama(
  plugin: TagSuggestPlugin,
  content: string,
): Promise<string[]> {
  const systemPrompt = await resolveSystemPrompt(plugin);
  const response = await fetch(`${plugin.settings.ollamaHost}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: plugin.settings.ollamaModel,
      prompt: `${systemPrompt}

请为以下内容生成 ${plugin.settings.tagCount} 个标签,只返回标签名称,用逗号分隔:

${content.slice(0, MAX_CONTENT_LENGTH)}`,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama API 请求失败: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  if (!data.response) throw new Error('API 返回数据格式不正确');

  return data.response
    .split(',')
    .map((tag: string) => tag.trim())
    .filter((tag: string) => tag.length > 0);
}

export async function suggestTagsWithDeepseek(
  plugin: TagSuggestPlugin,
  content: string,
): Promise<string[]> {
  const systemPrompt = await resolveSystemPrompt(plugin);
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${plugin.settings.deepseekApiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: `请为以下文档内容推荐标签。只返回标签列表，用逗号分隔，不要包含其他解释。\n\n${content.slice(0, MAX_CONTENT_LENGTH)}`,
        },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek API 请求失败: ${response.status}`);
  }

  const data = await response.json();
  const result = data.choices[0]?.message?.content || '';
  return result
    .split(',')
    .map((tag: string) => tag.trim())
    .filter(Boolean)
    .slice(0, plugin.settings.tagCount);
}

export async function suggestTitle(plugin: TagSuggestPlugin, content: string): Promise<string> {
  const systemPrompt = await resolveSystemPromptForTitle(plugin);
  const maxLen = MAX_CONTENT_LENGTH;

  switch (plugin.settings.aiModel) {
    case 'ollama': {
      if (!plugin.settings.ollamaHost) throw new Error('请先设置 Ollama 主机地址');
      const response = await fetch(`${plugin.settings.ollamaHost}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: plugin.settings.ollamaModel,
          prompt: `${systemPrompt}\n\n根据以下文档内容生成一个简洁的标题（不要引号，不要多余文字，仅标题本身）：\n\n${content.slice(0, maxLen)}`,
          stream: false,
        }),
      });
      if (!response.ok) throw new Error(`Ollama 请求失败: ${response.status}`);
      const data = await response.json();
      return (data.response || '').replace(/["「」『』]/g, '').trim();
    }
    case 'deepseek': {
      if (!plugin.settings.deepseekApiKey) throw new Error('请先设置 DeepSeek API Key');
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${plugin.settings.deepseekApiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `根据以下文档内容生成一个简洁的标题（不要引号，不要多余文字，仅标题本身）：\n\n${content.slice(0, maxLen)}` },
          ],
          stream: false,
        }),
      });
      if (!res.ok) throw new Error(`DeepSeek 请求失败: ${res.status}`);
      const d = await res.json();
      return (d.choices[0]?.message?.content || '').replace(/["「」『』]/g, '').trim();
    }
    default: {
      if (!plugin.settings.apiKey) throw new Error('请先设置 ChatGPT API Key');
      const response = await plugin.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `根据以下文档内容生成一个简洁的标题（不要引号，不要多余文字，仅标题本身）：\n\n${content.slice(0, maxLen)}` },
        ],
      });
      return (response.choices[0]?.message?.content || '').replace(/["「」『』]/g, '').trim();
    }
  }
}

export interface CleanupOp {
  type: 'merge' | 'delete';
  from?: string;
  to?: string;
  tag?: string;
}

export async function suggestTagCleanup(
  plugin: TagSuggestPlugin,
  tagsWithCount: [string, number][],
  principles: string,
): Promise<CleanupOp[]> {
  const tagListStr = tagsWithCount.map(([t, c]) => `"${t}" (${c}次)`).join('\n');
  const systemPrompt = `你是一个标签管理专家。请根据用户的原则和标签使用情况，决定哪些标签需要合并或删除。
判断"无意义标签"的标准：
- 乱码、测试字符、无实际含义的拼音组合
- 只出现1次且不是规范词
- 明显是键盘乱敲的内容
只返回 JSON 数组，不要包含其他文字。JSON 格式：
[
  {"type":"merge","from":"旧标签","to":"目标标签"},
  {"type":"delete","tag":"要删除的标签"}
]`;

  const userContent = `原则：
${principles || '无特殊原则，自行判断'}

当前库所有标签及使用次数：
${tagListStr}

请分析并返回 JSON 操作数组。`;

  switch (plugin.settings.aiModel) {
    case 'ollama': {
      if (!plugin.settings.ollamaHost) throw new Error('请先设置 Ollama 主机地址');
      const res = await fetch(`${plugin.settings.ollamaHost}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: plugin.settings.ollamaModel, prompt: `${systemPrompt}\n\n${userContent}`, stream: false }),
      });
      if (!res.ok) throw new Error(`Ollama 请求失败: ${res.status}`);
      const d = await res.json();
      return parseCleanupResponse(d.response || '[]');
    }
    case 'deepseek': {
      if (!plugin.settings.deepseekApiKey) throw new Error('请先设置 DeepSeek API Key');
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${plugin.settings.deepseekApiKey}` },
        body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }], stream: false }),
      });
      if (!res.ok) throw new Error(`DeepSeek 请求失败: ${res.status}`);
      const d = await res.json();
      return parseCleanupResponse(d.choices[0]?.message?.content || '[]');
    }
    default: {
      if (!plugin.settings.apiKey) throw new Error('请先设置 ChatGPT API Key');
      const res = await plugin.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      });
      return parseCleanupResponse(res.choices[0]?.message?.content || '[]');
    }
  }
}

function parseCleanupResponse(text: string): CleanupOp[] {
  const jsonMatch = text.match(/\[[\s\S]*?\]/);
  if (!jsonMatch) return [];
  try {
    const ops: CleanupOp[] = JSON.parse(jsonMatch[0]);
    return ops.filter((o) => o.type === 'merge' || o.type === 'delete');
  } catch {
    return [];
  }
}

export async function suggestTags(plugin: TagSuggestPlugin, content: string): Promise<string[]> {
  switch (plugin.settings.aiModel) {
    case 'ollama':
      if (!plugin.settings.ollamaHost) {
        throw new Error('请先设置 Ollama 主机地址');
      }
      return await suggestTagsWithOllama(plugin, content);

    case 'deepseek':
      if (!plugin.settings.deepseekApiKey) {
        throw new Error('请先设置 DeepSeek API Key');
      }
      return await suggestTagsWithDeepseek(plugin, content);

    default:
      if (!plugin.settings.apiKey) {
        throw new Error('请先设置 ChatGPT API Key');
      }
      return await suggestTagsWithChatGPT(plugin, content);
  }
}
