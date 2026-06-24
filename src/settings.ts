export interface TagSuggestSettings {
  apiKey: string;
  apiBase: string;
  tagCount: number;
  ollamaHost: string;
  ollamaModel: string;
  aiModel: 'chatgpt' | 'ollama' | 'deepseek';
  deepseekApiKey: string;
  systemPromptNotePath: string;
  systemPromptTitleNotePath: string;
  tagManagePrinciples: string;
}

export const DEFAULT_SETTINGS: TagSuggestSettings = {
  apiKey: '',
  apiBase: 'https://api.gpt.ge/v1',
  tagCount: 3,
  ollamaHost: 'http://localhost:11434',
  ollamaModel: 'llama2',
  aiModel: 'chatgpt',
  deepseekApiKey: '',
  systemPromptNotePath: '',
  systemPromptTitleNotePath: '',
  tagManagePrinciples: '',
};
