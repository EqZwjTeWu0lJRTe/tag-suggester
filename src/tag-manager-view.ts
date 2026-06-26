import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { TagSuggestPlugin } from './main';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const VIEW_TYPE_TAG_MANAGER = 'tag-manager-view';

interface TagInfo {
  name: string;
  files: TFile[];
  totalCount: number;
  fmCount: number;
}

export class TagManagerView extends ItemView {
  private plugin: TagSuggestPlugin;
  private tags: TagInfo[] = [];
  private loading = true;
  private tableEl!: HTMLElement;
  private searchEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: TagSuggestPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return VIEW_TYPE_TAG_MANAGER; }
  getDisplayText(): string { return '标签管理器'; }
  getIcon(): string { return 'tags'; }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.buildUI();
    await this.refresh();
  }

  onClose() {
    this.contentEl.empty();
  }

  private buildUI() {
    const { contentEl } = this;
    contentEl.empty();

    if (this.loading) {
      contentEl.createEl('p', { text: '正在扫描标签...' });
      return;
    }

    contentEl.createEl('h3', { text: '标签管理器' });
    contentEl.createEl('p').setText(`共 ${this.tags.length} 个标签`);

    this.searchEl = contentEl.createEl('input', {
      type: 'text',
      placeholder: '搜索标签...',
    });

    this.tableEl = contentEl.createDiv();

    const renderList = (filter: string) => {
      this.tableEl.empty();
      const filtered = filter
        ? this.tags.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase()))
        : this.tags;
      if (filtered.length === 0) {
        this.tableEl.createEl('p', { text: '未找到匹配的标签' });
        return;
      }
      for (const tag of filtered) {
        this.renderRow(tag);
      }
    };

    this.searchEl.addEventListener('input', () => renderList((this.searchEl as HTMLInputElement).value));
    renderList('');

    this.fitTable();
  }

  private fitTable() {
    if (!this.tableEl) return;
    requestAnimationFrame(() => {
      const contentEl = this.contentEl;
      const rect = contentEl.getBoundingClientRect();
      const topOffset = this.searchEl ? this.searchEl.getBoundingClientRect().bottom - rect.top : 60;
      const avail = rect.height - topOffset - 8;
      this.tableEl.style.height = `${Math.max(100, avail)}px`;
      this.tableEl.style.overflowY = 'auto';
      this.tableEl.style.border = '1px solid var(--background-modifier-border)';
      this.tableEl.style.borderRadius = '6px';
      this.tableEl.style.background = 'var(--background-primary)';
    });
  }

  private renderRow(tag: TagInfo) {
    const row = this.tableEl.createDiv();
    row.style.cssText = 'display:flex;align-items:center;gap:0.4em;padding:0.6em 0.8em;border-bottom:1px solid var(--background-modifier-border);';

    const titleCol = row.createDiv();
    titleCol.style.cssText = 'flex:1;display:flex;align-items:center;gap:0.4em;min-width:0;overflow:hidden;';
    const nameEl = titleCol.createSpan({ text: tag.name });
    nameEl.style.cssText = 'font-weight:600;font-size:0.9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

    const fmCount = tag.fmCount;
    const inlineCount = tag.totalCount - fmCount;
    const hasFm = fmCount > 0;
    const hasInline = inlineCount > 0;

    if (hasFm && hasInline) {
      const badge = titleCol.createSpan({ text: `fm ${fmCount} / inline ${inlineCount}` });
      badge.style.cssText = 'font-size:0.7em;padding:0.05em 0.4em;border-radius:3px;flex-shrink:0;background:var(--color-green);color:#fff;';
    } else if (hasFm) {
      const badge = titleCol.createSpan({ text: 'frontmatter' });
      badge.style.cssText = 'font-size:0.7em;padding:0.05em 0.4em;border-radius:3px;flex-shrink:0;background:var(--interactive-accent);color:var(--text-on-accent);';
    } else {
      const badge = titleCol.createSpan({ text: '仅正文 inline' });
      badge.style.cssText = 'font-size:0.7em;padding:0.05em 0.4em;border-radius:3px;flex-shrink:0;background:var(--background-modifier-border);color:var(--text-muted);';
    }

    const countEl = row.createSpan({ text: `${tag.totalCount} 次` });
    countEl.style.cssText = 'color:var(--text-muted);font-size:0.8em;flex-shrink:0;width:3.5em;text-align:right;';

    const actions = row.createDiv();
    actions.style.cssText = 'display:flex;gap:0.2em;flex-shrink:0;';

    const makeBtn = (text: string, extraCss = '') => {
      const btn = actions.createEl('button', { text });
      btn.style.cssText = `padding:0.15em 0.5em;font-size:0.8em;border-radius:3px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);cursor:pointer;white-space:nowrap;${extraCss}`;
      return btn;
    };

    if (!hasFm) {
      makeBtn('重命名', 'opacity:0.4;cursor:not-allowed;');
      makeBtn('合并到', 'opacity:0.4;cursor:not-allowed;');
      makeBtn('删除', 'opacity:0.4;cursor:not-allowed;');
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

    const renameBtn = makeBtn('重命名');
    const mergeBtn = makeBtn('合并到');
    const deleteBtn = makeBtn('删除', 'border-color:var(--text-error);color:var(--text-error);');

    let stateEl: HTMLElement | null = null;
    const clearState = () => { stateEl?.remove(); stateEl = null; };

    renameBtn.addEventListener('click', () => {
      clearState();
      const input = document.createElement('input');
      input.type = 'text';
      input.value = tag.name;
      input.style.cssText = 'flex:1;min-width:120px;padding:0.3em 0.5em;border-radius:4px;border:1px solid var(--interactive-accent);background:var(--background-primary);color:var(--text-normal);font-size:0.9em;';
      row.insertBefore(input, actions);
      stateEl = input;

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = '确认';
      confirmBtn.style.cssText = 'padding:0.15em 0.5em;font-size:0.8em;border-radius:3px;background:var(--interactive-accent);color:var(--text-on-accent);border-color:var(--interactive-accent);cursor:pointer;white-space:nowrap;';
      actions.insertBefore(confirmBtn, renameBtn);

      const doCleanup = () => { input.remove(); confirmBtn.remove(); stateEl = null; };

      confirmBtn.addEventListener('click', async () => {
        const newName = input.value.trim();
        console.log(`[TagManager] rename click: old="${tag.name}" new="${newName}", fmFiles=${fmFiles.length}, skipped=${tag.files.length - fmFiles.length}`);
        if (!newName || newName === tag.name) { doCleanup(); return; }
        if (this.tags.some((t) => t.name === newName)) {
          new Notice(`标签「${newName}」已存在，请使用合并到功能`);
          return;
        }
        doCleanup();
        await this.doRename(tag.name, newName, fmFiles, tag.files.length - fmFiles.length);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmBtn.click();
        if (e.key === 'Escape') doCleanup();
      });
      input.focus();
      input.select();
    });

    mergeBtn.addEventListener('click', () => {
      clearState();
      const select = document.createElement('select');
      select.style.cssText = 'max-width:180px;padding:0.3em;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);font-size:0.85em;';
      select.createEl('option', { text: '选择目标标签...', value: '' });
      for (const t of this.tags) {
        if (t.name !== tag.name) select.createEl('option', { text: `${t.name} (${t.totalCount}次)`, value: t.name });
      }
      row.insertBefore(select, actions);
      stateEl = select;

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = '确认';
      confirmBtn.style.cssText = 'padding:0.15em 0.5em;font-size:0.8em;border-radius:3px;background:var(--interactive-accent);color:var(--text-on-accent);border-color:var(--interactive-accent);cursor:pointer;white-space:nowrap;';
      actions.insertBefore(confirmBtn, renameBtn);

      const doCleanup = () => { select.remove(); confirmBtn.remove(); stateEl = null; };

      confirmBtn.addEventListener('click', async () => {
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
    let count = 0; const errors: string[] = [];
    for (const file of fmFiles) {
      try {
        if (await this.plugin.modifyTagsInFile(file, (tags) =>
          tags.includes(oldName) ? tags.map((t) => t === oldName ? newName : t) : tags
        )) count++;
      } catch (e) { errors.push(file.path); console.error('[TagManager] 重命名失败:', e); }
    }
    notice.hide();
    let msg = `重命名完成: ${oldName} → ${newName}（影响 ${count} 个文件）`;
    if (skipped > 0) msg += `，${skipped} 个文件跳过（仅行内标签）`;
    if (errors.length > 0) msg += `，${errors.length} 个文件失败`;
    new Notice(msg, 8000);
    await sleep(500); await this.refresh();
  }

  private async doMerge(src: string, tgt: string, fmFiles: TFile[], skipped: number) {
    const notice = new Notice(`正在合并: ${src} → ${tgt}...`, 0);
    let count = 0; const errors: string[] = [];
    for (const file of fmFiles) {
      try {
        if (await this.plugin.modifyTagsInFile(file, (tags) => {
          if (!tags.includes(src)) return tags;
          const r = tags.filter((t) => t !== src);
          if (!r.includes(tgt)) r.push(tgt);
          return r;
        })) count++;
      } catch (e) { errors.push(file.path); console.error('[TagManager] 合并失败:', e); }
    }
    notice.hide();
    let msg = `合并完成: ${src} → ${tgt}（影响 ${count} 个文件）`;
    if (skipped > 0) msg += `，${skipped} 个文件跳过（仅行内标签）`;
    if (errors.length > 0) msg += `，${errors.length} 个文件失败`;
    new Notice(msg, 8000);
    await sleep(500); await this.refresh();
  }

  private async doDelete(tag: string, fmFiles: TFile[], skipped: number) {
    const notice = new Notice(`正在删除: ${tag}...`, 0);
    let count = 0; const errors: string[] = [];
    for (const file of fmFiles) {
      try {
        if (await this.plugin.modifyTagsInFile(file, (tags) => tags.filter((t) => t !== tag))) count++;
      } catch (e) { errors.push(file.path); console.error('[TagManager] 删除失败:', e); }
    }
    notice.hide();
    let msg = `删除完成: ${tag}（从 ${count} 个文件中移除）`;
    if (skipped > 0) msg += `，${skipped} 个文件跳过（仅行内标签）`;
    if (errors.length > 0) msg += `，${errors.length} 个文件失败`;
    new Notice(msg, 8000);
    await sleep(500); await this.refresh();
  }

  private async refresh() {
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
      this.contentEl.empty();
      this.contentEl.createEl('p', { text: '扫描标签失败: ' + (e as Error).message });
      const retryBtn = this.contentEl.createEl('button', { text: '重试' });
      retryBtn.addEventListener('click', () => { this.loading = true; this.buildUI(); this.refresh(); });
      return;
    }
    this.loading = false;
    this.buildUI();
  }
}
