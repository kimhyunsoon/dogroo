import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens, ui } from '../style.js';
import { api } from '../api.js';
import { toast } from '../ui.js';
import { icon } from '../icons.js';
import type { PlantSummary } from '../types.js';
import type { PlantItem } from '../components/plant-item.js';
import type { PlantFormSheet } from '../sheets/plant-form-sheet.js';
import '../components/plant-item.js';
import '../sheets/plant-form-sheet.js';
import { groupPlants, sortGroups } from './today-view.js';

type SortKey = 'group' | 'water' | 'name';

// 식물 탭 - 전체 목록 (그룹/물주기/이름 정렬, 검색, 보관, 등록)
@customElement('plants-view')
export class PlantsView extends LitElement {
  static styles = [
    tokens,
    ui,
    css`
      :host { display: block; min-height: 100dvh; background: var(--bg); padding-bottom: calc(140px + env(safe-area-inset-bottom)); }
      .top {
        position: sticky; top: 0; z-index: 5;
        background: var(--bg);
        padding: calc(12px + env(safe-area-inset-top)) 16px 10px;
        border-bottom: 1px solid var(--border);
      }
      .title-row { display: flex; align-items: center; gap: 4px; }
      .title-row h1 { font-size: 1.15rem; margin: 0; flex: 1; }
      .title-row button {
        color: var(--text-sub); background: none; padding: 7px;
        display: grid; place-items: center;
      }
      .title-row button.on { color: var(--green); }
      .search-row { padding-top: 8px; }
      .sort-row { display: flex; align-items: center; gap: 8px; padding-top: 8px; }
      .sort-row .segmented { flex: 1; }
      .archived-toggle {
        display: flex; align-items: center; gap: 3px;
        background: none; color: var(--text-sub);
        font-size: 0.76rem; padding: 5px 6px;
      }
      .archived-toggle.on { color: var(--green); font-weight: 700; }
      .group-head {
        display: flex; align-items: baseline; gap: 6px;
        margin: 14px 16px 2px;
        font-size: 0.8rem; font-weight: 700; color: var(--green);
      }
      .group-head .count { color: var(--text-sub); font-weight: 400; }
      .empty { text-align: center; color: var(--text-sub); padding: 48px 16px; }
      .fab {
        position: fixed; right: 18px; bottom: calc(76px + env(safe-area-inset-bottom));
        width: 54px; height: 54px; border-radius: 50%;
        background: var(--green); color: #fff;
        display: grid; place-items: center;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
        z-index: 40;
      }
      .ptr { text-align: center; color: var(--text-sub); font-size: 0.76rem; overflow: hidden; height: 0; transition: height 0.15s; }
      .ptr.show { height: 28px; padding-top: 8px; }
      .sk-row { display: flex; gap: 10px; padding: 9px 16px; align-items: center; }
      .sk-thumb { width: 46px; height: 46px; flex-shrink: 0; }
      .sk-lines { flex: 1; display: flex; flex-direction: column; gap: 6px; }
      .sk-line { height: 11px; }
    `,
  ];

  @state() private plants: PlantSummary[] = [];
  @state() private loaded = false;
  @state() private q = '';
  @state() private searchOpen = false;
  @state() private sort: SortKey = 'group';
  @state() private includeArchived = false;
  @state() private pulling = false;

  private touchStartY = 0;

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load(): Promise<void> {
    const query = this.includeArchived ? '?archived=1' : '';
    this.plants = await api<PlantSummary[]>(`/api/plants${query}`);
    this.loaded = true;
  }

  private get visible(): PlantSummary[] {
    const q = this.q.trim().toLowerCase();
    return this.plants.filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.species_name ?? '').toLowerCase().includes(q) ||
        (p.species_name_en ?? '').toLowerCase().includes(q),
    );
  }

  private async onWater(e: Event): Promise<void> {
    const plant = (e.target as PlantItem).plant;
    const date = (e as CustomEvent<{ date?: string }>).detail?.date;
    const res = await api<{ id: number }>(`/api/plants/${plant.id}/waterings`, {
      method: 'POST',
      body: JSON.stringify(date ? { watered_at: date } : {}),
    });
    await this.load();
    toast(`${plant.name} 물주기 완료`, {
      actionLabel: '취소',
      onAction: () => {
        void api(`/api/waterings/${res.id}`, { method: 'DELETE' }).then(() => this.load());
      },
    });
  }

  private openForm(plantId?: number): void {
    const form = this.renderRoot.querySelector('plant-form-sheet') as PlantFormSheet;
    void form.show(plantId);
  }

  // 당겨서 새로고침 (문서 최상단에서만)
  private onTouchStart = (e: TouchEvent): void => {
    this.touchStartY = window.scrollY === 0 ? (e.touches[0]?.clientY ?? 0) : -1;
  };
  private onTouchMove = (e: TouchEvent): void => {
    if (this.touchStartY < 0) return;
    this.pulling = (e.touches[0]?.clientY ?? 0) - this.touchStartY > 70;
  };
  private onTouchEnd = (): void => {
    if (this.pulling) {
      this.pulling = false;
      void this.load().then(() => toast('새로고침 완료', { duration: 1200 }));
    }
    this.touchStartY = -1;
  };

  private renderItem(p: PlantSummary): TemplateResult {
    return html`
      <plant-item
        .plant=${p}
        @open=${(): void => { location.hash = `#/plants/${p.id}`; }}
        @edit=${(e: Event): void => this.openForm((e.target as PlantItem).plant.id)}
        @water=${this.onWater}
      ></plant-item>
    `;
  }

  private renderList(): TemplateResult {
    const visible = this.visible;
    if (visible.length === 0) {
      return html`<div class="empty">표시할 식물이 없어요 🌱</div>`;
    }
    if (this.sort === 'group') {
      const groups = groupPlants(
        [...visible].sort((a, b) => (a.water_dday ?? 9999) - (b.water_dday ?? 9999)),
      );
      const names = sortGroups([...groups.keys()]);
      return html`${names.map(
        (g) => html`
          <div class="group-head">${g} <span class="count">${groups.get(g)!.length}</span></div>
          ${groups.get(g)!.map((p) => this.renderItem(p))}
        `,
      )}`;
    }
    const sorted =
      this.sort === 'water'
        ? [...visible].sort((a, b) => (a.water_dday ?? 9999) - (b.water_dday ?? 9999))
        : [...visible].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return html`${sorted.map((p) => this.renderItem(p))}`;
  }

  private renderSkeleton(): TemplateResult {
    return html`${[1, 2, 3, 4, 5, 6].map(
      () => html`
        <div class="sk-row">
          <div class="skeleton sk-thumb"></div>
          <div class="sk-lines">
            <div class="skeleton sk-line" style="width: 40%"></div>
            <div class="skeleton sk-line" style="width: 65%"></div>
          </div>
        </div>
      `,
    )}`;
  }

  render(): TemplateResult {
    return html`
      <div
        @touchstart=${this.onTouchStart}
        @touchmove=${this.onTouchMove}
        @touchend=${this.onTouchEnd}
      >
        <div class="top">
          <div class="title-row">
            <h1>식물 ${this.loaded ? this.visible.length : ''}</h1>
            <button aria-label="검색" class=${this.searchOpen ? 'on' : ''} @click=${(): void => {
              this.searchOpen = !this.searchOpen;
              if (!this.searchOpen) this.q = '';
            }}>${icon(this.searchOpen ? 'x' : 'search')}</button>
          </div>
          ${this.searchOpen
            ? html`
                <div class="search-row">
                  <input
                    type="search"
                    placeholder="이름·별칭·학명으로 검색"
                    .value=${this.q}
                    @input=${(e: Event): void => { this.q = (e.target as HTMLInputElement).value; }}
                  >
                </div>
              `
            : nothing}
          <div class="sort-row">
            <div class="segmented">
              ${([['group', '그룹'], ['water', '물주기'], ['name', '이름']] as [SortKey, string][]).map(
                ([key, label]) => html`
                  <button class=${this.sort === key ? 'on' : ''} @click=${(): void => { this.sort = key; }}>
                    ${label}
                  </button>
                `,
              )}
            </div>
            <button
              class="archived-toggle ${this.includeArchived ? 'on' : ''}"
              @click=${(): void => {
                this.includeArchived = !this.includeArchived;
                void this.load();
              }}
            >${icon('archive', 13)} 보관</button>
          </div>
        </div>
        <div class="ptr ${this.pulling ? 'show' : ''}">놓으면 새로고침</div>

        ${this.loaded ? this.renderList() : this.renderSkeleton()}

        <button class="fab" aria-label="식물 추가" @click=${(): void => this.openForm()}>${icon('plus', 26)}</button>
        <plant-form-sheet @saved=${(): void => void this.load()}></plant-form-sheet>
      </div>
    `;
  }
}
