import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { tokens, ui } from '../style.js';
import { today } from '../api.js';
import { Press } from '../ui.js';
import { pickBackfillDate } from '../sheets/backfill-sheet.js';
import { waterBadge, fmtRelDays, abbrevSci } from '../fmt.js';
import type { PlantSummary } from '../types.js';

// 목록 공용 아이템
// 탭 → open 이벤트 / 길게 → edit 이벤트 / 물주기 탭 → water / 물주기 길게 → 날짜 선택 후 water
@customElement('plant-item')
export class PlantItem extends LitElement {
  static styles = [
    tokens,
    ui,
    css`
      :host {
        display: block;
        overflow: hidden;
        max-height: 110px;
        transition: max-height 0.3s ease, opacity 0.3s ease;
      }
      :host([leaving]) {
        max-height: 0;
        opacity: 0;
      }
      .row {
        display: flex; align-items: center; gap: 10px;
        padding: 9px 16px;
        border-bottom: 1px solid var(--border);
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
      }
      .thumb {
        width: 46px; height: 46px; border-radius: 10px; object-fit: cover;
        background: var(--green-soft); flex-shrink: 0;
        display: grid; place-items: center; font-size: 1.2rem;
      }
      .info { flex: 1; min-width: 0; }
      .name { font-weight: 700; font-size: 0.92rem; }
      .species {
        color: var(--text-sub); font-size: 0.74rem;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .species .sci { font-style: italic; }
      .last { color: var(--text-sub); font-size: 0.74rem; margin-top: 1px; }
      .right {
        display: flex; flex-direction: column; align-items: flex-end; gap: 5px;
        flex-shrink: 0;
      }
      .btn-soft { padding: 7px 12px; font-size: 0.82rem; }
    `,
  ];

  @property({ attribute: false }) plant!: PlantSummary;
  @property({ type: Boolean, reflect: true }) leaving = false;

  private emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private bodyGesture = new Press(
    () => this.emit('open'),
    () => this.emit('edit'),
  );

  private waterGesture = new Press(
    () => this.emit('water', {}),
    () => {
      void pickBackfillDate().then((date) => {
        if (date) this.emit('water', { date });
      });
    },
  );

  render(): TemplateResult {
    const p = this.plant;
    const badge = waterBadge(p);
    const last = fmtRelDays(p.last_watered_at, today());
    const sci = abbrevSci(p.species_name_en);
    // 이름이 별칭 그대로면 별칭 중복 표시를 생략
    const alias = p.species_name && p.species_name !== p.name ? p.species_name : null;
    return html`
      <div
        class="row"
        @pointerdown=${this.bodyGesture.down}
        @pointermove=${this.bodyGesture.move}
        @pointerup=${this.bodyGesture.up}
        @pointercancel=${this.bodyGesture.up}
        @click=${this.bodyGesture.click}
      >
        ${p.photo
          ? html`<img class="thumb" src="/api/files/${p.photo}" alt="" loading="lazy">`
          : html`<div class="thumb">🪴</div>`}
        <div class="info">
          <div class="name">${p.name}${p.archived_at ? html` <span class="sub">(보관)</span>` : nothing}</div>
          ${alias || sci
            ? html`
                <div class="species">
                  ${alias ?? nothing}${alias && sci ? ' · ' : nothing}${sci
                    ? html`<span class="sci">${sci}</span>`
                    : nothing}
                </div>
              `
            : p.species_name
              ? nothing
              : html`<div class="species">종류 미지정</div>`}
          <div class="last">💧 ${last ? `${last}에 줌` : '기록 없음'}</div>
        </div>
        <div
          class="right"
          @click=${(e: Event): void => e.stopPropagation()}
          @pointerdown=${(e: Event): void => e.stopPropagation()}
        >
          ${badge ? html`<span class="badge ${badge.cls}">${badge.label}</span>` : nothing}
          <button
            class="btn-soft"
            @pointerdown=${this.waterGesture.down}
            @pointermove=${this.waterGesture.move}
            @pointerup=${this.waterGesture.up}
            @pointercancel=${this.waterGesture.up}
            @click=${this.waterGesture.click}
          >물주기</button>
        </div>
      </div>
    `;
  }
}
