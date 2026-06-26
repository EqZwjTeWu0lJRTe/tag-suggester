import { Modal, Notice, TFile } from 'obsidian';
import { TagSuggestPlugin } from './main';

interface TagInfo {
  name: string;
  files: TFile[];
  totalCount: number;
  fmCount: number;
}

export class TagManagerModal extends Modal {
  private plugin: TagSuggestPlugin;
  private tags: TagInfo[] = [];

  constructor(plugin: TagSuggestPlugin) {
    super(plugin.app);
    this.modalEl.addClass('tag-manager-modal');
  }

  async onOpen() {
    this.contentEl.empty();
    const loadingEl = this.contentEl.createEl('p', { text: '正在扫描标签...', cls: 'tag-suggest-description' });

    try {
      const tagMap = await this.plugin.buildTagFileIndex();

      this.tags = [];
      for (const [name, files] of tagMap) {
        let fmCount = 0;
        for (const file of files) {
          const cache = this.app.metadataCache.getFileCache(file);
          if (cache?.frontmatter?.tags) {
            const fmTags = cache.frontmatter.tags;
            if (typeof fmTags === 'string') {
              if (fmTags.split(/[, ]/).map((t) => t.trim().replace(/^#/, '')).includes(name)) fmCount++;
            } else if (Array.isArray(fmTags)) {
              if (fmTags.some((t) => typeof t === 'string' && t.trim().replace(/^#/, '') === name)) fmCount++;
            }
          }
        }
        this.tags.push({ name, files, totalCount: files.length, fmCount });
      }

      this.tags.sort((a, b) => b.totalCount - a.totalCount);
    } catch (e) {
      console.error('[TagManager] 扫描标签失败:', e);
      loadingEl.setText('扫描标签失败: ' + (e as Error).message);
      return;
    }

    this.contentEl.empty();
    this.render();
  }

  render() {
    const { contentEl } = this;

    contentEl.createEl('h2', { text: '标签管理器' });
    contentEl.createEl('p', { cls: 'tag-suggest-description' }).setText(`共 ${this.tags.length} 个标签`);

    const searchInput = contentEl.createEl('input', {
      type: 'text',
      placeholder: '搜索标签...',
      cls: 'tag-suggest-file-search',
    });

    const table = contentEl.createDiv({ cls: 'tag-suggest-container' });

    const renderList = (filter: string) => {
      table.empty();
      const filtered = filter
        ? this.tags.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase()))
        : this.tags;

      if (filtered.length === 0) {
        table.createEl('p', { text: '未找到匹配的标签', cls: 'tag-suggest-description' });
        return;
      }

      for (const tag of filtered) {
        this.renderRow(table, tag);
      }
    };

    searchInput.addEventListener('input', () => renderList(searchInput.value));
    renderList('');
  }

  private renderRow(table: HTMLElement, tag: TagInfo) {
    const row = table.createDiv({ cls: 'tag-manager-row' });

    const titleCol = row.createDiv({ cls: 'tag-manager-title' });
    titleCol.createSpan({ text: tag.name, cls: 'tag-manager-name' });

    const fmCount = tag.fmCount;
    const inlineCount = tag.totalCount - fmCount;
    const hasFm = fmCount > 0;
    const hasInline = inlineCount > 0;

    if (hasFm && hasInline) {
      const badge = titleCol.createSpan({ cls: 'tag-manager-badge both' });
      badge.setText(`fm ${fmCount} / inline ${inlineCount}`);
      badge.title = '同时存在于 frontmatter 和正文中';
    } else if (hasFm) {
      const badge = titleCol.createSpan({ cls: 'tag-manager-badge fm' });
      badge.setText('frontmatter');
      badge.title = '仅存在于 frontmatter tags: 中';
    } else {
      const badge = titleCol.createSpan({ cls: 'tag-manager-badge inline' });
      badge.setText('仅正文 inline');
      badge.title = '仅存在于正文 #tag 中，暂不支持修改';
    }

    const countCol = row.createDiv({ cls: 'tag-manager-count' });
    countCol.setText(`${tag.totalCount} 次`);

    const actions = row.createDiv({ cls: 'tag-manager-actions' });

    if (!hasFm) {
      actions.createEl('button', { text: '重命名', cls: 'tag-manager-btn disabled' });
      actions.createEl('button', { text: '合并到', cls: 'tag-manager-btn disabled' });
      actions.createEl('button', { text: '删除', cls: 'tag-manager-btn disabled' });
      return;
    }

    const fmFiles = tag.files.filter((f) => {
      const cache = this.app.metadataCache.getFileCache(f);
      if (cache?.frontmatter?.tags) {
        const fmTags = cache.frontmatter.tags;
        if (typeof fmTags === 'string') return fmTags.split(/[, ]/).map((t) => t.trim().replace(/^#/, '')).includes(tag.name);
        if (Array.isArray(fmTags)) return fmTags.some((t) => typeof t === 'string' && t.trim().replace(/^#/, '') === tag.name);
      }
      return false;
    });

    const renameBtn = actions.createEl('button', { text: '重命名', cls: 'tag-manager-btn' });
    const mergeBtn = actions.createEl('button', { text: '合并到', cls: 'tag-manager-btn' });
    const deleteBtn = actions.createEl('button', { text: '删除', cls: 'tag-manager-btn danger' });

    let stateEl: HTMLElement | null = null;

    const clearState = () => { stateEl?.remove(); stateEl = null; };

    renameBtn.addEventListener('click', () => {
      clearState();
      const input = document.createElement('input');
      input.type = 'text';
      input.value = tag.name;
      input.className = 'tag-manager-input';
      row.insertBefore(input, actions);
      stateEl = input;

      const confirm = actions.insertBefore(document.createElement('button'), renameBtn);
      confirm.textContent = '确认';
      confirm.className = 'tag-manager-btn primary';

      const doCleanup = () => { input.remove(); confirm.remove(); stateEl = null; };

      confirm.addEventListener('click', async () => {
        const newName = input.value.trim();
        if (!newName || newName === tag.name) { doCleanup(); return; }
        if (this.tags.some((t) => t.name === newName)) {
          new Notice(`标签「${newName}」已存在，请使用合并到功能`);
          return;
        }
        doCleanup();
        await this.doRename(tag.name, newName, fmFiles, tag.files.length - fmFiles.length);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirm.click();
        if (e.key === 'Escape') doCleanup();
      });
      input.focus();
      input.select();
    });

    mergeBtn.addEventListener('click', () => {
      clearState();
      const select = document.createElement('select');
      select.className = 'tag-manager-select';
      select.createEl('option', { text: '选择目标标签...', value: '' });
      for (const t of this.tags) {
        if (t.name !== tag.name) select.createEl('option', { text: `${t.name} (${t.totalCount}次)`, value: t.name });
      }
      row.insertBefore(select, actions);
      stateEl = select;

      const confirm = actions.insertBefore(document.createElement('button'), renameBtn);
      confirm.textContent = '确认';
      confirm.className = 'tag-manager-btn primary';

      const doCleanup = () => { select.remove(); confirm.remove(); stateEl = null; };

      confirm.addEventListener('click', async () => {
        const target = select.value;
        if (!target) { doCleanup(); return; }
        doCleanup();
        await this.doMerge(tag.name, target, fmFiles, tag.files.length - fmFiles.length);
      });

      select.focus();
    });

    deleteBtn.addEventListener('click', async () => {
      if (deleteBtn.textContent === '确认删除?') {
        await this.doDelete(tag.name, fmFiles, tag.files.length - fmFiles.length);
      } else {
        deleteBtn.textContent = '确认删除?';
        setTimeout(() => { deleteBtn.textContent = '删除'; }, 3000);
      }
    });
  }

  private async doRename(oldName: string, newName: string, fmFiles: TFile[], skipped: number) {
    const notice = new Notice(`正在重命名: ${oldName} → ${newName}...`, 0);
    let count = 0;
    const errors: string[] = [];
    for (const file of fmFiles) {
      try {
        const changed = await this.plugin.modifyTagsInFile(file, (tags) => {
          if (!tags.includes(oldName)) return tags;
          return tags.map((t) => (t === oldName ? newName : t));
        });
        if (changed) count++;
      } catch (e) {
        errors.push(file.path);
        console.error(`[TagManager] 重命名失败 ${file.path}:`, e);
      }
    }
    notice.hide();
    let msg = `重命名完成: ${oldName} → ${newName}（影响 ${count} 个文件）`;
    if (skipped > 0) msg += `，${skipped} 个文件跳过（仅行内标签）`;
    if (errors.length > 0) msg += `，${errors.length} 个文件失败`;
    new Notice(msg, 8000);
    this.refresh();
  }

  private async doMerge(source: string, target: string, fmFiles: TFile[], skipped: number) {
    const notice = new Notice(`正在合并: ${source} → ${target}...`, 0);
    let count = 0;
    const errors: string[] = [];
    for (const file of fmFiles) {
      try {
        const changed = await this.plugin.modifyTagsInFile(file, (tags) => {
          if (!tags.includes(source)) return tags;
          const filtered = tags.filter((t) => t !== source);
          if (!filtered.includes(target)) filtered.push(target);
          return filtered;
        });
        if (changed) count++;
      } catch (e) {
        errors.push(file.path);
        console.error(`[TagManager] 合并失败 ${file.path}:`, e);
      }
    }
    notice.hide();
    let msg = `合并完成: ${source} → ${target}（影响 ${count} 个文件）`;
    if (skipped > 0) msg += `，${skipped} 个文件跳过（仅行内标签）`;
    if (errors.length > 0) msg += `，${errors.length} 个文件失败`;
    new Notice(msg, 8000);
    this.refresh();
  }

  private async doDelete(tag: string, fmFiles: TFile[], skipped: number) {
    const notice = new Notice(`正在删除: ${tag}...`, 0);
    let count = 0;
    const errors: string[] = [];
    for (const file of fmFiles) {
      try {
        const changed = await this.plugin.modifyTagsInFile(file, (tags) => {
          return tags.filter((t) => t !== tag);
        });
        if (changed) count++;
      } catch (e) {
        errors.push(file.path);
        console.error(`[TagManager] 删除失败 ${file.path}:`, e);
      }
    }
    notice.hide();
    let msg = `删除完成: ${tag}（从 ${count} 个文件中移除）`;
    if (skipped > 0) msg += `，${skipped} 个文件跳过（仅行内标签）`;
    if (errors.length > 0) msg += `，${errors.length} 个文件失败`;
    new Notice(msg, 8000);
    this.refresh();
  }

  private async refresh() {
    const tagMap = await this.plugin.buildTagFileIndex();
    this.tags = [];
    for (const [name, files] of tagMap) {
      let fmCount = 0;
      for (const file of files) {
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter?.tags) {
          const fmTags = cache.frontmatter.tags;
          if (typeof fmTags === 'string') {
            if (fmTags.split(/[, ]/).map((t) => t.trim().replace(/^#/, '')).includes(name)) fmCount++;
          } else if (Array.isArray(fmTags)) {
            if (fmTags.some((t) => typeof t === 'string' && t.trim().replace(/^#/, '') === name)) fmCount++;
          }
        }
      }
      this.tags.push({ name, files, totalCount: files.length, fmCount });
    }
    this.tags.sort((a, b) => b.totalCount - a.totalCount);
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }
}
