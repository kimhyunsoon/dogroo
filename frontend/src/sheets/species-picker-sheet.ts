import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens, ui, sheet } from '../style.js';
import { api } from '../api.js';
import { SheetBase } from './sheet-base.js';
import type { Species } from '../types.js';

// 식물 풀에서 종류 선택 (한글·영문 검색)
@customElement('species-picker-sheet')
export class SpeciesPickerSheet extends SheetBase {
  static styles = [
    tokens,
    ui,
    sheet,
    css`
      ul { list-style: none; margin: 0; padding: 0; }
      li button {
        display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
        width: 100%; text-align: left;
        padding: 13px 4px;
        background: none;
        border-bottom: 1px solid var(--border);
        color: var(--text); font-size: 0.95rem;
      }
      li .info { color: var(--text-sub); font-size: 0.78rem; flex-shrink: 0; }
      .empty { text-align: center; color: var(--text-sub); padding: 30px 0; }
      .search-wrap { padding: 0 16px 10px; }
    `,
  ];

  @state() private results: Species[] = [];

  protected panelHeight = '78dvh';

  protected get sheetTitle(): string {
    return '종류 선택';
  }

  private picked: Species | null = null;
  private resolveFn?: (value: Species | null) => void;

  show(): Promise<Species | null> {
    this.picked = null;
    void this.search('');
    this.openSheet();
    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  protected onClosed(): void {
    this.resolveFn?.(this.picked);
  }

  private async search(q: string): Promise<void> {
    this.results = await api<Species[]>(`/api/species?q=${encodeURIComponent(q)}`);
  }

  private select(s: Species): void {
    this.picked = s;
    this.requestClose();
  }

  protected renderBelowHead(): TemplateResult {
    return html`
      <div class="search-wrap">
        <input
          type="search"
          placeholder="이름이나 영문명으로 검색"
          @input=${(e: Event): void => void this.search((e.target as HTMLInputElement).value)}
        >
      </div>
    `;
  }

  protected renderBody(): TemplateResult {
    return html`
      <ul>
        ${this.results.map(
          (s) => html`
            <li>
              <button @click=${(): void => this.select(s)}>
                <span>${s.name}</span>
                ${s.water_summer_days
                  ? html`<span class="info">여름 ${s.water_summer_days}일 · 겨울 ${s.water_winter_days}일</span>`
                  : nothing}
              </button>
            </li>
          `,
        )}
      </ul>
      ${this.results.length === 0 ? html`<div class="empty">검색 결과가 없어요</div>` : nothing}
    `;
  }
}
