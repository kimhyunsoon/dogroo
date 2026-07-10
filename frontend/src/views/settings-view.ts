import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens, ui } from '../style.js';
import { api } from '../api.js';
import { toast } from '../ui.js';
import { icon } from '../icons.js';
import { applyTheme, currentTheme, type ThemeMode } from '../theme.js';
import { ensureSubscribed } from '../push.js';
import type { NotificationSetting } from '../types.js';
import '../sheets/time-wheel-sheet.js';
import type { TimeWheelSheet } from '../sheets/time-wheel-sheet.js';

const THEME_LABEL: Record<ThemeMode, string> = { auto: '자동', light: '라이트', dark: '다크' };

@customElement('settings-view')
export class SettingsView extends LitElement {
  static styles = [
    tokens,
    ui,
    css`
      :host { display: block; min-height: 100dvh; background: var(--bg); padding-bottom: calc(40px + env(safe-area-inset-bottom)); }
      .top {
        display: flex; align-items: center; gap: 10px;
        padding: calc(12px + env(safe-area-inset-top)) 16px 12px;
        position: sticky; top: 0; background: var(--bg); z-index: 5;
      }
      .top .back { padding: 6px 8px 6px 0; color: var(--text); display: grid; place-items: center; }
      .top h1 { font-size: 1.15rem; margin: 0; }
      .block { margin: 12px 16px; }
      .row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 6px 0; gap: 10px;
      }
      .time-btn {
        background: var(--green-soft);
        color: var(--green);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        padding: 7px 12px;
        border-radius: 9px;
        font-size: 0.92rem;
        margin-left: auto;
      }
      .switch { position: relative; width: 48px; height: 28px; flex-shrink: 0; }
      .switch input { opacity: 0; width: 100%; height: 100%; margin: 0; position: absolute; z-index: 1; }
      .switch .knob {
        position: absolute; inset: 0; border-radius: 999px; background: var(--border); transition: 0.15s;
      }
      .switch .knob::after {
        content: ''; position: absolute; top: 3px; left: 3px;
        width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: 0.15s;
      }
      .switch input:checked + .knob { background: var(--green); }
      .switch input:checked + .knob::after { transform: translateX(20px); }
    `,
  ];

  @state() private watering: NotificationSetting | null = null;
  @state() private username = '';

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load(): Promise<void> {
    const [settings, me] = await Promise.all([
      api<NotificationSetting[]>('/api/settings/notifications'),
      api<{ username: string }>('/api/auth/me'),
    ]);
    this.watering = settings.find((s) => s.type === 'watering') ?? null;
    this.username = me.username;
  }

  private async updateWatering(patch: { enabled?: boolean; send_at?: string }): Promise<void> {
    await api('/api/settings/notifications/watering', { method: 'PUT', body: JSON.stringify(patch) });
    await this.load();
  }

  // 알림 켜기 = 이 기기 푸시 구독까지 함께 처리
  private async toggleWatering(e: Event): Promise<void> {
    const on = (e.target as HTMLInputElement).checked;
    if (on) {
      const ok = await ensureSubscribed().catch(() => false);
      if (!ok) {
        toast('브라우저 알림 권한이 필요해요');
        await this.load(); // 스위치 원복
        return;
      }
    }
    await this.updateWatering({ enabled: on });
  }

  private async pickTime(): Promise<void> {
    if (!this.watering) return;
    const wheel = this.renderRoot.querySelector('time-wheel-sheet') as TimeWheelSheet;
    const picked = await wheel.show(this.watering.send_at);
    if (picked) await this.updateWatering({ send_at: picked });
  }

  private setTheme(mode: ThemeMode): void {
    applyTheme(mode);
    this.requestUpdate();
  }

  private async logout(): Promise<void> {
    await api('/api/auth/logout', { method: 'POST' });
    location.hash = '#/login';
    toast('로그아웃했어요');
  }

  render(): TemplateResult {
    const theme = currentTheme();
    return html`
      <div class="top">
        <a class="back" href="#/plants" aria-label="목록으로">${icon('chevron-left', 24)}</a>
        <h1>설정</h1>
      </div>

      <div class="block card">
        <div class="row">
          <span>테마</span>
          <div class="segmented" style="width: 210px">
            ${(['auto', 'light', 'dark'] as ThemeMode[]).map(
              (mode) => html`
                <button class=${theme === mode ? 'on' : ''} @click=${(): void => this.setTheme(mode)}>
                  ${THEME_LABEL[mode]}
                </button>
              `,
            )}
          </div>
        </div>
      </div>

      <div class="block card">
        <div class="row">
          <span>물주기 알림</span>
          ${this.watering
            ? html`
                <button class="time-btn" @click=${(): void => void this.pickTime()}>${this.watering.send_at}</button>
                <label class="switch">
                  <input
                    type="checkbox"
                    ?checked=${this.watering.enabled === 1}
                    @change=${(e: Event): void => void this.toggleWatering(e)}
                  >
                  <span class="knob"></span>
                </label>
              `
            : nothing}
        </div>
      </div>

      <div class="block card">
        <div class="row">
          <span>${this.username}</span>
          <button class="btn-ghost" style="display:flex;align-items:center;gap:5px" @click=${(): void => void this.logout()}>
            ${icon('log-out', 15)} 로그아웃
          </button>
        </div>
      </div>

      <time-wheel-sheet></time-wheel-sheet>
    `;
  }
}
