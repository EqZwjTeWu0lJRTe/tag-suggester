import { App, Modal, Notice } from 'obsidian';
import { TagSuggestPlugin } from './main';
import { suggestTags } from './api';
import { calculateSimilarity } from './utils';

export class TagSuggestModal extends Modal {
  private selectedTags: Set<string>;
  private previousTags: Set<string>;

  constructor(
    app: App,
    private tags: string[],
    private content: string,
    private plugin: TagSuggestPlugin,
    private onConfirm: (tags: string[]) => void,
  ) {
    super(app);
    this.selectedTags = new Set(tags);
    this.previousTags = new Set(tags);
  }

  async regenerateTags() {
    try {
      new Notice('正在重新生成标签...');

      const selectedArray = Array.from(this.selectedTags);
      const keptTags = this.tags.filter((tag) => !this.selectedTags.has(tag));
      const count = selectedArray.length;

      if (count === 0) {
        new Notice('请先选择要替换的标签');
        return;
      }

      const prompt = `
请为以下内容生成 ${count} 个全新的标签。
要求：
1. 标签必须与以下已有标签完全不同：${Array.from(this.previousTags).join(', ')}
2. 标签应该简洁且相关
3. 支持使用嵌套标签（如：学科/内科/心血管），嵌套标签的每一级用 / 分隔
4. 只返回标签名称，用逗号分隔
5. 从不同角度思考，避免相似的标签

文档内容：${this.content.slice(0, 1500)}`;

      const newTags = await suggestTags(this.plugin, prompt);

      const filteredTags = newTags
        .filter((tag) => tag.trim().length > 0)
        .filter((tag) => !this.previousTags.has(tag))
        .filter(
          (tag) =>
            !Array.from(this.previousTags).some(
              (existing) =>
                tag === existing ||
                tag.split('/').includes(existing) ||
                existing.split('/').includes(tag) ||
                calculateSimilarity(tag, existing) > 0.7,
            ),
        );

      if (filteredTags.length >= count) {
        const finalTags = filteredTags.slice(0, count);
        this.tags = [...keptTags, ...finalTags];
        this.selectedTags = new Set();
        finalTags.forEach((tag) => this.previousTags.add(tag));
        this.updateDisplay();
        new Notice(`已替换 ${finalTags.length} 个标签`);
      } else {
        new Notice('无法生成足够的不同标签，已选标签保持不变');
      }
    } catch (e) {
      console.error('重新生成标签失败:', e);
      new Notice('重新生成标签失败: ' + (e as Error).message);
    }
  }

  private updateDisplay() {
    const { contentEl } = this;
    contentEl.empty();
    this.display();
  }

  onOpen() {
    this.display();
  }

  display() {
    const { contentEl } = this;

    contentEl.createEl('h2', { text: '推荐的标签' });
    contentEl.createEl('p', {
      text: '请选择要替换的标签，然后点击"重新生成"：',
      cls: 'tag-suggest-description',
    });

    const container = contentEl.createDiv({ cls: 'tag-suggest-container' });

    this.tags.forEach((tag) => {
      const item = container.createDiv({ cls: 'tag-suggest-item' });
      const checkbox = item.createEl('input', {
        type: 'checkbox',
        cls: 'tag-suggest-checkbox',
      });
      checkbox.checked = this.selectedTags.has(tag);

      const span = item.createSpan({
        text: tag,
        cls: 'tag-suggest-text' + (this.previousTags.has(tag) ? '' : ' tag-suggest-new'),
      });

      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selectedTags.add(tag);
        } else {
          this.selectedTags.delete(tag);
        }
      });
    });

    const buttons = contentEl.createDiv({ cls: 'tag-suggest-buttons' });

    buttons.createEl('button', { text: '重新生成', cls: 'tag-suggest-regenerate' })
      .addEventListener('click', () => this.regenerateTags());

    buttons.createEl('button', { text: '确认', cls: 'mod-cta' })
      .addEventListener('click', async () => {
        const tags = Array.from(this.selectedTags);
        this.close();
        try {
          await this.onConfirm(tags);
        } catch (e) {
          console.error('[TagSuggest] 确认标签时出错:', e);
        }
      });

    buttons.createEl('button', { text: '取消' })
      .addEventListener('click', () => this.close());
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
