import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens, ui, sheet } from '../style.js';
import { api } from '../api.js';
import { SheetBase } from './sheet-base.js';
import type { Species } from '../types.js';

// 식물 풀에서 종류 선택 (별칭·학명 검색)
@customElement('species-picker-sheet')
export class SpeciesPickerSheet extends SheetBase {
  static styles = [
    tokens,
    ui,
    sheet,
    css`
      ul { list-style: none; margin: 0; padding: 0; }
      li button {
        display: flex; justify-content: space-between; align-items: center; gap: 10px;
        width: 100%; text-align: left;
        padding: 11px 4px;
        background: none;
        border-bottom: 1px solid var(--border);
        color: var(--text);
      }
      .names { min-width: 0; }
      .names .ko { font-size: 0.92rem; }
      .names .sci {
        font-size: 0.74rem; font-style: italic; color: var(--text-sub);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .info { color: var(--text-sub); font-size: 0.74rem; flex-shrink: 0; text-align: right; }
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
          placeholder="별칭이나 학명으로 검색"
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
                <span class="names">
                  <div class="ko">${s.name}</div>
                  ${s.name_en ? html`<div class="sci">${s.name_en}</div>` : nothing}
                </span>
                <span class="info">
                  ${s.group_name ?? ''}
                  ${s.water_summer_days ? html`<br>여름 ${s.water_summer_days}일 · 겨울 ${s.water_winter_days}일` : nothing}
                </span>
              </button>
            </li>
          `,
        )}
      </ul>
      ${this.results.length === 0 ? html`<div class="empty">검색 결과가 없어요</div>` : nothing}
    `;
  }
}

// 전역 싱글턴 - 어느 화면·시트에서든 pickSpecies()로 사용
// (body 직속이라 이중 모달이어도 dim이 항상 화면 전체를 덮는다)
let instance: SpeciesPickerSheet | null = null;

export function pickSpecies(): Promise<Species | null> {
  if (!instance) {
    instance = document.createElement('species-picker-sheet') as SpeciesPickerSheet;
    document.body.appendChild(instance);
  }
  return instance.show();
}
