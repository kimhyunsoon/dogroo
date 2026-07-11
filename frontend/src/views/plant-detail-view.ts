import { LitElement, html, css, nothing, svg, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, ui } from '../style.js';
import { api, today, addDays } from '../api.js';
import { toast, uiConfirm, Press } from '../ui.js';
import { icon } from '../icons.js';
import { fmtDate, fmtRel, fmtTogether, POT_LABEL } from '../fmt.js';
import { refreshPlants } from '../store.js';
import type { PlantDetail } from '../types.js';
import '../sheets/plant-form-sheet.js';
import '../sheets/photo-lightbox.js';
import { pickBackfillDate } from '../sheets/backfill-sheet.js';
import type { PlantFormSheet } from '../sheets/plant-form-sheet.js';
import type { PhotoLightbox } from '../sheets/photo-lightbox.js';

const HEATMAP_WEEKS = 20;
const CELL = 13;
const GAP = 3;

@customElement('plant-detail-view')
export class PlantDetailView extends LitElement {
  static styles = [
    tokens,
    ui,
    css`
      :host { display: block; min-height: 100dvh; background: var(--bg); padding-bottom: calc(40px + env(safe-area-inset-bottom)); }
      .top {
        display: flex; align-items: center; gap: 6px;
        padding: calc(12px + env(safe-area-inset-top)) 16px 12px;
        position: sticky; top: 0; background: var(--bg); z-index: 5;
      }
      .top .back { padding: 6px 8px 6px 0; color: var(--text); background: none; display: grid; place-items: center; }
      .top h1 { font-size: 1.15rem; margin: 0; flex: 1; }
      .top .edit { background: none; color: var(--text-sub); padding: 6px; }
      .gallery {
        display: flex; gap: 8px; overflow-x: auto; scroll-snap-type: x mandatory;
        padding: 0 16px; -webkit-overflow-scrolling: touch;
      }
      .gallery img {
        width: min(78vw, 340px); aspect-ratio: 1; object-fit: cover;
        border-radius: 16px; scroll-snap-align: center; flex-shrink: 0;
        background: var(--green-soft);
        cursor: pointer;
      }
      .gallery .none {
        width: min(78vw, 340px); aspect-ratio: 1; border-radius: 16px;
        background: var(--green-soft); display: grid; place-items: center; font-size: 3rem;
        flex-shrink: 0;
      }
      .stats {
        display: grid; grid-template-columns: 1fr 1fr 1fr;
        margin: 12px 16px 0;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 12px 4px;
        text-align: center;
      }
      .stats > div { padding: 0 10px; min-width: 0; }
      .stats > div + div { border-left: 1px solid var(--border); }
      .stats .k { font-size: 0.74rem; color: var(--text-sub); margin-bottom: 3px; }
      .stats .v { font-size: 0.88rem; font-weight: 700; word-break: keep-all; }
      .stats .sci { font-size: 0.7rem; font-style: italic; color: var(--text-sub); font-weight: 400; }
      .memo { margin: 10px 20px 0; white-space: pre-wrap; }
      .block { margin: 12px 16px; }
      .block h2 { font-size: 0.98rem; margin: 0 0 6px; display: flex; align-items: center; gap: 8px; }
      .block h2 .grow { flex: 1; }
      .cycle { font-size: 0.88rem; color: var(--text-sub); }
      .doit { margin-top: 12px; }
      /* 오늘 완료 - 목록의 흐린 체크 버튼과 같은 결 (재탭 = 취소) */
      .doit.done { background: transparent; border: 1px dashed var(--border); color: var(--text-sub); }
      .timeline { list-style: none; padding: 0; margin: 0; }
      .timeline li {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 0.9rem;
      }
      .timeline .date { color: var(--text-sub); width: 64px; flex-shrink: 0; }
      .timeline .del { margin-left: auto; color: var(--text-sub); background: none; padding: 4px 6px; }
      .seg-mini { width: 140px; }
      .chart-wrap { overflow-x: auto; padding: 10px 0 6px; scrollbar-width: none; }
      .chart-wrap::-webkit-scrollbar { display: none; }
      .chart-wrap svg { display: block; width: 100%; height: auto; }
      .chart-cap {
        display: flex; align-items: center; justify-content: center; gap: 5px;
        font-size: 0.78rem; color: var(--text-sub);
      }
      .chart-cap .dot { width: 10px; height: 10px; border-radius: 3px; opacity: 0.95; }
      .chart-cap .dot.water { background: var(--green); }
      .chart-cap .dot.repot { background: var(--warn); margin-left: 6px; }
    `,
  ];

  @property({ attribute: 'plant-id' }) plantId = '';
  @state() private plant: PlantDetail | null = null;
  @state() private logView: 'graph' | 'list' = 'graph';

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
    // 소급 기록 안내는 최초 1회만
    if (!localStorage.getItem('hint-backfill')) {
      localStorage.setItem('hint-backfill', '1');
      setTimeout(() => toast('완료 버튼을 길게 누르면 지난 날짜로 기록할 수 있어요', { duration: 4000 }), 600);
    }
  }

  private async load(): Promise<void> {
    this.plant = await api<PlantDetail>(`/api/plants/${this.plantId}`);
  }

  // 그래프는 항상 오른쪽 끝(최근)부터 보이도록
  protected updated(): void {
    if (this.logView !== 'graph') return;
    const wrap = this.renderRoot.querySelector<HTMLElement>('.chart-wrap');
    if (wrap && wrap.dataset.scrolled !== '1') {
      wrap.dataset.scrolled = '1';
      wrap.scrollLeft = wrap.scrollWidth;
    }
  }

  // 오늘 이미 완료했는지 (완료 버튼이 취소 토글로 바뀐다)
  private doneToday(kind: 'water' | 'repot'): boolean {
    const p = this.plant;
    if (!p) return false;
    const last = kind === 'water' ? p.last_watered_at : p.last_repotted_at;
    return last?.slice(0, 10) === today();
  }

  private async complete(kind: 'water' | 'repot', date?: string): Promise<void> {
    const p = this.plant;
    if (!p) return;
    const isWater = kind === 'water';
    const url = isWater ? `/api/plants/${p.id}/waterings` : `/api/plants/${p.id}/repottings`;
    const body = date ? (isWater ? { watered_at: date } : { repotted_at: date }) : {};
    await api(url, { method: 'POST', body: JSON.stringify(body) });
    await this.load();
    void refreshPlants(); // 목록 캐시 동기화 (back으로 복귀 시 최신)
  }

  // 완료 버튼 재탭 = 오늘 기록 취소
  private async undoToday(kind: 'water' | 'repot'): Promise<void> {
    const p = this.plant;
    if (!p) return;
    await api(`/api/plants/${p.id}/${kind === 'water' ? 'waterings' : 'repottings'}/today`, {
      method: 'DELETE',
    });
    await this.load();
    void refreshPlants();
  }

  private pressFor(kind: 'water' | 'repot'): Press {
    return new Press(
      () => void this.complete(kind),
      () => {
        void pickBackfillDate().then((date) => {
          if (date) void this.complete(kind, date);
        });
      },
    );
  }

  private async deleteLog(kind: 'water' | 'repot', id: number, date: string): Promise<void> {
    const label = kind === 'water' ? '물주기' : '분갈이';
    const ok = await uiConfirm(`${fmtDate(date)} ${label} 기록을 삭제할까요?`, {
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    await api(`/api/${kind === 'water' ? 'waterings' : 'repottings'}/${id}`, { method: 'DELETE' });
    await this.load();
    void refreshPlants();
  }

  // 물주기·분갈이 기록을 시간순으로 병합
  private get timeline(): { kind: 'water' | 'repot'; id: number; date: string; memo: string | null }[] {
    const p = this.plant;
    if (!p) return [];
    return [
      ...p.waterings.map((w) => ({ kind: 'water' as const, id: w.id, date: w.watered_at, memo: w.memo })),
      ...p.repottings.map((r) => ({ kind: 'repot' as const, id: r.id, date: r.repotted_at, memo: r.memo })),
    ]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 60);
  }

  private openEdit(): void {
    const form = this.renderRoot.querySelector('plant-form-sheet') as PlantFormSheet;
    void form.show(Number(this.plantId));
  }

  private openLightbox(index: number): void {
    const box = this.renderRoot.querySelector('photo-lightbox') as PhotoLightbox;
    box.show(this.plant?.photos ?? [], index);
  }

  // 어느 탭에서 들어왔든 이전 화면으로 (직접 진입이면 식물 탭으로)
  private goBack(): void {
    if (history.length > 1) history.back();
    else location.hash = '#/plants';
  }

  // 주기와 마지막 완료 시점을 한 줄로 (D-day·예정일 표기는 쓰지 않는다)
  private cycleLine(kind: 'water' | 'repot'): string {
    const p = this.plant!;
    if (kind === 'water') {
      const last = fmtRel(p.last_watered_at, today());
      return `${p.effective_water_days}일마다 · 💧 ${last ?? '기록 없음'}`;
    }
    const last = fmtRel(p.last_repotted_at, today());
    return `${p.effective_repot_months}개월마다 · 🪴 ${last ?? '기록 없음'}`;
  }

  // 물주기·분갈이 히트맵 (최근 20주, 한 칸 = 하루, 월·요일 라벨 포함)
  private renderChart(): TemplateResult {
    const p = this.plant!;
    const watered = new Set(p.waterings.map((w) => w.watered_at.slice(0, 10)));
    const repotted = new Set(p.repottings.map((r) => r.repotted_at.slice(0, 10)));
    const base = today();
    const thisSunday = addDays(base, -new Date(`${base}T00:00:00`).getDay());
    const LEFT = 20; // 요일 라벨 영역
    const TOP = 16; // 월 라벨 영역
    const step = CELL + GAP;
    // +2: 오늘 셀의 테두리(stroke)가 viewBox 가장자리에서 잘리지 않게 여유
    const width = LEFT + HEATMAP_WEEKS * step - GAP + 2;
    const height = TOP + 7 * step - GAP + 2;
    const cells: TemplateResult[] = [];
    let prevMonth = '';
    for (let w = 0; w < HEATMAP_WEEKS; w++) {
      const weekStart = addDays(thisSunday, -7 * (HEATMAP_WEEKS - 1 - w));
      // 월이 바뀌는 주 위에 라벨
      const month = weekStart.slice(5, 7);
      if (month !== prevMonth) {
        prevMonth = month;
        cells.push(svg`<text x=${LEFT + w * step} y="10" font-size="9"
          fill="var(--text-sub)">${Number(month)}월</text>`);
      }
      for (let d = 0; d < 7; d++) {
        const date = addDays(weekStart, d);
        if (date > base) continue;
        const water = watered.has(date);
        const repot = repotted.has(date);
        const fill = repot ? 'var(--warn)' : water ? 'var(--green)' : 'var(--border)';
        cells.push(svg`<rect
          x=${LEFT + w * step} y=${TOP + d * step}
          width=${CELL} height=${CELL} rx="4"
          fill=${fill}
          opacity=${water || repot ? '0.95' : '0.35'}
          stroke=${date === base ? 'var(--green)' : repot && water ? 'var(--green)' : 'none'} stroke-width="1.5"
        />`);
      }
    }
    // 요일 라벨 (월·수·금)
    const dayLabels = [
      { d: 1, label: '월' },
      { d: 3, label: '수' },
      { d: 5, label: '금' },
    ];
    for (const { d, label } of dayLabels) {
      cells.push(svg`<text x="0" y=${TOP + d * step + CELL - 3} font-size="9"
        fill="var(--text-sub)">${label}</text>`);
    }
    // 평균 간격 (히트맵 기간 내)
    const from = addDays(thisSunday, -7 * (HEATMAP_WEEKS - 1));
    const dates = [...watered].filter((d) => d >= from).sort();
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      gaps.push(Math.round((Date.parse(dates[i]!) - Date.parse(dates[i - 1]!)) / 86400000));
    }
    const avg = gaps.length > 0 ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;
    return html`
      <div class="chart-wrap">
        <svg viewBox="0 0 ${width} ${height}" style="min-width:${width}px">${cells}</svg>
      </div>
      <div class="chart-cap">
        <span class="dot water"></span> 물주기
        <span class="dot repot"></span> 분갈이
        · 최근 ${HEATMAP_WEEKS}주${avg ? ` · 물주기 평균 ${avg}일` : ''}
      </div>
    `;
  }

  render(): TemplateResult {
    const p = this.plant;
    if (!p) return html`<div class="top"><button class="back" @click=${this.goBack}>${icon('chevron-left', 24)}</button></div>`;
    const waterGesture = this.pressFor('water');
    const repotGesture = this.pressFor('repot');
    return html`
      <div class="top">
        <button class="back" @click=${this.goBack} aria-label="뒤로">${icon('chevron-left', 24)}</button>
        <h1>${p.name}</h1>
        <button class="edit" aria-label="수정" @click=${this.openEdit}>${icon('pencil')}</button>
      </div>

      <div class="gallery">
        ${p.photos.length > 0
          ? p.photos.map(
              (ph, i) => html`<img
                src="/api/files/${ph.path}"
                alt=""
                loading="lazy"
                @click=${(): void => this.openLightbox(i)}
              >`,
            )
          : html`<div class="none">🪴</div>`}
      </div>

      <div class="stats">
        <div>
          <div class="k">종류</div>
          <div class="v">${p.species_name ?? '미지정'}</div>
          ${p.species_name_en ? html`<div class="sci">${p.species_name_en}</div>` : nothing}
        </div>
        <div>
          <div class="k">화분</div>
          <div class="v">${POT_LABEL[p.pot_size]}${p.pot_type ? ` · ${p.pot_type}` : ''}</div>
        </div>
        <div>
          <div class="k">함께한 지</div>
          <div class="v">${p.started_at ? fmtTogether(p.started_at.slice(0, 10), today()) : '-'}</div>
        </div>
      </div>
      ${p.memo ? html`<p class="sub memo">${p.memo}</p>` : nothing}

      <div class="block card">
        <h2>💧 물주기</h2>
        <div class="cycle">${this.cycleLine('water')}</div>
        ${this.doneToday('water')
          ? html`
              <button class="btn-primary doit done" @click=${(): void => void this.undoToday('water')}>
                오늘 물주기 취소
              </button>
            `
          : html`
              <button
                class="btn-primary doit"
                @pointerdown=${waterGesture.down}
                @pointermove=${waterGesture.move}
                @pointerup=${waterGesture.up}
                @pointercancel=${waterGesture.up}
                @click=${waterGesture.click}
              >오늘 물줬어요</button>
            `}
      </div>

      <div class="block card">
        <h2>🪴 분갈이</h2>
        <div class="cycle">${this.cycleLine('repot')}</div>
        ${this.doneToday('repot')
          ? html`
              <button class="btn-primary doit done" @click=${(): void => void this.undoToday('repot')}>
                오늘 분갈이 취소
              </button>
            `
          : html`
              <button
                class="btn-primary doit"
                style="background:var(--green-soft);color:var(--green)"
                @pointerdown=${repotGesture.down}
                @pointermove=${repotGesture.move}
                @pointerup=${repotGesture.up}
                @pointercancel=${repotGesture.up}
                @click=${repotGesture.click}
              >분갈이 했어요</button>
            `}
      </div>

      <div class="block">
        <h2>
          기록 <span class="grow"></span>
          <div class="segmented seg-mini">
            <button class=${this.logView === 'graph' ? 'on' : ''} @click=${(): void => { this.logView = 'graph'; }}>그래프</button>
            <button class=${this.logView === 'list' ? 'on' : ''} @click=${(): void => { this.logView = 'list'; }}>목록</button>
          </div>
        </h2>
        ${this.logView === 'graph'
          ? this.renderChart()
          : html`
              <ul class="timeline">
                ${this.timeline.map(
                  (t) => html`
                    <li>
                      <span class="date">${fmtDate(t.date)}</span>
                      <span>${t.kind === 'water' ? '💧 물주기' : '🪴 분갈이'}</span>
                      ${t.memo ? html`<span class="sub">${t.memo}</span>` : nothing}
                      <button class="del" @click=${(): void => void this.deleteLog(t.kind, t.id, t.date)} aria-label="삭제">
                        ${icon('x', 15)}
                      </button>
                    </li>
                  `,
                )}
              </ul>
            `}
      </div>

      <plant-form-sheet @saved=${(): void => { void this.load().then(() => refreshPlants()); }}></plant-form-sheet>
      <photo-lightbox></photo-lightbox>
    `;
  }
}
