import { Plugin, TFile, TFolder, Notice, addIcon } from 'obsidian';
import OpenAI from 'openai';
import { TagSuggestSettings, DEFAULT_SETTINGS } from './settings';
import { TagSuggestModal } from './suggest-modal';
import { BatchSuggestModal } from './batch-modal';
import { TagSuggestSettingTab } from './settings-tab';
import { RenameModal } from './rename-modal';
import { suggestTags, suggestTitle, suggestTagCleanup, CleanupOp } from './api';

interface TagOperation {
  type: 'merge' | 'delete';
  tag: string;
  targetTag?: string;
}

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
      const content = await this.app.vault.read(file);
      console.log(`[TagSuggest] 使用标签提示词笔记: ${file.path} (${content.length} 字符)`);
      return content;
    }
    console.warn(`[TagSuggest] 标签提示词笔记未找到: ${this.settings.systemPromptNotePath}`);
    new Notice(`标签提示词笔记未找到: ${this.settings.systemPromptNotePath}`);
    return null;
  }

  async getSystemPromptTitleContent(): Promise<string | null> {
    if (!this.settings.systemPromptTitleNotePath) return null;
    const file = this.app.vault.getAbstractFileByPath(this.settings.systemPromptTitleNotePath);
    if (file instanceof TFile) {
      const content = await this.app.vault.read(file);
      console.log(`[TagSuggest] 使用标题提示词笔记: ${file.path} (${content.length} 字符)`);
      return content;
    }
    console.warn(`[TagSuggest] 标题提示词笔记未找到: ${this.settings.systemPromptTitleNotePath}`);
    new Notice(`标题提示词笔记未找到: ${this.settings.systemPromptTitleNotePath}`);
    return null;
  }

  async getAllExistingTags(): Promise<string[]> {
    const tagSet = new Set<string>();

    const addTag = (tag: unknown) => {
      if (!tag || typeof tag !== 'string') return;
      const t = tag.replace(/^#/, '').trim();
      if (t) tagSet.add(t);
    };

    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);

      if (cache?.tags) {
        cache.tags.forEach((t) => addTag(t.tag));
      }

      if (cache?.frontmatter?.tags) {
        const fmTags = cache.frontmatter.tags;
        if (typeof fmTags === 'string') {
          fmTags.split(/[, ]/).filter(Boolean).forEach(addTag);
        } else if (Array.isArray(fmTags)) {
          fmTags.forEach(addTag);
        }
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
        console.log(`[TagSuggest] 建议标签: [${tags.join(', ')}]`);
        new TagSuggestModal(this.app, tags, content, this, async (selectedTags) => {
          if (selectedTags.length > 0) {
            console.log(`[TagSuggest] 用户确认标签: [${selectedTags.join(', ')}]`);
            await this.addTagsToFile(targetFile, selectedTags);
          } else {
            console.log('[TagSuggest] 用户未选择任何标签');
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

    const addTag = (tag: unknown) => {
      if (!tag || typeof tag !== 'string') return;
      const t = tag.replace(/^#/, '').trim();
      if (t) countMap.set(t, (countMap.get(t) || 0) + 1);
    };

    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);

      if (cache?.tags) {
        for (const t of cache.tags) addTag(t.tag);
      }

      if (cache?.frontmatter?.tags) {
        const fmTags = cache.frontmatter.tags;
        if (typeof fmTags === 'string') {
          fmTags.split(/[, ]/).filter(Boolean).forEach(addTag);
        } else if (Array.isArray(fmTags)) {
          fmTags.forEach(addTag);
        }
      }
    }

    return Array.from(countMap.entries()).sort((a, b) => b[1] - a[1]);
  }

  async buildTagFileIndex(onProgress?: (current: number, total: number) => void): Promise<Map<string, TFile[]>> {
    const tagMap = new Map<string, TFile[]>();
    const allFiles = this.app.vault.getMarkdownFiles();
    const total = allFiles.length;

    const collectTag = (tag: unknown, file: TFile) => {
      if (!tag || typeof tag !== 'string') return;
      const t = tag.replace(/^#/, '').trim();
      if (!t) return;
      const files = tagMap.get(t);
      if (files) {
        files.push(file);
      } else {
        tagMap.set(t, [file]);
      }
    };

    const batchSize = Math.max(1, Math.floor(total / 100) || 50);
    for (let i = 0; i < total; i++) {
      const file = allFiles[i];
      const cache = this.app.metadataCache.getFileCache(file);

      if (cache?.tags) {
        for (const t of cache.tags) collectTag(t.tag, file);
      }

      if (cache?.frontmatter?.tags) {
        const fmTags = cache.frontmatter.tags;
        if (typeof fmTags === 'string') {
          fmTags.split(/[, ]/).filter(Boolean).forEach((t) => collectTag(t, file));
        } else if (Array.isArray(fmTags)) {
          fmTags.forEach((t) => collectTag(t, file));
        }
      }

      if (onProgress && (i % batchSize === 0 || i === total - 1)) {
        onProgress(i + 1, total);
      }
    }

    return tagMap;
  }

  parseTagsFromFrontmatter(fmLines: string[], tagIdx: number): string[] {
    const line = fmLines[tagIdx];
    const bracketMatch = line.match(/^(\s*)tags:\s*\[([^\]]*)\]\s*$/i);
    if (bracketMatch) {
      return bracketMatch[2].split(',').map((t) => t.trim()).filter(Boolean);
    }

    const listMatch = line.match(/^(\s*)tags:\s*$/i);
    if (listMatch) {
      const tags: string[] = [];
      for (let i = tagIdx + 1; i < fmLines.length; i++) {
        const itemMatch = fmLines[i].match(/^\s+-\s+(.+)$/);
        if (itemMatch && itemMatch[1].trim()) {
          tags.push(itemMatch[1].trim());
        } else if (itemMatch) {
          continue;
        } else {
          break;
        }
      }
      return tags;
    }

    const flatMatch = line.match(/^(\s*)tags:\s*(.+)$/i);
    if (flatMatch) {
      return flatMatch[2].split(/[,，]/).map((t) => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }

    return [];
  }

  async modifyTagsInFile(file: TFile, modifier: (tags: string[]) => string[]): Promise<boolean> {
    const content = await this.app.vault.read(file);
    const lines = content.split('\n');

    let endIdx = -1;
    if (content.startsWith('---')) {
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trimEnd() === '---') {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx === -1) return false;

    const fmLines = lines.slice(1, endIdx);
    const tagIdx = fmLines.findIndex((l) => /^\s*tags:/i.test(l));
    if (tagIdx === -1) return false;

    const currentTags = this.parseTagsFromFrontmatter(fmLines, tagIdx);
    const newTags = modifier(currentTags);

    if (newTags.length === currentTags.length && newTags.every((t, i) => t === currentTags[i])) {
      return false;
    }

    const listIndent = fmLines[tagIdx].match(/^(\s*)tags:/i)![1];

    if (fmLines[tagIdx].match(/^(\s*)tags:\s*$/i)) {
      let removeCount = 0;
      for (let i = tagIdx + 1; i < fmLines.length; i++) {
        if (fmLines[i].match(/^\s+-\s+/)) {
          removeCount++;
        } else {
          break;
        }
      }
      fmLines.splice(tagIdx + 1, removeCount);
    }

    if (newTags.length === 0) {
      fmLines[tagIdx] = `${listIndent}tags: []`;
    } else {
      fmLines[tagIdx] = `${listIndent}tags: [${newTags.join(', ')}]`;
    }

    lines.splice(1, endIdx - 1, ...fmLines);
    await this.app.vault.modify(file, lines.join('\n'));
    return true;
  }

  async autoManageTags() {
    const scanNotice = new Notice('正在扫描标签...', 0);
    try {
      const tagMap = await this.buildTagFileIndex((current, total) => {
        scanNotice.setMessage(`正在扫描标签 (${current}/${total})...`);
      });

      if (tagMap.size === 0) {
        scanNotice.hide();
        new Notice('库中没有标签');
        return;
      }

      scanNotice.setMessage(`扫描完成，共 ${tagMap.size} 个标签，正在调用 AI 分析...`);

      const tagsWithCount = Array.from(tagMap.entries()).map(
        ([tag, files]) => [tag, files.length] as [string, number],
      );

      const ops = await suggestTagCleanup(this, tagsWithCount, this.settings.tagManagePrinciples);

      if (ops.length === 0) {
        scanNotice.hide();
        new Notice('AI 认为当前标签无需整理，共扫描 ' + tagMap.size + ' 个标签');
        return;
      }

      // 构建文件 → 操作列表映射
      const fileOps = new Map<TFile, TagOperation[]>();
      for (const op of ops) {
        if (op.type === 'merge' && op.from && op.to) {
          const files = tagMap.get(op.from);
          if (!files || files.length === 0) continue;
          const tagOp: TagOperation = { type: 'merge', tag: op.from, targetTag: op.to };
          for (const file of files) {
            const existing = fileOps.get(file);
            if (existing) {
              existing.push(tagOp);
            } else {
              fileOps.set(file, [tagOp]);
            }
          }
        } else if (op.type === 'delete' && op.tag) {
          const files = tagMap.get(op.tag);
          if (!files || files.length === 0) continue;
          const tagOp: TagOperation = { type: 'delete', tag: op.tag };
          for (const file of files) {
            const existing = fileOps.get(file);
            if (existing) {
              existing.push(tagOp);
            } else {
              fileOps.set(file, [tagOp]);
            }
          }
        }
      }

      // 批量处理：每个文件只读写一次
      const totalFiles = fileOps.size;
      let processed = 0;

      // 按操作类型统计（不是按文件）
      const mergeFileCounts = new Map<string, number>();
      const deleteFileCounts = new Map<string, number>();

      for (const [file, ops] of fileOps) {
        processed++;
        scanNotice.setMessage(`正在执行批量操作 (${processed}/${totalFiles})...`);

        const content = await this.app.vault.read(file);
        const lines = content.split('\n');

        let endIdx = -1;
        if (content.startsWith('---')) {
          for (let i = 1; i < lines.length; i++) {
            if (lines[i].trimEnd() === '---') {
              endIdx = i;
              break;
            }
          }
        }
        if (endIdx === -1) continue;

        const fmLines = lines.slice(1, endIdx);
        const tagIdx = fmLines.findIndex((l) => /^\s*tags:/i.test(l));
        if (tagIdx === -1) continue;

        const currentTags = this.parseTagsFromFrontmatter(fmLines, tagIdx);
        let tagSet = new Set(currentTags);

        // 先删后合，避免冲突
        let changedInFile = false;
        for (const op of ops) {
          if (op.type === 'delete' && tagSet.has(op.tag)) {
            tagSet.delete(op.tag);
            changedInFile = true;
            deleteFileCounts.set(op.tag, (deleteFileCounts.get(op.tag) || 0) + 1);
          }
        }
        for (const op of ops) {
          if (op.type === 'merge' && tagSet.has(op.tag) && op.targetTag) {
            tagSet.delete(op.tag);
            tagSet.add(op.targetTag);
            changedInFile = true;
            mergeFileCounts.set(`${op.tag}→${op.targetTag}`, (mergeFileCounts.get(`${op.tag}→${op.targetTag}`) || 0) + 1);
          }
        }

        if (!changedInFile) continue;

        const newTags = Array.from(tagSet);
        const listIndent = fmLines[tagIdx].match(/^(\s*)tags:/i)![1];

        if (fmLines[tagIdx].match(/^(\s*)tags:\s*$/i)) {
          let removeCount = 0;
          for (let i = tagIdx + 1; i < fmLines.length; i++) {
            if (fmLines[i].match(/^\s+-\s+/)) removeCount++;
            else break;
          }
          fmLines.splice(tagIdx + 1, removeCount);
        }

        fmLines[tagIdx] = newTags.length === 0
          ? `${listIndent}tags: []`
          : `${listIndent}tags: [${newTags.join(', ')}]`;

        lines.splice(1, endIdx - 1, ...fmLines);
        await this.app.vault.modify(file, lines.join('\n'));
      }

      scanNotice.hide();

      const merged = mergeFileCounts.size;
      const deleted = deleteFileCounts.size;
      const detailLines: string[] = [];

      for (const [key, count] of mergeFileCounts) {
        const [from, to] = key.split('→');
        detailLines.push(`合并: ${from} → ${to}（影响 ${count} 个文件）`);
      }
      for (const [tag, count] of deleteFileCounts) {
        detailLines.push(`删除: ${tag}（影响 ${count} 个文件）`);
      }

      const summary = `整理完成！合并 ${merged} 个标签，删除 ${deleted} 个标签，涉及 ${totalFiles} 个文件`;
      console.log(summary + '\n' + detailLines.join('\n'));

      const resultMsg = detailLines.length > 0
        ? summary + '\n\n' + detailLines.join('\n')
        : summary;
      new Notice(resultMsg, 8000);
    } catch (e) {
      scanNotice.hide();
      console.error('整理标签失败:', e);
      new Notice('整理标签失败: ' + (e as Error).message);
    }
  }

  async addTagsToFile(file: TFile, tags: string[]) {
    try {
      console.log(`[TagSuggest] addTagsToFile: ${file.path}, tags=[${tags.join(', ')}]`);
      const content = await this.app.vault.read(file);
      const tagList = tags.join(', ');
      const lines = content.split('\n');

      let endIdx = -1;
      if (content.startsWith('---')) {
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].trimEnd() === '---') {
            endIdx = i;
            break;
          }
        }
      }
      console.log(`[TagSuggest] endIdx=${endIdx}, lines.length=${lines.length}`);

      if (endIdx !== -1) {
        const fmLines = lines.slice(1, endIdx);
        const tagIdx = fmLines.findIndex((l) => /^\s*tags:/i.test(l));
        console.log(`[TagSuggest] tagIdx=${tagIdx}, fmLines count=${fmLines.length}`);

        if (tagIdx !== -1) {
          const existingTags = this.parseTagsFromFrontmatter(fmLines, tagIdx);
          console.log(`[TagSuggest] existingTags=[${existingTags.join(', ')}]`);
          const merged = [...new Set([...existingTags, ...tags])];
          console.log(`[TagSuggest] merged=[${merged.join(', ')}]`);

          if (fmLines[tagIdx].match(/^(\s*)tags:\s*$/i)) {
            let removeCount = 0;
            for (let i = tagIdx + 1; i < fmLines.length; i++) {
              if (fmLines[i].match(/^\s+-\s+/)) removeCount++;
              else break;
            }
            fmLines.splice(tagIdx + 1, removeCount);
          }

          fmLines[tagIdx] = `tags: [${merged.join(', ')}]`;
        } else {
          console.log(`[TagSuggest] tags line not found, adding new tags line`);
          fmLines.push(`tags: [${tagList}]`);
        }

        lines.splice(1, endIdx - 1, ...fmLines);
        await this.app.vault.modify(file, lines.join('\n'));
      } else {
        console.log(`[TagSuggest] no frontmatter, creating new`);
        await this.app.vault.modify(file, `---\ntags: [${tagList}]\n---\n\n${content}`);
      }

      console.log(`[TagSuggest] done: ${file.path}`);
      new Notice('标签已添加到文档');
    } catch (e) {
      console.error('[TagSuggest] 添加标签失败:', e);
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
