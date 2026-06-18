import { App, Modal, TFolder } from 'obsidian';
import { TagSuggestPlugin } from './main';

export class BatchSuggestModal extends Modal {
  constructor(
    app: App,
    private folder: TFolder,
    private plugin: TagSuggestPlugin,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    const files = this.plugin.getMarkdownFilesInFolder(this.folder);

    contentEl.createEl('h2', { text: '批量生成标签' });
    contentEl.createEl('p', {
      text: `将为文件夹 "${this.folder.name}" 下的 ${files.length} 个 Markdown 文件生成标签。`,
      cls: 'tag-suggest-description',
    });
    contentEl.createEl('p', {
      text: '注意：此操作可能需要一些时间，请耐心等待。',
      cls: 'tag-suggest-warning',
    });

    const buttons = contentEl.createDiv({ cls: 'tag-suggest-buttons' });

    buttons.createEl('button', { text: '开始处理', cls: 'mod-cta' })
      .addEventListener('click', async () => {
        this.close();
        await this.plugin.suggestTagsForFolder(this.folder);
      });

    buttons.createEl('button', { text: '取消' })
      .addEventListener('click', () => this.close());
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
