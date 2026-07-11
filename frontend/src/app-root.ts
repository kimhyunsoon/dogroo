import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import { tokens } from './style.js';
import './views/login-view.js';
import './views/today-view.js';
import './views/plants-view.js';
import './views/plant-detail-view.js';
import './views/settings-view.js';
import './components/tab-bar.js';

// 해시 라우터: #/login #/today #/plants #/plants/:id #/settings
// 등록·수정은 페이지가 아닌 바텀시트 모달 (히스토리 연동 - ui.ts pushModal)
@customElement('app-root')
export class AppRoot extends LitElement {
  static styles = [
    tokens,
    css`
      :host {
        display: block;
        min-height: 100dvh;
        background: var(--bg);
      }
      .view {
        animation: view-in 0.18s ease-out;
      }
      @keyframes view-in {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: none; }
      }
    `,
  ];

  @state() private route = location.hash || '#/today';

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('hashchange', this.onHashChange);
  }

  disconnectedCallback(): void {
    window.removeEventListener('hashchange', this.onHashChange);
    super.disconnectedCallback();
  }

  private onHashChange = (): void => {
    this.route = location.hash || '#/today';
  };

  private renderView(): TemplateResult {
    const route = this.route;
    if (route.startsWith('#/login')) return html`<login-view></login-view>`;
    if (route.startsWith('#/settings')) return html`<settings-view></settings-view>`;
    if (route.startsWith('#/plants/')) {
      const match = route.match(/^#\/plants\/(\d+)$/);
      if (match) return html`<plant-detail-view plant-id=${match[1]!}></plant-detail-view>`;
    }
    if (route.startsWith('#/plants')) return html`<plants-view></plants-view>`;
    return html`<today-view></today-view>`;
  }

  render(): TemplateResult {
    const route = this.route;
    const showTabs =
      route.startsWith('#/today') ||
      route === '#/plants' ||
      route.startsWith('#/settings') ||
      route === '' ||
      route === '#/';
    return html`
      ${keyed(route, html`<div class="view">${this.renderView()}</div>`)}
      ${showTabs ? html`<tab-bar .active=${route || '#/today'}></tab-bar>` : nothing}
    `;
  }
}
