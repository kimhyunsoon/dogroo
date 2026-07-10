import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens, ui } from '../style.js';
import { api } from '../api.js';
import { toast, Press } from '../ui.js';
import { icon } from '../icons.js';
import { waterBadge } from '../fmt.js';
import type { PlantSummary } from '../types.js';
import '../sheets/plant-form-sheet.js';
import { pickBackfillDate } from '../sheets/backfill-sheet.js';
import { setupPushOnce } from '../push.js';
import type { PlantFormSheet } from '../sheets/plant-form-sheet.js';

type SortKey = 'due' | 'name' | 'recent';
const SORT_LABEL: Record<SortKey, string> = { due: '임박순', name: '이름순', recent: '최근순' };
const SORT_ORDER: SortKey[] = ['due', 'name', 'recent'];

// 물주기가 오늘이거나 지난 화분 (분갈이는 상세에서만 안내)
function isDue(p: PlantSummary): boolean {
  return p.water_dday !== null && p.water_dday <= 0;
}

// 상세에서 돌아올 때 목록 스크롤 위치 복원용
let savedScrollY = 0;

@customElement('plant-list-view')
export class PlantListView extends LitElement {
  static styles = [
    tokens,
    ui,
    css`
      :host { display: block; min-height: 100dvh; background: var(--bg); padding-bottom: calc(90px + env(safe-area-inset-bottom)); }
      .top {
        position: sticky; top: 0; z-index: 5;
        background: var(--bg);
        /* 노치·다이나믹 아일랜드 아래로 내용이 파고들지 않도록 */
        padding: calc(12px + env(safe-area-inset-top)) 16px 8px;
      }
      .brand { display: flex; align-items: center; gap: 4px; }
      .brand img { height: 24px; filter: var(--logo-filter); }
      .brand .spacer { flex: 1; }
      .brand button, .brand a {
        color: var(--text-sub);
        background: none;
        padding: 8px;
        display: grid;
        place-items: center;
      }
      .search-row { padding-top: 8px; }
      .list-head {
        display: flex; align-items: center; gap: 8px;
        margin: 14px 16px 4px;
        font-size: 0.85rem; font-weight: 700; color: var(--text-sub);
      }
      .list-head .line { flex: 1; border-top: 1px dashed var(--border); }
      .list-head button {
        background: none; color: var(--text-sub);
        font-size: 0.8rem; font-weight: 600;
        padding: 4px 6px;
        display: flex; align-items: center; gap: 3px;
      }
      .list-head button.on { color: var(--green); }
      .item {
        display: flex; align-items: center; gap: 12px;
        padding: 10px 16px;
        border-bottom: 1px solid var(--border);
        cursor: pointer;
        /* 길게 누르기(수정)에서 iOS 텍스트 선택·콜아웃 방지 */
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
      }
      .thumb {
        width: 54px; height: 54px; border-radius: 12px; object-fit: cover;
        background: var(--green-soft); flex-shrink: 0;
        display: grid; place-items: center; font-size: 1.4rem;
      }
      .info { flex: 1; min-width: 0; }
      .info .name { font-weight: 700; }
      .info .species {
        color: var(--text-sub); font-size: 0.8rem;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .badges { display: flex; gap: 5px; margin-top: 3px; }
      .fab {
        position: fixed; right: 18px; bottom: max(20px, env(safe-area-inset-bottom));
        width: 56px; height: 56px; border-radius: 50%;
        background: var(--green); color: #fff;
        display: grid; place-items: center;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
      }
      .empty { text-align: center; color: var(--text-sub); padding: 48px 16px; }
      .ptr { text-align: center; color: var(--text-sub); font-size: 0.8rem; overflow: hidden; height: 0; transition: height 0.15s; }
      .ptr.show { height: 30px; padding-top: 8px; }
    `,
  ];

  @state() private plants: PlantSummary[] = [];
  @state() private q = '';
  @state() private searchOpen = false;
  @state() private sort: SortKey = 'due';
  @state() private includeArchived = false;
  @state() private loaded = false;
  @state() private pulling = false;

  private touchStartY = 0;

  connectedCallback(): void {
    super.connectedCallback();
    void this.load().then(() => {
      // 상세에서 돌아온 경우 이전 스크롤 위치 복원
      requestAnimationFrame(() => window.scrollTo(0, savedScrollY));
    });
    // 첫 진입 시 알림 허용을 받고 물주기 알림을 기본(저녁 6시)으로 켠다
    void setupPushOnce();
    document.addEventListener('visibilitychange', this.onVisible);
  }

  disconnectedCallback(): void {
    savedScrollY = window.scrollY;
    document.removeEventListener('visibilitychange', this.onVisible);
    super.disconnectedCallback();
  }

  // 백그라운드에 있다가 돌아오면 D-day가 지나 있을 수 있으니 새로고침
  private onVisible = (): void => {
    if (document.visibilityState === 'visible') void this.load();
  };

  private async load(): Promise<void> {
    const query = this.includeArchived ? '?archived=1' : '';
    this.plants = await api<PlantSummary[]>(`/api/plants${query}`);
    this.loaded = true;
  }

  private matchesQuery(p: PlantSummary): boolean {
    const q = this.q.trim().toLowerCase();
    return (
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.species_name ?? '').toLowerCase().includes(q)
    );
  }

  private get visible(): PlantSummary[] {
    const list = this.plants.filter((p) => this.matchesQuery(p));
    const key = (p: PlantSummary): number => p.water_dday ?? 9999;
    if (this.sort === 'due') return [...list].sort((a, b) => key(a) - key(b));
    if (this.sort === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return [...list].sort((a, b) => b.id - a.id);
  }

  // 오늘 물주기 목록은 정렬·보관 설정과 무관하게 항상 임박순, 보관 제외
  private get dueList(): PlantSummary[] {
    return this.plants
      .filter((p) => !p.archived_at && isDue(p) && this.matchesQuery(p))
      .sort((a, b) => (a.water_dday ?? 0) - (b.water_dday ?? 0));
  }

  private cycleSort(): void {
    const next = SORT_ORDER[(SORT_ORDER.indexOf(this.sort) + 1) % SORT_ORDER.length]!;
    this.sort = next;
  }

  private toggleSearch(): void {
    this.searchOpen = !this.searchOpen;
    if (!this.searchOpen) this.q = '';
  }

  private async water(p: PlantSummary, date?: string): Promise<void> {
    const res = await api<{ id: number }>(`/api/plants/${p.id}/waterings`, {
      method: 'POST',
      body: JSON.stringify(date ? { watered_at: date } : {}),
    });
    await this.load();
    toast(`${p.name} 물주기 완료`, {
      actionLabel: '실행취소',
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

  private renderItem(p: PlantSummary, withAction: boolean): TemplateResult {
    const water = waterBadge(p);
    // 탭하면 상세, 길게 누르면 바로 수정
    const g = new Press(
      () => { location.hash = `#/plants/${p.id}`; },
      () => this.openForm(p.id),
    );
    return html`
      <div
        class="item"
        @pointerdown=${g.down}
        @pointermove=${g.move}
        @pointerup=${g.up}
        @pointercancel=${g.up}
        @click=${g.click}
      >
        ${p.photo
          ? html`<img class="thumb" src="/api/files/${p.photo}" alt="" loading="lazy">`
          : html`<div class="thumb">🪴</div>`}
        <div class="info">
          <div class="name">${p.name}${p.archived_at ? html` <span class="sub">(보관)</span>` : nothing}</div>
          <div class="species">${p.species_name ?? ''}</div>
          <div class="badges">
            ${water ? html`<span class="badge ${water.cls}">💧 ${water.label}</span>` : nothing}
          </div>
        </div>
        ${withAction
          ? html`<div
              @click=${(e: Event): void => e.stopPropagation()}
              @pointerdown=${(e: Event): void => e.stopPropagation()}
            >
              ${this.renderWaterAction(p)}
            </div>`
          : nothing}
      </div>
    `;
  }

  private renderWaterAction(p: PlantSummary): TemplateResult {
    const g = new Press(
      () => void this.water(p),
      () => {
        void pickBackfillDate().then((date) => {
          if (date) void this.water(p, date);
        });
      },
    );
    return html`
      <button
        class="btn-soft"
        @pointerdown=${g.down}
        @pointermove=${g.move}
        @pointerup=${g.up}
        @pointercancel=${g.up}
        @click=${g.click}
      >물주기</button>
    `;
  }

  render(): TemplateResult {
    const visible = this.visible;
    const due = this.dueList;
    return html`
      <div
        @touchstart=${this.onTouchStart}
        @touchmove=${this.onTouchMove}
        @touchend=${this.onTouchEnd}
      >
        <div class="top">
          <div class="brand">
            <img src="/logo-text.webp" alt="두그루">
            <div class="spacer"></div>
            <button aria-label="검색" class=${this.searchOpen ? 'on' : ''} @click=${this.toggleSearch}>
              ${icon(this.searchOpen ? 'x' : 'search')}
            </button>
            <a href="#/settings" aria-label="설정">${icon('settings')}</a>
          </div>
          ${this.searchOpen
            ? html`
                <div class="search-row">
                  <input
                    type="search"
                    placeholder="이름이나 종류로 검색"
                    .value=${this.q}
                    @input=${(e: Event): void => { this.q = (e.target as HTMLInputElement).value; }}
                  >
                </div>
              `
            : nothing}
        </div>
        <div class="ptr ${this.pulling ? 'show' : ''}">놓으면 새로고침</div>

        ${due.length > 0
          ? html`
              <div class="list-head">
                <span>오늘 물주기 ${due.length}</span>
                <span class="line"></span>
              </div>
              ${due.map((p) => this.renderItem(p, true))}
            `
          : nothing}

        <div class="list-head">
          <span>전체 ${visible.length}</span>
          <span class="line"></span>
          <button @click=${this.cycleSort}>${icon('arrow-up-down', 13)} ${SORT_LABEL[this.sort]}</button>
          <button
            class=${this.includeArchived ? 'on' : ''}
            @click=${(): void => {
              this.includeArchived = !this.includeArchived;
              void this.load();
            }}
          >${icon('archive', 13)} 보관</button>
        </div>
        ${visible.map((p) => this.renderItem(p, false))}
        ${this.loaded && visible.length === 0
          ? html`<div class="empty">표시할 식물이 없어요 🌱</div>`
          : nothing}

        <button class="fab" aria-label="식물 추가" @click=${(): void => this.openForm()}>${icon('plus', 26)}</button>
        <plant-form-sheet @saved=${(): void => void this.load()}></plant-form-sheet>
      </div>
    `;
  }
}
