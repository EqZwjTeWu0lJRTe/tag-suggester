import { Plugin, TFile, TFolder, Notice, addIcon } from 'obsidian';
import OpenAI from 'openai';
import { TagSuggestSettings, DEFAULT_SETTINGS } from './settings';
import { TagSuggestModal } from './suggest-modal';
import { BatchSuggestModal } from './batch-modal';
import { TagSuggestSettingTab } from './settings-tab';
import { RenameModal } from './rename-modal';
import { suggestTags, suggestTitle, suggestTagCleanup, CleanupOp } from './api';

const TAG_ICON = `<svg viewBox="0 0 1024 1024" width="100" height="100" xmlns="http://www.w3.org/2000/svg">
  <path fill="currentColor" d="M426.08 649.232l56.576 56.56L690.544 497.92l-56.56-56.56L426.08 649.232z m100.64-315.136L318.832 541.984l56.56 56.56 207.888-207.888-56.56-56.56zM957.424 58.912L502.4 31.952 25.616 508.384l488.56 488.512 477.008-476.64-33.76-461.344zM514.192 883.792L138.784 508.4 533.552 113.936 882.72 134.64l25.984 354.912-394.528 394.24z m162.896-638.752a72 72 0 1 0 101.84 101.824 72 72 0 1 0-101.84-101.824z"/>
</svg>`;

export class TagSuggestPlugin extends Plugin {
  settings!: TagSuggestSettings;
  openai!: OpenAI;

  async onload() {
    await this.loadSettings();
    this.initializeOpenAI();

    addIcon('suggest-tags', TAG_ICON);

    this.addRibbonIcon('suggest-tags', '为当前文档推荐标签', () => {
      this.suggestTags();
    });

    this.addRibbonIcon('pencil', '为当前文档生成标题', () => {
      this.suggestTitle();
    });

    this.addRibbonIcon('sparkles', 'AI 整理标签', () => {
      this.autoManageTags();
    });

    this.addSettingTab(new TagSuggestSettingTab(this.app, this));

    this.addCommand({
      id: 'suggest-tags',
      name: '为当前文档推荐标签',
      callback: () => this.suggestTags(),
    });

    this.addCommand({
      id: 'suggest-title',
      name: '为当前文档生成标题',
      callback: () => this.suggestTitle(),
    });

    this.addCommand({
      id: 'auto-manage-tags',
      name: 'AI 整理标签',
      callback: () => this.autoManageTags(),
    });

    this.addCommand({
      id: 'test-api',
      name: '测试 API 连接',
      callback: () => this.testAPIConnection(),
    });

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile && file.extension === 'md') {
          menu.addItem((item) => {
            item
              .setTitle('AI 生成标签')
              .setIcon('suggest-tags')
              .onClick(() => this.suggestTags(file));
          });
          menu.addItem((item) => {
            item
              .setTitle('AI 重命名')
              .setIcon('suggest-tags')
              .onClick(() => this.suggestTitle(file));
          });
        } else if (file instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle('为所有文件生成标签')
              .setIcon('suggest-tags')
              .onClick(() => {
                new BatchSuggestModal(this.app, file, this).open();
              });
          });
        }
      }),
    );

    const styleEl = document.head.createEl('style', {
      text: `
        .tag-suggest-description { margin-bottom: 1em; color: var(--text-muted); }
        .tag-suggest-container { margin-bottom: 1.5em; max-height: 200px; overflow-y: auto; padding: 0.5em; border: 1px solid var(--background-modifier-border); border-radius: 4px; }
        .tag-suggest-item { display: flex; align-items: center; padding: 0.5em; margin-bottom: 0.5em; background: var(--background-secondary); border-radius: 4px; }
        .tag-suggest-item:last-child { margin-bottom: 0; }
        .tag-suggest-checkbox { margin-right: 0.8em; }
        .tag-suggest-text { font-size: 1.1em; }
        .tag-suggest-buttons { display: flex; justify-content: flex-end; gap: 0.8em; }
        .tag-suggest-buttons button { padding: 0.5em 1.2em; border-radius: 4px; }
        .tag-suggest-warning { color: var(--text-warning); font-style: italic; margin-bottom: 1em; }
        .tag-suggest-regenerate { margin-right: auto; background-color: var(--interactive-accent); color: var(--text-on-accent); }
        .tag-suggest-regenerate:hover { background-color: var(--interactive-accent-hover); }
        .tag-suggest-new { color: var(--text-accent); font-weight: bold; }
        .tag-suggest-new::after { content: ' (新)'; color: var(--text-accent); font-size: 0.8em; font-weight: normal; }
        .tag-suggest-file-search { width: 100%; margin-bottom: 1em; padding: 0.5em; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); }
        .tag-suggest-file-list { max-height: 300px; overflow-y: auto; }
        .tag-suggest-file-item { display: flex; flex-direction: column; padding: 0.6em 0.8em; margin-bottom: 0.3em; cursor: pointer; border-radius: 4px; transition: background 0.15s; }
        .tag-suggest-file-item:hover { background: var(--background-modifier-hover); }
        .tag-suggest-file-name { font-weight: 600; font-size: 0.95em; }
        .tag-suggest-file-path { font-size: 0.8em; color: var(--text-muted); margin-top: 0.15em; }
      `,
    });
    this.register(() => styleEl.remove());
  }

  initializeOpenAI() {
    this.openai = new OpenAI({
      apiKey: this.settings.apiKey,
      baseURL: this.settings.apiBase,
      dangerouslyAllowBrowser: true,
    });
  }

  async getSystemPromptContent(): Promise<string | null> {
    if (!this.settings.systemPromptNotePath) return null;
    const file = this.app.vault.getAbstractFileByPath(this.settings.systemPromptNotePath);
    if (file instanceof TFile) {
      return await this.app.vault.read(file);
    }
    return null;
  }

  async getSystemPromptTitleContent(): Promise<string | null> {
    if (!this.settings.systemPromptTitleNotePath) return null;
    const file = this.app.vault.getAbstractFileByPath(this.settings.systemPromptTitleNotePath);
    if (file instanceof TFile) {
      return await this.app.vault.read(file);
    }
    return null;
  }

  async getAllExistingTags(): Promise<string[]> {
    const files = this.app.vault.getMarkdownFiles();
    const tagSet = new Set<string>();

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.tags) {
        cache.tags.forEach((t) => {
          tagSet.add(t.tag.replace('#', ''));
        });
      }
    }

    return Array.from(tagSet);
  }

  async getCurrentFileContent() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice('没有打开的文档');
      return null;
    }
    const content = await this.app.vault.read(file);
    return { file, content };
  }

  async suggestTags(file?: TFile) {
    const targetFile = file || this.app.workspace.getActiveFile();
    if (!targetFile) {
      new Notice('没有选择文件');
      return;
    }

    try {
      new Notice('正在分析文档...');
      const content = await this.app.vault.read(targetFile);
      const tags = await suggestTags(this, content);

      if (tags && tags.length > 0) {
        new TagSuggestModal(this.app, tags, content, this, async (selectedTags) => {
          if (selectedTags.length > 0) {
            await this.addTagsToFile(targetFile, selectedTags);
            new Notice(`已添加 ${selectedTags.length} 个标签`);
          }
        }).open();
      } else {
        new Notice('未能生成标签建议');
      }
    } catch (e) {
      console.error('生成标签失败:', e);
      new Notice('生成标签失败: ' + (e as Error).message);
    }
  }

  async suggestTitle(file?: TFile) {
    const targetFile = file || this.app.workspace.getActiveFile();
    if (!targetFile) {
      new Notice('没有选择文件');
      return;
    }
    try {
      new Notice('正在生成标题...');
      const content = await this.app.vault.read(targetFile);
      const title = await suggestTitle(this, content);
      if (title) {
        new RenameModal(this.app, targetFile, title).open();
      } else {
        new Notice('未能生成标题');
      }
    } catch (e) {
      console.error('生成标题失败:', e);
      new Notice('生成标题失败: ' + (e as Error).message);
    }
  }

  async getAllTagsWithCount(): Promise<[string, number][]> {
    const countMap = new Map<string, number>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.tags) {
        for (const t of cache.tags) {
          const tag = t.tag.replace(/^#/, '');
          countMap.set(tag, (countMap.get(tag) || 0) + 1);
        }
      }
    }
    return Array.from(countMap.entries()).sort((a, b) => b[1] - a[1]);
  }

  async modifyTagsInFile(file: TFile, modifier: (tags: string[]) => string[]): Promise<boolean> {
    const content = await this.app.vault.read(file);
    let frontmatter: string | null = null;
    let body = content;

    if (content.startsWith('---')) {
      const lines = content.split('\n');
      let endIdx = -1;
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trimEnd() === '---') {
          endIdx = i;
          break;
        }
      }
      if (endIdx !== -1) {
        frontmatter = lines.slice(1, endIdx).join('\n');
        body = lines.slice(endIdx + 1).join('\n');
      }
    }

    if (frontmatter === null) return false;

    const fmLines = frontmatter.split('\n');
    const tagIdx = fmLines.findIndex((l) => /^\s*tags:/i.test(l));
    if (tagIdx === -1) return false;

    const line = fmLines[tagIdx];
    const bracketMatch = line.match(/^(\s*tags:\s*)(\[?)([^\]]*)(\]?)\s*$/i);
    if (!bracketMatch) return false;

    const currentTags = bracketMatch[3].split(',').map((t) => t.trim()).filter(Boolean);
    const newTags = modifier(currentTags);

    if (newTags.length === currentTags.length && newTags.every((t, i) => t === currentTags[i])) {
      return false;
    }

    fmLines[tagIdx] = newTags.length > 0 ? `tags: [${newTags.join(', ')}]` : 'tags: []';
    await this.app.vault.modify(file, `---\n${fmLines.join('\n')}\n---\n${body}`);
    return true;
  }

  async autoManageTags() {
    try {
      new Notice('正在扫描标签...');
      const tagsWithCount = await this.getAllTagsWithCount();

      if (tagsWithCount.length === 0) {
        new Notice('库中没有标签');
        return;
      }

      new Notice('正在分析标签...');
      const ops = await suggestTagCleanup(this, tagsWithCount, this.settings.tagManagePrinciples);

      if (ops.length === 0) {
        new Notice('AI 认为当前标签无需整理');
        return;
      }

      let merged = 0, deleted = 0;
      const allFiles = this.app.vault.getMarkdownFiles();

      for (const op of ops) {
        if (op.type === 'merge' && op.from && op.to) {
          for (const file of allFiles) {
            const changed = await this.modifyTagsInFile(file, (tags) => {
              const hasFrom = tags.includes(op.from!);
              if (!hasFrom) return tags;
              const filtered = tags.filter((t) => t !== op.from!);
              if (!filtered.includes(op.to!)) filtered.push(op.to!);
              return filtered;
            });
            if (changed) merged++;
          }
        } else if (op.type === 'delete' && op.tag) {
          for (const file of allFiles) {
            const changed = await this.modifyTagsInFile(file, (tags) => {
              return tags.filter((t) => t !== op.tag!);
            });
            if (changed) deleted++;
          }
        }
      }

      new Notice(`整理完成！合并 ${merged} 次，删除 ${deleted} 次`);
    } catch (e) {
      console.error('整理标签失败:', e);
      new Notice('整理标签失败: ' + (e as Error).message);
    }
  }

  async addTagsToFile(file: TFile, tags: string[]) {
    try {
      const content = await this.app.vault.read(file);
      const tagList = tags.join(', ');

      let frontmatter: string | null = null;
      let body = content;

      if (content.startsWith('---')) {
        const lines = content.split('\n');
        let endIdx = -1;
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].trimEnd() === '---') {
            endIdx = i;
            break;
          }
        }
        if (endIdx !== -1) {
          frontmatter = lines.slice(1, endIdx).join('\n');
          body = lines.slice(endIdx + 1).join('\n');
        }
      }

      let newContent: string;

      if (frontmatter !== null) {
        const fmLines = frontmatter.split('\n');
        const tagIdx = fmLines.findIndex((l) => /^\s*tags:/i.test(l));

        if (tagIdx !== -1) {
          const line = fmLines[tagIdx];
          const bracketMatch = line.match(/^(\s*tags:\s*)(\[?)([^\]]*)(\]?)\s*$/i);
          if (bracketMatch) {
            const existingTags = bracketMatch[3]
              .split(',')
              .map((t: string) => t.trim())
              .filter(Boolean);
            const merged = [...new Set([...existingTags, ...tags])];
            fmLines[tagIdx] = `tags: [${merged.join(', ')}]`;
          } else {
            fmLines[tagIdx] = `tags: [${tagList}]`;
          }
        } else {
          fmLines.push(`tags: [${tagList}]`);
        }

        newContent = `---\n${fmLines.join('\n')}\n---\n${body}`;
      } else {
        newContent = `---\ntags: [${tagList}]\n---\n\n${content}`;
      }

      await this.app.vault.modify(file, newContent);
      new Notice('标签已添加到文档');
    } catch (e) {
      console.error('添加标签失败:', e);
      new Notice('添加标签失败: ' + (e as Error).message);
    }
  }

  async testAPIConnection() {
    if (!this.settings.apiKey) {
      new Notice('请先设置 API 密钥');
      return;
    }

    try {
      new Notice('正在测试 API 连接...');
      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 5,
      });
      console.log('API 响应:', response);
      new Notice('API 测试成功！');
    } catch (e) {
      console.error('API 测试详细错误:', e);
      new Notice(`API 测试失败: ${(e as Error).message}`);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.initializeOpenAI();
  }

  getMarkdownFilesInFolder(folder: TFolder): TFile[] {
    const files: TFile[] = [];

    const traverse = (dir: TFolder) => {
      dir.children.forEach((child) => {
        if (child instanceof TFile && child.extension === 'md') {
          files.push(child);
        } else if (child instanceof TFolder) {
          traverse(child);
        }
      });
    };

    traverse(folder);
    return files;
  }

  async suggestTagsForFolder(folder: TFolder) {
    const files = this.getMarkdownFilesInFolder(folder);

    if (files.length === 0) {
      new Notice('文件夹中没有 Markdown 文件');
      return;
    }

    const total = files.length;
    let processed = 0;
    const notice = new Notice(`正在处理文件... (0/${total})`, 0);

    try {
      for (const file of files) {
        processed++;
        notice.setMessage(`正在处理文件... (${processed}/${total})`);

        const content = await this.app.vault.read(file);
        let tags: string[];

        tags = await suggestTags(this, content);

        if (tags && tags.length > 0) {
          new TagSuggestModal(this.app, tags, content, this, async (selectedTags) => {
            if (selectedTags.length > 0) {
              await this.addTagsToFile(file, selectedTags);
              new Notice(`已为 ${file.basename} 添加 ${selectedTags.length} 个标签`);
            }
          }).open();
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } finally {
      notice.hide();
      new Notice(`处理完成！共处理 ${processed} 个文件`);
    }
  }
}

export default TagSuggestPlugin;
