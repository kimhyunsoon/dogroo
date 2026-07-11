import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens, ui } from '../style.js';
import { api } from '../api.js';
import { toast } from '../ui.js';
import { icon } from '../icons.js';
import { parseHash, replaceHashQuery } from '../router.js';
import { cachedPlants, loadPlants, refreshPlants } from '../store.js';
import type { PlantSummary } from '../types.js';
import type { PlantItem } from '../components/plant-item.js';
import type { PlantFormSheet } from '../sheets/plant-form-sheet.js';
import '../components/plant-item.js';
import '../sheets/plant-form-sheet.js';
import { groupPlants, sortGroups } from './today-view.js';

type ViewMode = 'group' | 'list';
type SortKey = 'name' | 'water' | 'together' | 'repot';
type Dir = 'asc' | 'desc';

const STATE_KEY = 'groo:plants-state';
const SORTS: { key: SortKey; label: string; defaultDir: Dir }[] = [
  { key: 'name', label: '이름', defaultDir: 'asc' },
  { key: 'water', label: '물 준 지', defaultDir: 'asc' }, // asc = 오래된 순
  { key: 'together', label: '함께한 지', defaultDir: 'asc' }, // asc = 오래 키운 순
  { key: 'repot', label: '분갈이', defaultDir: 'desc' }, // desc = 최근 순
];

// null(기록 없음)은 방향과 무관하게 항상 마지막
function cmpDate(a: string | null, b: string | null, dir: Dir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
}

// 식물 탭 - 전체 목록 (그룹/목록 모드, 목록은 단독 정렬 4종 + 방향 토글, 검색, 보관, 등록)
// 모드·정렬은 해시 쿼리와 localStorage에 기록되어 상세→뒤로가기·재접속에도 보존된다
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
      .mode-row { display: flex; align-items: center; gap: 8px; padding-top: 8px; }
      .mode-row .segmented { flex: 1; }
      .archived-toggle {
        display: flex; align-items: center; gap: 3px;
        background: none; color: var(--text-sub);
        font-size: 0.76rem; padding: 5px 6px;
      }
      .archived-toggle.on { color: var(--green); font-weight: 700; }
      .sort-row { display: flex; gap: 6px; padding-top: 8px; overflow-x: auto; scrollbar-width: none; }
      .sort-row::-webkit-scrollbar { display: none; }
      .sort-chip {
        display: flex; align-items: center; gap: 3px;
        padding: 6px 11px; border-radius: 999px;
        background: var(--green-soft); color: var(--text-sub);
        font-size: 0.78rem; white-space: nowrap; flex-shrink: 0;
      }
      .sort-chip.on { background: var(--green); color: #fff; font-weight: 700; }
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
  @state() private view: ViewMode = 'group';
  @state() private sort: SortKey = 'name';
  @state() private sortDir: Dir = 'asc';
  @state() private includeArchived = false;
  @state() private pulling = false;

  private touchStartY = 0;

  connectedCallback(): void {
    super.connectedCallback();
    this.restoreState();
    const cached = cachedPlants(this.query);
    if (cached) {
      this.plants = cached;
      this.loaded = true;
    }
    void this.load();
  }

  private get query(): string {
    return this.includeArchived ? '?archived=1' : '';
  }

  // 복원 우선순위: 해시 쿼리 > localStorage > 기본(그룹)
  private restoreState(): void {
    const { params } = parseHash(location.hash);
    let state: { view?: string; sort?: string; dir?: string } = {};
    if (params.has('view')) {
      state = { view: params.get('view')!, sort: params.get('sort') ?? '', dir: params.get('dir') ?? '' };
    } else {
      try {
        state = JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') as typeof state;
      } catch {
        state = {};
      }
    }
    if (state.view === 'list') this.view = 'list';
    const sort = SORTS.find((s) => s.key === state.sort);
    if (sort) {
      this.sort = sort.key;
      this.sortDir = state.dir === 'desc' ? 'desc' : state.dir === 'asc' ? 'asc' : sort.defaultDir;
    }
    this.syncState();
  }

  // 현재 상태를 해시 쿼리(replaceState)와 localStorage에 반영
  private syncState(): void {
    const isList = this.view === 'list';
    replaceHashQuery('#/plants', {
      view: isList ? 'list' : null,
      sort: isList ? this.sort : null,
      dir: isList ? this.sortDir : null,
    });
    localStorage.setItem(STATE_KEY, JSON.stringify({ view: this.view, sort: this.sort, dir: this.sortDir }));
  }

  private setView(view: ViewMode): void {
    this.view = view;
    this.syncState();
  }

  private setSort(key: SortKey): void {
    if (this.sort === key) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'; // 활성 칩 재탭 = 방향 반전
    } else {
      this.sort = key;
      this.sortDir = SORTS.find((s) => s.key === key)!.defaultDir;
    }
    this.syncState();
  }

  private async load(): Promise<void> {
    this.plants = await loadPlants(this.query);
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

  private async onComplete(e: Event): Promise<void> {
    const plant = (e.target as PlantItem).plant;
    const { kind, date } = (e as CustomEvent<{ kind: 'water' | 'repot'; date?: string }>).detail;
    const isWater = kind === 'water';
    const url = `/api/plants/${plant.id}/${isWater ? 'waterings' : 'repottings'}`;
    const body = date ? (isWater ? { watered_at: date } : { repotted_at: date }) : {};
    const res = await api<{ id: number }>(url, { method: 'POST', body: JSON.stringify(body) });
    await this.load();
    void refreshPlants();
    toast(`${plant.name} ${isWater ? '물주기' : '분갈이'} 완료`, {
      actionLabel: '취소',
      onAction: () => {
        void api(`/api/${isWater ? 'waterings' : 'repottings'}/${res.id}`, { method: 'DELETE' })
          .then(() => this.load())
          .then(() => refreshPlants());
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
        @complete=${this.onComplete}
      ></plant-item>
    `;
  }

  private renderList(): TemplateResult {
    const visible = this.visible;
    if (visible.length === 0) {
      return html`<div class="empty">표시할 식물이 없어요 🌱</div>`;
    }
    if (this.view === 'group') {
      const groups = groupPlants(
        [...visible].sort((a, b) => cmpDate(a.last_watered_at, b.last_watered_at, 'asc')),
      );
      const names = sortGroups([...groups.keys()]);
      return html`${names.map(
        (g) => html`
          <div class="group-head">${g} <span class="count">${groups.get(g)!.length}</span></div>
          ${groups.get(g)!.map((p) => this.renderItem(p))}
        `,
      )}`;
    }
    const dir = this.sortDir;
    const sorted = [...visible].sort((a, b) => {
      switch (this.sort) {
        case 'water': return cmpDate(a.last_watered_at, b.last_watered_at, dir);
        case 'together': return cmpDate(a.started_at, b.started_at, dir);
        case 'repot': return cmpDate(a.last_repotted_at, b.last_repotted_at, dir);
        default: {
          const cmp = a.name.localeCompare(b.name, 'ko');
          return dir === 'asc' ? cmp : -cmp;
        }
      }
    });
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
          <div class="mode-row">
            <div class="segmented">
              <button class=${this.view === 'group' ? 'on' : ''} @click=${(): void => this.setView('group')}>그룹</button>
              <button class=${this.view === 'list' ? 'on' : ''} @click=${(): void => this.setView('list')}>목록</button>
            </div>
            <button
              class="archived-toggle ${this.includeArchived ? 'on' : ''}"
              @click=${(): void => {
                this.includeArchived = !this.includeArchived;
                void this.load();
              }}
            >${icon('archive', 13)} 보관</button>
          </div>
          ${this.view === 'list'
            ? html`
                <div class="sort-row">
                  ${SORTS.map(
                    (s) => html`
                      <button class="sort-chip ${this.sort === s.key ? 'on' : ''}" @click=${(): void => this.setSort(s.key)}>
                        ${s.label}
                        ${this.sort === s.key ? icon(this.sortDir === 'asc' ? 'arrow-up' : 'arrow-down', 12) : nothing}
                      </button>
                    `,
                  )}
                </div>
              `
            : nothing}
        </div>
        <div class="ptr ${this.pulling ? 'show' : ''}">놓으면 새로고침</div>

        ${this.loaded ? this.renderList() : this.renderSkeleton()}

        <button class="fab" aria-label="식물 추가" @click=${(): void => this.openForm()}>${icon('plus', 26)}</button>
        <plant-form-sheet @saved=${(): void => { void this.load().then(() => refreshPlants()); }}></plant-form-sheet>
      </div>
    `;
  }
}
