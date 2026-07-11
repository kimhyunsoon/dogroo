import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { tokens, ui } from '../style.js';
import { today } from '../api.js';
import { Press } from '../ui.js';
import { icon } from '../icons.js';
import { pickBackfillDate } from '../sheets/backfill-sheet.js';
import { fmtRel, abbrevSci } from '../fmt.js';
import type { PlantSummary } from '../types.js';

// 목록 공용 아이템 (kind: 물주기/분갈이 - 오늘 탭 분갈이 섹션은 repot)
// 탭 → open / 길게 → edit / 완료 버튼 탭 → complete {kind} / 길게 → 날짜 선택 후 complete {kind, date}
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
      .act {
        flex-shrink: 0;
        width: 42px; height: 42px; border-radius: 13px;
        display: grid; place-items: center;
        background: var(--green-soft); color: var(--green);
      }
      .act.due { background: var(--green); color: #fff; }
      /* 오늘 이미 완료 - 다시 누르고 싶지 않게 가시성을 낮춘다 (재탭 = 오늘 기록 취소) */
      .act.done { background: transparent; border: 1px dashed var(--border); color: var(--text-sub); opacity: 0.45; }
    `,
  ];

  @property({ attribute: false }) plant!: PlantSummary;
  @property() kind: 'water' | 'repot' = 'water';
  @property({ type: Boolean, reflect: true }) leaving = false;

  private emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private bodyGesture = new Press(
    () => this.emit('open'),
    () => this.emit('edit'),
  );

  private actGesture = new Press(
    () => this.emit('complete', { kind: this.kind }),
    () => {
      void pickBackfillDate().then((date) => {
        if (date) this.emit('complete', { kind: this.kind, date });
      });
    },
  );

  render(): TemplateResult {
    const p = this.plant;
    const base = today();
    const water = fmtRel(p.last_watered_at, base);
    const repot = fmtRel(p.last_repotted_at, base);
    const sci = abbrevSci(p.species_name_en);
    // 이름이 별칭 그대로면 별칭 중복 표시를 생략
    const alias = p.species_name && p.species_name !== p.name ? p.species_name : null;
    const dday = this.kind === 'water' ? p.water_dday : p.repot_dday;
    const last = this.kind === 'water' ? p.last_watered_at : p.last_repotted_at;
    const doneToday = last?.slice(0, 10) === base;
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
          <div class="last">
            💧 ${water ?? '기록 없음'}${repot ? ` · 🪴 ${repot}` : ''}
          </div>
        </div>
        ${doneToday
          ? html`
              <button
                class="act done"
                aria-label=${this.kind === 'water' ? '오늘 물주기 취소' : '오늘 분갈이 취소'}
                @pointerdown=${(e: Event): void => e.stopPropagation()}
                @click=${(e: Event): void => {
                  e.stopPropagation();
                  this.emit('undo', { kind: this.kind });
                }}
              >${icon('check', 20)}</button>
            `
          : html`
              <button
                class="act ${dday !== null && dday <= 0 ? 'due' : ''}"
                aria-label=${this.kind === 'water' ? '물주기 완료' : '분갈이 완료'}
                @pointerdown=${(e: Event): void => { e.stopPropagation(); this.actGesture.down(e as PointerEvent); }}
                @pointermove=${this.actGesture.move}
                @pointerup=${this.actGesture.up}
                @pointercancel=${this.actGesture.up}
                @click=${(e: Event): void => { e.stopPropagation(); this.actGesture.click(e); }}
              >${icon(this.kind === 'water' ? 'droplet' : 'sprout', 21)}</button>
            `}
      </div>
    `;
  }
}
