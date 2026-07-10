import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens } from './style.js';
import './views/login-view.js';
import './views/plant-list-view.js';
import './views/plant-detail-view.js';
import './views/settings-view.js';

// 해시 라우터: #/login #/plants #/plants/:id #/settings
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
    `,
  ];

  @state() private route = location.hash || '#/plants';

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('hashchange', this.onHashChange);
  }

  disconnectedCallback(): void {
    window.removeEventListener('hashchange', this.onHashChange);
    super.disconnectedCallback();
  }

  private onHashChange = (): void => {
    this.route = location.hash || '#/plants';
  };

  render(): TemplateResult {
    const route = this.route;
    if (route.startsWith('#/login')) return html`<login-view></login-view>`;
    if (route.startsWith('#/settings')) return html`<settings-view></settings-view>`;
    const detailMatch = route.match(/^#\/plants\/(\d+)$/);
    if (detailMatch) return html`<plant-detail-view plant-id=${detailMatch[1]!}></plant-detail-view>`;
    return html`<plant-list-view></plant-list-view>`;
  }
}
