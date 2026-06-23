import { App, Modal, TFile, Notice } from 'obsidian';

export class RenameModal extends Modal {
  constructor(
    app: App,
    private file: TFile,
    private suggestedName: string,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl('h2', { text: '重命名笔记' });
    contentEl.createEl('p', {
      text: `将 "${this.file.basename}" 重命名为：`,
      cls: 'tag-suggest-description',
    });

    const input = contentEl.createEl('input', {
      type: 'text',
      value: this.suggestedName,
      cls: 'tag-suggest-file-search',
    });
    input.focus();
    input.select();

    const buttons = contentEl.createDiv({ cls: 'tag-suggest-buttons' });

    buttons.createEl('button', { text: '确认重命名', cls: 'mod-cta' }).addEventListener('click', async () => {
      const newName = input.value.trim().replace(/[\\/:*?"<>|]/g, '');
      if (!newName) return;
      const newPath = this.file.parent
        ? `${this.file.parent.path}/${newName}.md`
        : `${newName}.md`;
      try {
        await this.app.vault.rename(this.file, newPath);
        new Notice(`已重命名为 ${newName}`);
      } catch (e) {
        new Notice(`重命名失败: ${(e as Error).message}`);
      }
      this.close();
    });

    buttons.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}
