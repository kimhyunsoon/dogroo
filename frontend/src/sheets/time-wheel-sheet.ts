import { html, css, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { tokens, ui, sheet } from '../style.js';
import { SheetBase } from './sheet-base.js';

const ITEM_H = 40;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 10, 20, 30, 40, 50];

// 애플 피커 스타일 시/분 휠 (분은 10분 단위). show('08:00') → 'HH:MM' | null
@customElement('time-wheel-sheet')
export class TimeWheelSheet extends SheetBase {
  static styles = [
    tokens,
    ui,
    sheet,
    css`
      .wheels {
        position: relative;
        display: flex;
        justify-content: center;
        gap: 8px;
        padding: 6px 0 14px;
      }
      .wheel {
        height: ${ITEM_H * 5}px;
        width: 84px;
        overflow-y: auto;
        scroll-snap-type: y mandatory;
        scrollbar-width: none;
      }
      .wheel::-webkit-scrollbar { display: none; }
      .wheel .pad { height: ${ITEM_H * 2}px; }
      .wheel .item {
        height: ${ITEM_H}px;
        scroll-snap-align: center;
        display: grid;
        place-items: center;
        font-size: 1.25rem;
        font-variant-numeric: tabular-nums;
      }
      .indicator {
        position: absolute;
        left: 50%;
        top: ${6 + ITEM_H * 2}px;
        transform: translateX(-50%);
        width: 200px;
        height: ${ITEM_H}px;
        border-radius: 10px;
        background: color-mix(in srgb, var(--green) 10%, transparent);
        pointer-events: none;
      }
      .colon {
        align-self: center;
        font-size: 1.3rem;
        font-weight: 700;
        padding-bottom: 8px;
      }
    `,
  ];

  protected get sheetTitle(): string {
    return '알림 시각';
  }

  private initial = '08:00';
  private picked: string | null = null;
  private resolveFn?: (value: string | null) => void;

  show(current: string): Promise<string | null> {
    this.initial = current;
    this.picked = null;
    this.openSheet();
    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  protected onClosed(): void {
    this.resolveFn?.(this.picked);
  }

  // 열릴 때 현재 값 위치로 스크롤
  protected updated(): void {
    if (!this.open) return;
    const hourEl = this.renderRoot.querySelector<HTMLElement>('.wheel.hours');
    const minEl = this.renderRoot.querySelector<HTMLElement>('.wheel.minutes');
    if (hourEl && hourEl.dataset.scrolled !== '1') {
      hourEl.dataset.scrolled = '1';
      const parts = this.initial.split(':');
      hourEl.scrollTop = Number(parts[0] ?? 8) * ITEM_H;
      const minIdx = Math.round(Number(parts[1] ?? 0) / 10);
      if (minEl) minEl.scrollTop = Math.min(minIdx, MINUTES.length - 1) * ITEM_H;
    }
  }

  private confirm(): void {
    const hourEl = this.renderRoot.querySelector<HTMLElement>('.wheel.hours');
    const minEl = this.renderRoot.querySelector<HTMLElement>('.wheel.minutes');
    const h = Math.min(23, Math.max(0, Math.round((hourEl?.scrollTop ?? 0) / ITEM_H)));
    const mIdx = Math.min(MINUTES.length - 1, Math.max(0, Math.round((minEl?.scrollTop ?? 0) / ITEM_H)));
    this.picked = `${String(h).padStart(2, '0')}:${String(MINUTES[mIdx]).padStart(2, '0')}`;
    this.requestClose();
  }

  protected renderBody(): TemplateResult {
    return html`
      <div class="wheels">
        <div class="indicator"></div>
        <div class="wheel hours">
          <div class="pad"></div>
          ${HOURS.map((h) => html`<div class="item">${String(h).padStart(2, '0')}</div>`)}
          <div class="pad"></div>
        </div>
        <div class="colon">:</div>
        <div class="wheel minutes">
          <div class="pad"></div>
          ${MINUTES.map((m) => html`<div class="item">${String(m).padStart(2, '0')}</div>`)}
          <div class="pad"></div>
        </div>
      </div>
      <button class="btn-primary" @click=${this.confirm}>완료</button>
    `;
  }
}
