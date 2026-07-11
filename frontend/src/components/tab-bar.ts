import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { tokens } from '../style.js';
import { icon } from '../icons.js';

const TABS = [
  { hash: '#/today', label: '오늘', icon: 'droplet' },
  { hash: '#/plants', label: '식물', icon: 'list' },
  { hash: '#/settings', label: '설정', icon: 'settings' },
] as const;

// 하단 탭바
@customElement('tab-bar')
export class TabBar extends LitElement {
  static styles = [
    tokens,
    css`
      :host {
        position: fixed;
        left: 0; right: 0; bottom: 0;
        z-index: 50;
        display: flex;
        background: var(--surface);
        border-top: 1px solid var(--border);
        padding-bottom: env(safe-area-inset-bottom);
      }
      button {
        flex: 1;
        display: flex; flex-direction: column; align-items: center; gap: 2px;
        padding: 8px 0 6px;
        background: none; border: none; cursor: pointer;
        color: var(--text-sub);
        font-size: 0.68rem;
        font-family: inherit;
      }
      button.on { color: var(--green); font-weight: 700; }
    `,
  ];

  @property() active = '';

  render(): TemplateResult {
    return html`
      ${TABS.map(
        (t) => html`
          <button
            class=${this.active.startsWith(t.hash) ? 'on' : ''}
            @click=${(): void => { location.hash = t.hash; }}
          >
            ${icon(t.icon, 21)}
            <span>${t.label}</span>
          </button>
        `,
      )}
    `;
  }
}
