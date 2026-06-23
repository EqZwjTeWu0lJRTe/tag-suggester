import { App, PluginSettingTab, Setting, Modal, TFile, Notice } from 'obsidian';
import { TagSuggestPlugin } from './main';

class SystemPromptFileModal extends Modal {
  constructor(
    app: App,
    private onSelect: (path: string) => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: '选择系统提示词笔记' });
    contentEl.createEl('p', {
      text: '点击选择一篇笔记作为 AI 的规则指令：',
      cls: 'tag-suggest-description',
    });

    const searchInput = contentEl.createEl('input', {
      type: 'text',
      placeholder: '搜索笔记...',
      cls: 'tag-suggest-file-search',
    });

    const list = contentEl.createDiv({ cls: 'tag-suggest-file-list' });
    let allFiles = this.app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path));

    const renderList = (filter: string) => {
      list.empty();
      const filtered = filter
        ? allFiles.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()))
        : allFiles;

      filtered.forEach((file) => {
        const item = list.createDiv({ cls: 'tag-suggest-file-item' });
        const nameSpan = item.createSpan({ cls: 'tag-suggest-file-name' });
        nameSpan.setText(file.name);
        const pathSpan = item.createSpan({ cls: 'tag-suggest-file-path' });
        pathSpan.setText(file.path);

        item.addEventListener('click', () => {
          this.onSelect(file.path);
          this.close();
        });
      });

      if (filtered.length === 0) {
        list.createEl('p', { text: '未找到匹配的笔记', cls: 'tag-suggest-description' });
      }
    };

    searchInput.addEventListener('input', () => renderList(searchInput.value));
    renderList('');
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class TagSuggestSettingTab extends PluginSettingTab {
  private plugin: TagSuggestPlugin;

  constructor(app: App, plugin: TagSuggestPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: '标签推荐设置' });

    new Setting(containerEl)
      .setName('AI 模型')
      .setDesc('选择要使用的 AI 模型')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('chatgpt', 'ChatGPT')
          .addOption('ollama', 'Ollama')
          .addOption('deepseek', 'DeepSeek')
          .setValue(this.plugin.settings.aiModel)
          .onChange(async (value) => {
            this.plugin.settings.aiModel = value as 'chatgpt' | 'ollama' | 'deepseek';
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (this.plugin.settings.aiModel === 'chatgpt') {
      new Setting(containerEl)
        .setName('API 密钥')
        .setDesc('设置 OpenAI API 密钥')
        .addText((text) =>
          text
            .setPlaceholder('输入您的 API 密钥')
            .setValue(this.plugin.settings.apiKey)
            .onChange(async (value) => {
              this.plugin.settings.apiKey = value;
              await this.plugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName('API 基础 URL')
        .setDesc('设置 API 基础 URL（默认: https://api.gpt.ge/v1）')
        .addText((text) =>
          text
            .setPlaceholder('https://api.gpt.ge/v1')
            .setValue(this.plugin.settings.apiBase)
            .onChange(async (value) => {
              this.plugin.settings.apiBase = value;
              await this.plugin.saveSettings();
            }),
        );
    }

    if (this.plugin.settings.aiModel === 'ollama') {
      new Setting(containerEl)
        .setName('Ollama 主机地址')
        .setDesc('设置 Ollama API 的主机地址(默认: http://localhost:11434)')
        .addText((text) =>
          text
            .setPlaceholder('http://localhost:11434')
            .setValue(this.plugin.settings.ollamaHost)
            .onChange(async (value) => {
              this.plugin.settings.ollamaHost = value;
              await this.plugin.saveSettings();
            }),
        );

      const ollamaModelSetting = new Setting(containerEl)
        .setName('Ollama 模型')
        .setDesc('设置要使用的 Ollama 模型名称');

      try {
        const response = await fetch(`${this.plugin.settings.ollamaHost}/api/tags`);
        if (response.ok) {
          const data = await response.json();
          const models = data.models || [];
          ollamaModelSetting.addDropdown((dropdown) => {
            dropdown
              .addOption('llama2', 'Llama 2')
              .addOption('qwen', 'Qwen')
              .addOption('mistral', 'Mistral')
              .addOption('gemma', 'Gemma');

            models.forEach((model: { name: string }) => {
              if (model.name) {
                dropdown.addOption(model.name, model.name);
              }
            });

            dropdown
              .setValue(this.plugin.settings.ollamaModel)
              .onChange(async (value) => {
                this.plugin.settings.ollamaModel = value;
                await this.plugin.saveSettings();
              });
          });
        } else {
          ollamaModelSetting.addText((text) =>
            text
              .setPlaceholder('输入模型名称')
              .setValue(this.plugin.settings.ollamaModel)
              .onChange(async (value) => {
                this.plugin.settings.ollamaModel = value;
                await this.plugin.saveSettings();
              }),
          );
        }
      } catch {
        ollamaModelSetting.addText((text) =>
          text
            .setPlaceholder('输入模型名称')
            .setValue(this.plugin.settings.ollamaModel)
            .onChange(async (value) => {
              this.plugin.settings.ollamaModel = value;
              await this.plugin.saveSettings();
            }),
        );
      }
    }

    if (this.plugin.settings.aiModel === 'deepseek') {
      new Setting(containerEl)
        .setName('DeepSeek API Key')
        .setDesc('设置 DeepSeek API Key')
        .addText((text) =>
          text
            .setPlaceholder('输入您的 DeepSeek API Key')
            .setValue(this.plugin.settings.deepseekApiKey)
            .onChange(async (value) => {
              this.plugin.settings.deepseekApiKey = value;
              await this.plugin.saveSettings();
            }),
        );
    }

    new Setting(containerEl)
      .setName('标签提示词笔记')
      .setDesc('选择一篇笔记作为标签推荐的 AI 规则指令（留空则使用默认提示词）')
      .addText((text) =>
        text
          .setPlaceholder('未设置（使用默认提示词）')
          .setValue(this.plugin.settings.systemPromptNotePath)
          .onChange(async (value) => {
            this.plugin.settings.systemPromptNotePath = value;
            await this.plugin.saveSettings();
          }),
      )
      .addButton((btn) =>
        btn
          .setButtonText('选择笔记')
          .onClick(() => {
            new SystemPromptFileModal(this.app, async (path) => {
              this.plugin.settings.systemPromptNotePath = path;
              await this.plugin.saveSettings();
              this.display();
            }).open();
          }),
      );

    new Setting(containerEl)
      .setName('标题提示词笔记')
      .setDesc('选择一篇笔记作为标题生成的 AI 规则指令（留空则使用默认提示词）')
      .addText((text) =>
        text
          .setPlaceholder('未设置（使用默认提示词）')
          .setValue(this.plugin.settings.systemPromptTitleNotePath)
          .onChange(async (value) => {
            this.plugin.settings.systemPromptTitleNotePath = value;
            await this.plugin.saveSettings();
          }),
      )
      .addButton((btn) =>
        btn
          .setButtonText('选择笔记')
          .onClick(() => {
            new SystemPromptFileModal(this.app, async (path) => {
              this.plugin.settings.systemPromptTitleNotePath = path;
              await this.plugin.saveSettings();
              this.display();
            }).open();
          }),
      );

    new Setting(containerEl)
      .setName('推荐标签数量')
      .setDesc('设置每次推荐的标签数量（1-10）')
      .addSlider((slider) =>
        slider
          .setLimits(1, 10, 1)
          .setValue(this.plugin.settings.tagCount)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.tagCount = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
