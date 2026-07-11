import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens, ui } from '../style.js';
import { api, today } from '../api.js';
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

  // 오늘 완료한 화분(watered/repotted today)도 목록에 남긴다 - 흐린 체크로 표시, 재탭 시 취소
  private wateredToday(p: PlantSummary): boolean {
    return p.last_watered_at?.slice(0, 10) === today();
  }

  private repottedToday(p: PlantSummary): boolean {
    return p.last_repotted_at?.slice(0, 10) === today();
  }

  private get dueWater(): PlantSummary[] {
    return this.plants
      .filter(
        (p) => !p.archived_at && ((p.water_dday !== null && p.water_dday <= 0) || this.wateredToday(p)),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'ko')); // 이름순 고정 - 완료해도 순서가 안 흔들림
  }

  private get dueRepot(): PlantSummary[] {
    return this.plants
      .filter(
        (p) => !p.archived_at && ((p.repot_dday !== null && p.repot_dday <= 0) || this.repottedToday(p)),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }

  private async onComplete(e: Event): Promise<void> {
    const plant = (e.target as PlantItem).plant;
    const { kind, date } = (e as CustomEvent<{ kind: Kind; date?: string }>).detail;
    const isWater = kind === 'water';
    const url = `/api/plants/${plant.id}/${isWater ? 'waterings' : 'repottings'}`;
    const body = date ? (isWater ? { watered_at: date } : { repotted_at: date }) : {};
    await api(url, { method: 'POST', body: JSON.stringify(body) });
    await this.load();
    void refreshPlants();
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
  }

  private renderItem(p: PlantSummary, kind: Kind): TemplateResult {
    return html`
      <plant-item
        .plant=${p}
        kind=${kind}
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
    const waterLeft = water.filter((p) => !this.wateredToday(p)).length;
    const repotLeft = repot.filter((p) => !this.repottedToday(p)).length;
    const groups = groupPlants(water);
    const names = sortGroups([...groups.keys()]);
    return html`
      <div class="top">
        <h1>오늘 할 일</h1>
        <div class="sub">
          ${!this.loaded
            ? ''
            : waterLeft === 0 && repotLeft === 0 && water.length + repot.length > 0
              ? '오늘 할 일을 모두 마쳤어요 🌿'
              : `물주기 ${waterLeft}${repotLeft > 0 ? ` · 분갈이 ${repotLeft}` : ''}`}
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
