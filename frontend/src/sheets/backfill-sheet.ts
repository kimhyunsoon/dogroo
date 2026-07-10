import { html, css, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { tokens, ui, sheet } from '../style.js';
import { addDays, today } from '../api.js';
import { SheetBase } from './sheet-base.js';

// 지난 날짜로 기록하기 - 오늘 ~ 5일 전 선택
@customElement('backfill-sheet')
export class BackfillSheet extends SheetBase {
  static styles = [
    tokens,
    ui,
    sheet,
    css`
      .day {
        display: flex;
        justify-content: space-between;
        width: 100%;
        padding: 14px 4px;
        background: none;
        border-bottom: 1px solid var(--border);
        color: var(--text);
        font-size: 1rem;
        font-weight: 600;
      }
      .day .sub { font-weight: 400; }
      .day:last-of-type { border-bottom: none; }
    `,
  ];

  protected get sheetTitle(): string {
    return '기록할 날짜';
  }

  private picked: string | null = null;
  private resolveFn?: (value: string | null) => void;

  show(): Promise<string | null> {
    this.picked = null;
    this.openSheet();
    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  protected onClosed(): void {
    this.resolveFn?.(this.picked);
  }

  protected renderBody(): TemplateResult {
    const labels = ['어제', '그저께', '3일 전', '4일 전', '5일 전', '6일 전', '7일 전'];
    const base = today();
    return html`
      ${labels.map((label, i) => {
        const date = addDays(base, -(i + 1));
        return html`
          <button class="day" @click=${(): void => {
            this.picked = date;
            this.requestClose();
          }}>
            <span>${label}</span>
            <span class="sub">${date.slice(5).replace('-', '/')}</span>
          </button>
        `;
      })}
    `;
  }
}

// 전역 싱글턴 - 어느 화면에서든 pickBackfillDate()로 사용
let instance: BackfillSheet | null = null;

export function pickBackfillDate(): Promise<string | null> {
  if (!instance) {
    instance = document.createElement('backfill-sheet') as BackfillSheet;
    document.body.appendChild(instance);
  }
  return instance.show();
}
