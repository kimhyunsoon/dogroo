import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens, ui } from '../style.js';
import { api } from '../api.js';
import { toast } from '../ui.js';
import type { PlantSummary } from '../types.js';
import type { PlantItem } from '../components/plant-item.js';
import type { PlantFormSheet } from '../sheets/plant-form-sheet.js';
import '../components/plant-item.js';
import '../sheets/plant-form-sheet.js';
import { setupPushOnce } from '../push.js';

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

// 오늘 탭 - 오늘 물줄 화분만, 그룹별 섹션
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
  @state() private leaving = new Set<number>();

  connectedCallback(): void {
    super.connectedCallback();
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
    this.plants = await api<PlantSummary[]>('/api/plants');
    this.loaded = true;
  }

  private get due(): PlantSummary[] {
    return this.plants
      .filter((p) => !p.archived_at && p.water_dday !== null && p.water_dday <= 0)
      .sort((a, b) => (a.water_dday ?? 0) - (b.water_dday ?? 0));
  }

  private async onWater(e: Event): Promise<void> {
    const item = e.target as PlantItem;
    const plant = item.plant;
    const date = (e as CustomEvent<{ date?: string }>).detail?.date;
    const res = await api<{ id: number }>(`/api/plants/${plant.id}/waterings`, {
      method: 'POST',
      body: JSON.stringify(date ? { watered_at: date } : {}),
    });
    // 항목이 접히는 애니메이션 후 목록 갱신
    this.leaving = new Set([...this.leaving, plant.id]);
    toast(`${plant.name} 물주기 완료`, {
      actionLabel: '취소',
      onAction: () => {
        void api(`/api/waterings/${res.id}`, { method: 'DELETE' }).then(() => this.load());
      },
    });
    setTimeout(() => {
      void this.load().then(() => {
        this.leaving = new Set([...this.leaving].filter((id) => id !== plant.id));
      });
    }, 320);
  }

  private openEdit(e: Event): void {
    const plant = (e.target as PlantItem).plant;
    const form = this.renderRoot.querySelector('plant-form-sheet') as PlantFormSheet;
    void form.show(plant.id);
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
    const due = this.due;
    const groups = groupPlants(due);
    const names = sortGroups([...groups.keys()]);
    return html`
      <div class="top">
        <h1>오늘 물주기</h1>
        <div class="sub">${this.loaded ? `${due.length}개 화분이 물을 기다려요` : ''}</div>
      </div>

      ${!this.loaded
        ? this.renderSkeleton()
        : due.length === 0
          ? html`
              <div class="empty">
                <div class="big">🌿</div>
                오늘은 물 줄 화분이 없어요
              </div>
            `
          : names.map(
              (g) => html`
                <div class="group-head">${g} <span class="count">${groups.get(g)!.length}</span></div>
                ${groups.get(g)!.map(
                  (p) => html`
                    <plant-item
                      .plant=${p}
                      ?leaving=${this.leaving.has(p.id)}
                      @open=${(): void => { location.hash = `#/plants/${p.id}`; }}
                      @edit=${this.openEdit}
                      @water=${this.onWater}
                    ></plant-item>
                  `,
                )}
              `,
            )}

      <plant-form-sheet @saved=${(): void => void this.load()}></plant-form-sheet>
    `;
  }
}
