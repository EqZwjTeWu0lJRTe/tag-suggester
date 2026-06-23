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
