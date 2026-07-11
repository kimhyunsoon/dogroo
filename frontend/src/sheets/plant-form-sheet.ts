import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens, ui, sheet } from '../style.js';
import { api, today } from '../api.js';
import { toast, uiConfirm } from '../ui.js';
import { icon } from '../icons.js';
import { POT_LABEL, previewRecommend, seasonLabel } from '../fmt.js';
import { POT_TYPES, type PlantDetail, type PotSize, type Species } from '../types.js';
import { SheetBase } from './sheet-base.js';
import { pickSpecies } from './species-picker-sheet.js';

type IntervalMode = 'auto' | 'manual';

// 식물 등록/수정 바텀시트. show()는 등록, show(id)는 수정
@customElement('plant-form-sheet')
export class PlantFormSheet extends SheetBase {
  static styles = [
    tokens,
    ui,
    sheet,
    css`
      form { display: flex; flex-direction: column; gap: 16px; padding-top: 4px; }
      label { display: block; font-size: 0.84rem; font-weight: 700; color: var(--text-sub); margin-bottom: 6px; }
      .select-btn {
        display: flex; justify-content: space-between; align-items: center;
        width: 100%; padding: 11px 12px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 10px;
        color: var(--text); font-size: 1rem;
      }
      .select-btn .placeholder { color: var(--text-sub); }
      .select-btn svg { color: var(--text-sub); }
      .seg-row { display: flex; align-items: center; gap: 10px; }
      .seg-row .segmented { width: 132px; flex-shrink: 0; }
      .seg-row .auto-info { flex: 1; font-size: 0.88rem; color: var(--text-sub); text-align: right; }
      .seg-row input { flex: 1; }
      .chips { display: flex; flex-wrap: wrap; gap: 7px; }
      .chips button {
        padding: 8px 13px; border-radius: 999px;
        background: var(--surface); border: 1px solid var(--border); color: var(--text-sub);
        font-size: 0.85rem;
      }
      .chips button.on { background: var(--green); border-color: var(--green); color: #fff; font-weight: 700; }
      .hint { font-size: 0.8rem; color: var(--text-sub); margin-top: 6px; }
      .photos { display: flex; gap: 8px; flex-wrap: wrap; }
      .photos .ph { position: relative; }
      .photos img { width: 72px; height: 72px; border-radius: 10px; object-fit: cover; display: block; }
      .photos img.primary { outline: 3px solid var(--green); }
      .photos .rm {
        position: absolute; top: -7px; right: -7px;
        width: 22px; height: 22px; border-radius: 50%;
        background: var(--danger); color: #fff;
        display: grid; place-items: center; padding: 0;
      }
      .add-photo {
        width: 72px; height: 72px; border-radius: 10px;
        border: 1.5px dashed var(--border); background: none;
        color: var(--text-sub);
        display: grid; place-items: center;
      }
      .archive { text-align: center; }
      .archive button { color: var(--danger); background: none; font-size: 0.88rem; padding: 8px; }
    `,
  ];

  @state() private plant: PlantDetail | null = null; // null = 신규 등록
  @state() private species: Species | null = null;
  @state() private potSize: PotSize = 'M';
  @state() private potType: string | null = null;
  @state() private startedAt = today();
  @state() private waterMode: IntervalMode = 'auto';
  @state() private repotMode: IntervalMode = 'auto';
  @state() private pendingPhoto: File | null = null;
  @state() private saving = false;

  private initialState = '';
  private skipGuard = false;

  protected get sheetTitle(): string {
    return this.plant ? '식물 수정' : '식물 등록';
  }

  async show(plantId?: number): Promise<void> {
    this.plant = null;
    this.species = null;
    this.potSize = 'M';
    this.potType = null;
    this.startedAt = today();
    this.waterMode = 'auto';
    this.repotMode = 'auto';
    this.pendingPhoto = null;
    this.skipGuard = false;
    if (plantId !== undefined) {
      const p = await api<PlantDetail>(`/api/plants/${plantId}`);
      this.plant = p;
      this.potSize = p.pot_size;
      this.potType = p.pot_type;
      this.startedAt = p.started_at?.slice(0, 10) ?? today();
      this.waterMode = p.water_interval_days ? 'manual' : 'auto';
      this.repotMode = p.repot_interval_months ? 'manual' : 'auto';
      this.species = p.species_id
        ? {
            id: p.species_id,
            name: p.species_name ?? '',
            name_en: p.species_name_en,
            group_name: p.group_name,
            water_summer_days: p.water_summer_days,
            water_winter_days: p.water_winter_days,
            repot_months: p.repot_months,
            memo: null,
          }
        : null;
    }
    this.openSheet();
    await this.updateComplete;
    this.initialState = this.snapshot();
  }

  // 이탈 가드용 현재 입력 상태 스냅샷
  private snapshot(): string {
    return JSON.stringify({
      name: this.field('name'),
      species: this.species?.id ?? null,
      started: this.startedAt,
      pot: this.potSize,
      potType: this.potType,
      waterMode: this.waterMode,
      repotMode: this.repotMode,
      water: this.field('water'),
      repot: this.field('repot'),
      memo: this.field('memo'),
      photo: this.pendingPhoto !== null,
    });
  }

  protected async shouldBlockClose(): Promise<boolean> {
    if (this.skipGuard || this.snapshot() === this.initialState) return false;
    const leave = await uiConfirm('저장하지 않은 변경사항이 있어요.\n그래도 나갈까요?', {
      confirmLabel: '나가기',
      cancelLabel: '계속 작성',
      danger: true,
    });
    return !leave;
  }

  private async reloadPlant(): Promise<void> {
    if (!this.plant) return;
    this.plant = await api<PlantDetail>(`/api/plants/${this.plant.id}`);
  }

  private field(name: string): string {
    return (this.renderRoot.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.value ?? '';
  }

  private async openSpeciesPicker(): Promise<void> {
    const picked = await pickSpecies();
    if (!picked) return;
    this.species = picked;
    // 이름이 비어있으면 별칭으로 자동완성
    const nameInput = this.renderRoot.querySelector('[name="name"]') as HTMLInputElement | null;
    if (nameInput && !nameInput.value.trim()) nameInput.value = picked.name;
  }

  private async save(e: Event): Promise<void> {
    e.preventDefault();
    if (this.saving) return;
    const name = this.field('name').trim();
    if (!name) {
      toast('이름을 입력해 주세요');
      return;
    }
    this.saving = true;
    try {
      const body = {
        name,
        species_id: this.species?.id ?? null,
        started_at: this.startedAt || null,
        pot_size: this.potSize,
        pot_type: this.potType,
        water_interval_days: this.waterMode === 'manual' ? Number(this.field('water')) || null : null,
        repot_interval_months: this.repotMode === 'manual' ? Number(this.field('repot')) || null : null,
        memo: this.field('memo') || null,
      };
      if (this.plant) {
        await api(`/api/plants/${this.plant.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        const res = await api<{ id: number }>('/api/plants', { method: 'POST', body: JSON.stringify(body) });
        if (this.pendingPhoto) await this.uploadFile(res.id, this.pendingPhoto);
      }
      this.dispatchEvent(new CustomEvent('saved'));
      this.skipGuard = true;
      this.requestClose();
      toast('저장했어요');
    } finally {
      this.saving = false;
    }
  }

  private async uploadFile(plantId: number, file: File): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    await api(`/api/plants/${plantId}/photos`, { method: 'POST', body: form });
  }

  private onPickPhoto(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (this.plant) {
      void this.uploadFile(this.plant.id, file).then(() => {
        void this.reloadPlant();
        this.dispatchEvent(new CustomEvent('saved'));
      });
    } else {
      this.pendingPhoto = file;
    }
    input.value = '';
  }

  private async removePhoto(photoId: number): Promise<void> {
    if (!(await uiConfirm('사진을 삭제할까요?', { confirmLabel: '삭제', danger: true }))) return;
    await api(`/api/photos/${photoId}`, { method: 'DELETE' });
    await this.reloadPlant();
    this.dispatchEvent(new CustomEvent('saved'));
  }

  private async setPrimary(photoId: number): Promise<void> {
    await api(`/api/photos/${photoId}/primary`, { method: 'POST' });
    await this.reloadPlant();
    this.dispatchEvent(new CustomEvent('saved'));
    toast('대표 사진으로 지정했어요');
  }

  private async toggleArchive(): Promise<void> {
    const p = this.plant;
    if (!p) return;
    const action = p.archived_at ? 'unarchive' : 'archive';
    if (
      action === 'archive' &&
      !(await uiConfirm(`${p.name}을(를) 보관할까요?\n목록에서 숨겨져요.`, { confirmLabel: '보관' }))
    ) {
      return;
    }
    await api(`/api/plants/${p.id}/${action}`, { method: 'POST' });
    this.dispatchEvent(new CustomEvent('saved'));
    this.skipGuard = true;
    this.requestClose();
  }

  // 시작일은 버튼 전체가 캘린더 트리거 (숨긴 date input의 피커를 연다)
  private openDatePicker(): void {
    const input = this.renderRoot.querySelector('#date-input') as
      | (HTMLInputElement & { showPicker?: () => void })
      | null;
    if (!input) return;
    try {
      input.showPicker?.();
    } catch {
      input.click();
    }
  }

  private renderIntervalRow(
    kind: 'water' | 'repot',
    label: string,
    unit: string,
    recommended: number,
  ): TemplateResult {
    const mode = kind === 'water' ? this.waterMode : this.repotMode;
    const setMode = (m: IntervalMode): void => {
      if (kind === 'water') this.waterMode = m;
      else this.repotMode = m;
    };
    const current = this.plant
      ? kind === 'water'
        ? this.plant.water_interval_days
        : this.plant.repot_interval_months
      : null;
    return html`
      <div>
        <label>${label}</label>
        <div class="seg-row">
          <div class="segmented">
            <button type="button" class=${mode === 'auto' ? 'on' : ''} @click=${(): void => setMode('auto')}>자동</button>
            <button type="button" class=${mode === 'manual' ? 'on' : ''} @click=${(): void => setMode('manual')}>직접</button>
          </div>
          ${mode === 'auto'
            ? html`<span class="auto-info">${seasonLabel()} · ${POT_LABEL[this.potSize]} 기준 ${recommended}${unit}</span>`
            : html`<input
                name=${kind}
                type="number" min="1" inputmode="numeric"
                .value=${String(current ?? '')}
                placeholder="${unit} 단위 숫자"
              >`}
        </div>
      </div>
    `;
  }

  protected renderBody(): TemplateResult {
    const p = this.plant;
    const rec = previewRecommend(this.species, this.potSize);
    return html`
      <form @submit=${this.save}>
        <div>
          <label>사진</label>
          <div class="photos">
            ${p?.photos.map(
              (ph) => html`
                <div class="ph">
                  <img
                    src="/api/files/${ph.path}"
                    class=${ph.is_primary ? 'primary' : ''}
                    alt=""
                    @click=${(): void => void this.setPrimary(ph.id)}
                  >
                  <button type="button" class="rm" @click=${(): void => void this.removePhoto(ph.id)}>${icon('x', 12)}</button>
                </div>
              `,
            ) ?? nothing}
            ${this.pendingPhoto
              ? html`
                  <div class="ph">
                    <img src=${URL.createObjectURL(this.pendingPhoto)} alt="">
                    <button type="button" class="rm" @click=${(): void => { this.pendingPhoto = null; }}>
                      ${icon('x', 12)}
                    </button>
                  </div>
                `
              : nothing}
            <button type="button" class="add-photo" @click=${(): void => {
              (this.renderRoot.querySelector('#photo-input') as HTMLInputElement).click();
            }}>${icon('camera', 24)}</button>
            <input id="photo-input" type="file" accept="image/*" hidden @change=${this.onPickPhoto}>
          </div>
          ${p ? html`<div class="hint">사진을 누르면 대표 사진이 돼요</div>` : nothing}
        </div>

        <div>
          <label>종류</label>
          <button type="button" class="select-btn" @click=${(): void => void this.openSpeciesPicker()}>
            ${this.species
              ? html`<span>${this.species.name}${this.species.name_en
                  ? html` <span class="sub" style="font-style:italic">${this.species.name_en}</span>`
                  : nothing}</span>`
              : html`<span class="placeholder">종류 선택</span>`}
            ${icon('chevron-right', 18)}
          </button>
        </div>

        <div>
          <label>이름</label>
          <input name="name" required .value=${p?.name ?? ''} placeholder="부르는 이름">
        </div>

        <div>
          <label>키우기 시작한 날</label>
          <button type="button" class="select-btn" @click=${(): void => this.openDatePicker()}>
            <span>${this.startedAt}</span>
            ${icon('calendar', 18)}
          </button>
          <input
            id="date-input"
            type="date"
            .value=${this.startedAt}
            style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none"
            tabindex="-1"
            @change=${(e: Event): void => {
              this.startedAt = (e.target as HTMLInputElement).value || today();
            }}
          >
        </div>

        <div>
          <label>화분 크기</label>
          <div class="segmented">
            ${(['S', 'M', 'L'] as PotSize[]).map(
              (size) => html`
                <button
                  type="button"
                  class=${this.potSize === size ? 'on' : ''}
                  @click=${(): void => { this.potSize = size; }}
                >${POT_LABEL[size]}</button>
              `,
            )}
          </div>
        </div>

        <div>
          <label>화분 재질</label>
          <div class="chips">
            ${POT_TYPES.map(
              (type) => html`
                <button
                  type="button"
                  class=${this.potType === type ? 'on' : ''}
                  @click=${(): void => { this.potType = this.potType === type ? null : type; }}
                >${type}</button>
              `,
            )}
          </div>
        </div>

        ${this.renderIntervalRow('water', '물주기 주기', '일', rec.water)}
        ${this.renderIntervalRow('repot', '분갈이 주기', '개월', rec.repot)}

        <div>
          <label>메모</label>
          <textarea name="memo" rows="2" .value=${p?.memo ?? ''}></textarea>
        </div>

        <button type="submit" class="btn-primary" ?disabled=${this.saving}>저장</button>

        ${p
          ? html`
              <div class="archive">
                <button type="button" @click=${(): void => void this.toggleArchive()}>
                  ${p.archived_at ? '보관 해제' : '보관하기'}
                </button>
              </div>
            `
          : nothing}
      </form>
    `;
  }
}
