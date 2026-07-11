import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens, ui } from '../style.js';
import { api } from '../api.js';
import { toast } from '../ui.js';
import { cachedPlants, loadPlants, refreshPlants } from '../store.js';
import type { PlantSummary } from '../types.js';
import type { PlantItem } from '../components/plant-item.js';
import type { PlantFormSheet } from '../sheets/plant-form-sheet.js';
import '../components/plant-item.js';
import '../sheets/plant-form-sheet.js';
import { setupPushOnce } from '../push.js';

type Kind = 'water' | 'repot';

// 그룹명 기준 정렬 (기타류는 마지막)
export function sortGroups(groups: string[]): string[] {
  return groups.sort((a, b) => {
    const aEtc = a.startsWith('기타') ? 1 : 0;
    const bEtc = b.startsWith('기타') ? 1 : 0;
    return aEtc - bEtc || a.localeCompare(b, 'ko');
  });
}

export function groupPlants(plants: PlantSummary[]): Map<string, PlantSummary[]> {
  const map = new Map<string, PlantSummary[]>();
  for (const p of plants) {
    const key = p.group_name ?? '기타';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return map;
}

// 오늘 탭 - 오늘 물줄 화분(그룹별 섹션) + 오늘 분갈이 대상 섹션
@customElement('today-view')
export class TodayView extends LitElement {
  static styles = [
    tokens,
    ui,
    css`
      :host { display: block; min-height: 100dvh; background: var(--bg); padding-bottom: calc(80px + env(safe-area-inset-bottom)); }
      .top {
        position: sticky; top: 0; z-index: 5;
        background: var(--bg);
        padding: calc(12px + env(safe-area-inset-top)) 16px 10px;
      }
      .top h1 { font-size: 1.15rem; margin: 0; }
      .top .sub { margin-top: 2px; }
      .group-head {
        display: flex; align-items: baseline; gap: 6px;
        margin: 14px 16px 2px;
        font-size: 0.8rem; font-weight: 700; color: var(--green);
      }
      .group-head .count { color: var(--text-sub); font-weight: 400; }
      .group-head.repot { color: var(--warn); }
      .empty {
        text-align: center; color: var(--text-sub);
        padding: 70px 16px;
        font-size: 0.95rem;
      }
      .empty .big { font-size: 2.4rem; margin-bottom: 10px; }
      .sk-row { display: flex; gap: 10px; padding: 9px 16px; align-items: center; }
      .sk-thumb { width: 46px; height: 46px; flex-shrink: 0; }
      .sk-lines { flex: 1; display: flex; flex-direction: column; gap: 6px; }
      .sk-line { height: 11px; }
    `,
  ];

  @state() private plants: PlantSummary[] = [];
  @state() private loaded = false;
  @state() private leaving = new Set<string>(); // `${kind}:${id}` - 물·분갈이 동시 대상 대응

  connectedCallback(): void {
    super.connectedCallback();
    const cached = cachedPlants();
    if (cached) {
      this.plants = cached;
      this.loaded = true;
    }
    void this.load();
    void setupPushOnce();
    document.addEventListener('visibilitychange', this.onVisible);
  }

  disconnectedCallback(): void {
    document.removeEventListener('visibilitychange', this.onVisible);
    super.disconnectedCallback();
  }

  private onVisible = (): void => {
    if (document.visibilityState === 'visible') void this.load();
  };

  private async load(): Promise<void> {
    this.plants = await loadPlants();
    this.loaded = true;
  }

  private get dueWater(): PlantSummary[] {
    return this.plants
      .filter((p) => !p.archived_at && p.water_dday !== null && p.water_dday <= 0)
      .sort((a, b) => (a.water_dday ?? 0) - (b.water_dday ?? 0));
  }

  private get dueRepot(): PlantSummary[] {
    return this.plants
      .filter((p) => !p.archived_at && p.repot_dday !== null && p.repot_dday <= 0)
      .sort((a, b) => (a.repot_dday ?? 0) - (b.repot_dday ?? 0));
  }

  private async onComplete(e: Event): Promise<void> {
    const item = e.target as PlantItem;
    const plant = item.plant;
    const { kind, date } = (e as CustomEvent<{ kind: Kind; date?: string }>).detail;
    const isWater = kind === 'water';
    const url = `/api/plants/${plant.id}/${isWater ? 'waterings' : 'repottings'}`;
    const body = date ? (isWater ? { watered_at: date } : { repotted_at: date }) : {};
    const res = await api<{ id: number }>(url, { method: 'POST', body: JSON.stringify(body) });
    // 항목이 접히는 애니메이션 후 목록 갱신
    const leavingKey = `${kind}:${plant.id}`;
    this.leaving = new Set([...this.leaving, leavingKey]);
    toast(`${plant.name} ${isWater ? '물주기' : '분갈이'} 완료`, {
      actionLabel: '취소',
      onAction: () => {
        void api(`/api/${isWater ? 'waterings' : 'repottings'}/${res.id}`, { method: 'DELETE' })
          .then(() => this.load());
      },
    });
    setTimeout(() => {
      void this.load().then(() => {
        this.leaving = new Set([...this.leaving].filter((key) => key !== leavingKey));
        void refreshPlants();
      });
    }, 320);
  }

  private openEdit(e: Event): void {
    const plant = (e.target as PlantItem).plant;
    const form = this.renderRoot.querySelector('plant-form-sheet') as PlantFormSheet;
    void form.show(plant.id);
  }

  // 오늘 완료한 기록의 토글 취소 (흐린 체크 버튼 재탭)
  private async onUndo(e: Event): Promise<void> {
    const plant = (e.target as PlantItem).plant;
    const { kind } = (e as CustomEvent<{ kind: Kind }>).detail;
    const isWater = kind === 'water';
    await api(`/api/plants/${plant.id}/${isWater ? 'waterings' : 'repottings'}/today`, { method: 'DELETE' });
    await this.load();
    void refreshPlants();
    toast(`${plant.name} 오늘 ${isWater ? '물주기' : '분갈이'} 기록을 취소했어요`);
  }

  private renderItem(p: PlantSummary, kind: Kind): TemplateResult {
    return html`
      <plant-item
        .plant=${p}
        kind=${kind}
        ?leaving=${this.leaving.has(`${kind}:${p.id}`)}
        @open=${(): void => { location.hash = `#/plants/${p.id}`; }}
        @edit=${this.openEdit}
        @complete=${this.onComplete}
        @undo=${this.onUndo}
      ></plant-item>
    `;
  }

  private renderSkeleton(): TemplateResult {
    return html`${[1, 2, 3, 4].map(
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
    const water = this.dueWater;
    const repot = this.dueRepot;
    const groups = groupPlants(water);
    const names = sortGroups([...groups.keys()]);
    return html`
      <div class="top">
        <h1>오늘 할 일</h1>
        <div class="sub">
          ${this.loaded
            ? `물주기 ${water.length}${repot.length > 0 ? ` · 분갈이 ${repot.length}` : ''}`
            : ''}
        </div>
      </div>

      ${!this.loaded
        ? this.renderSkeleton()
        : water.length === 0 && repot.length === 0
          ? html`
              <div class="empty">
                <div class="big">🌿</div>
                오늘은 할 일이 없어요
              </div>
            `
          : html`
              ${names.map(
                (g) => html`
                  <div class="group-head">${g} <span class="count">${groups.get(g)!.length}</span></div>
                  ${groups.get(g)!.map((p) => this.renderItem(p, 'water'))}
                `,
              )}
              ${repot.length > 0
                ? html`
                    <div class="group-head repot">🪴 분갈이 <span class="count">${repot.length}</span></div>
                    ${repot.map((p) => this.renderItem(p, 'repot'))}
                  `
                : ''}
            `}

      <plant-form-sheet @saved=${(): void => { void this.load().then(() => refreshPlants()); }}></plant-form-sheet>
    `;
  }
}
