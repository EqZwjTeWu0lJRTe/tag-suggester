import { Modal, Notice, TFile } from 'obsidian';
import { TagSuggestPlugin } from './main';

export class TagManagerModal extends Modal {
  private plugin: TagSuggestPlugin;
  private tags: { name: string; count: number; files: TFile[] }[] = [];

  constructor(plugin: TagSuggestPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  async onOpen() {
    const tagMap = await this.plugin.buildTagFileIndex();
    this.tags = Array.from(tagMap.entries())
      .map(([name, files]) => ({ name, count: files.length, files }))
      .sort((a, b) => b.count - a.count);
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: '手动标签管理' });
    const desc = contentEl.createEl('p', { cls: 'tag-suggest-description' });
    desc.setText(`共 ${this.tags.length} 个标签，点击标签名可编辑操作`);

    const searchInput = contentEl.createEl('input', {
      type: 'text',
      placeholder: '搜索标签...',
      cls: 'tag-suggest-file-search',
    });

    const container = contentEl.createDiv({ cls: 'tag-suggest-container' });

    const renderList = (filter: string) => {
      container.empty();
      const filtered = filter
        ? this.tags.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase()))
        : this.tags;

      if (filtered.length === 0) {
        container.createEl('p', { text: '未找到匹配的标签', cls: 'tag-suggest-description' });
        return;
      }

      for (const tag of filtered) {
        this.renderTagRow(container, tag);
      }
    };

    searchInput.addEventListener('input', () => renderList(searchInput.value));
    renderList('');
  }

  private renderTagRow(container: HTMLElement, tag: { name: string; count: number; files: TFile[] }) {
    const row = container.createDiv({ cls: 'tag-suggest-item' });
    row.createSpan({ text: `${tag.name}`, cls: 'tag-suggest-text' });
    row.createSpan({ text: ` (${tag.count}次)`, cls: 'tag-suggest-description' });

    const actions = row.createDiv({ cls: 'tag-suggest-buttons' });

    const renameBtn = actions.createEl('button', { text: '重命名', cls: 'tag-suggest-regenerate' });
    const mergeBtn = actions.createEl('button', { text: '合并到', cls: 'tag-suggest-regenerate' });
    const deleteBtn = actions.createEl('button', { text: '删除' });

    let stateEl: HTMLElement | null = null;

    renameBtn.addEventListener('click', () => {
      this.clearState(stateEl);
      const input = document.createElement('input');
      input.type = 'text';
      input.value = tag.name;
      input.className = 'tag-suggest-file-search';
      input.style.width = '200px';
      row.insertBefore(input, actions);
      stateEl = input;

      const confirm = actions.insertBefore(document.createElement('button'), renameBtn);
      confirm.textContent = '确认';
      confirm.className = 'mod-cta';

      const cleanup = () => {
        input.remove();
        confirm.remove();
        stateEl = null;
      };

      confirm.addEventListener('click', async () => {
        const newName = input.value.trim();
        if (!newName || newName === tag.name) { cleanup(); return; }
        if (this.tags.some((t) => t.name === newName)) {
          new Notice('目标标签已存在，请使用「合并到」功能');
          return;
        }
        cleanup();
        await this.doRename(tag.name, newName, tag.files);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirm.click();
        if (e.key === 'Escape') cleanup();
      });
      input.focus();
    });

    mergeBtn.addEventListener('click', () => {
      this.clearState(stateEl);
      const select = document.createElement('select');
      select.className = 'dropdown';
      select.style.maxWidth = '200px';
      select.createEl('option', { text: '选择目标标签...', value: '' });
      for (const t of this.tags) {
        if (t.name !== tag.name) {
          select.createEl('option', { text: `${t.name} (${t.count}次)`, value: t.name });
        }
      }
      row.insertBefore(select, actions);
      stateEl = select;

      const confirm = actions.insertBefore(document.createElement('button'), renameBtn);
      confirm.textContent = '确认';
      confirm.className = 'mod-cta';

      const cleanup = () => {
        select.remove();
        confirm.remove();
        stateEl = null;
      };

      confirm.addEventListener('click', async () => {
        const target = select.value;
        if (!target) { cleanup(); return; }
        cleanup();
        await this.doMerge(tag.name, target, tag.files);
      });
    });

    deleteBtn.addEventListener('click', async () => {
      if (deleteBtn.textContent === '确认删除?') {
        await this.doDelete(tag.name, tag.files);
      } else {
        deleteBtn.textContent = '确认删除?';
        deleteBtn.style.color = 'var(--text-error)';
        setTimeout(() => { deleteBtn.textContent = '删除'; deleteBtn.style.color = ''; }, 3000);
      }
    });
  }

  private clearState(el: HTMLElement | null) {
    el?.remove();
  }

  private async doRename(oldName: string, newName: string, files: TFile[]) {
    const notice = new Notice(`正在重命名: ${oldName} → ${newName}...`, 0);
    let count = 0;
    for (const file of files) {
      const changed = await this.plugin.modifyTagsInFile(file, (tags) => {
        if (!tags.includes(oldName)) return tags;
        return tags.map((t) => (t === oldName ? newName : t));
      });
      if (changed) count++;
    }
    notice.hide();
    new Notice(`重命名完成: ${oldName} → ${newName}（影响 ${count} 个文件）`);
    this.refresh();
  }

  private async doMerge(source: string, target: string, files: TFile[]) {
    const notice = new Notice(`正在合并: ${source} → ${target}...`, 0);
    let count = 0;
    for (const file of files) {
      const changed = await this.plugin.modifyTagsInFile(file, (tags) => {
        if (!tags.includes(source)) return tags;
        const filtered = tags.filter((t) => t !== source);
        if (!filtered.includes(target)) filtered.push(target);
        return filtered;
      });
      if (changed) count++;
    }
    notice.hide();
    new Notice(`合并完成: ${source} → ${target}（影响 ${count} 个文件）`);
    this.refresh();
  }

  private async doDelete(tag: string, files: TFile[]) {
    const notice = new Notice(`正在删除: ${tag}...`, 0);
    let count = 0;
    for (const file of files) {
      const changed = await this.plugin.modifyTagsInFile(file, (tags) => {
        return tags.filter((t) => t !== tag);
      });
      if (changed) count++;
    }
    notice.hide();
    new Notice(`删除完成: ${tag}（从 ${count} 个文件中移除）`);
    this.refresh();
  }

  private async refresh() {
    const tagMap = await this.plugin.buildTagFileIndex();
    this.tags = Array.from(tagMap.entries())
      .map(([name, files]) => ({ name, count: files.length, files }))
      .sort((a, b) => b.count - a.count);
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }
}
