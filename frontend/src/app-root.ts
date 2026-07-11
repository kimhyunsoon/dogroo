import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import { tokens } from './style.js';
import { parseHash, initialRoute, rememberTab } from './router.js';
import { scrollStore } from './store.js';
import './views/login-view.js';
import './views/today-view.js';
import './views/plants-view.js';
import './views/plant-detail-view.js';
import './views/settings-view.js';
import './components/tab-bar.js';

// 해시 라우터: #/login #/today #/plants #/plants/:id #/settings
// 정렬 등 뷰 상태는 해시 쿼리(#/plants?view=...)에 replaceState로 기록 - keyed 키는 경로만 사용
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
        animation: view-in 0.22s ease-out;
      }
      @keyframes view-in {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: none; }
      }
    `,
  ];

  @state() private route = initialRoute();

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('hashchange', this.onHashChange);
    rememberTab(parseHash(this.route).path);
  }

  disconnectedCallback(): void {
    window.removeEventListener('hashchange', this.onHashChange);
    super.disconnectedCallback();
  }

  private onHashChange = (): void => {
    scrollStore.save(parseHash(this.route).path, window.scrollY);
    this.route = location.hash || '#/today';
    rememberTab(parseHash(this.route).path);
  };

  // 뷰 재생성 후 이전 스크롤 위치 복원 (상세→목록 복귀 체감 개선)
  protected updated(changed: Map<string, unknown>): void {
    if (!changed.has('route')) return;
    const { path } = parseHash(this.route);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.scrollTo(0, scrollStore.get(path)));
    });
  }

  private renderView(path: string): TemplateResult {
    if (path.startsWith('#/login')) return html`<login-view></login-view>`;
    if (path.startsWith('#/settings')) return html`<settings-view></settings-view>`;
    const detail = path.match(/^#\/plants\/(\d+)$/);
    if (detail) return html`<plant-detail-view plant-id=${detail[1]!}></plant-detail-view>`;
    if (path.startsWith('#/plants')) return html`<plants-view></plants-view>`;
    return html`<today-view></today-view>`;
  }

  render(): TemplateResult {
    const { path } = parseHash(this.route);
    const showTabs =
      path.startsWith('#/today') ||
      path === '#/plants' ||
      path.startsWith('#/settings') ||
      path === '' ||
      path === '#/';
    return html`
      ${keyed(path, html`<div class="view">${this.renderView(path)}</div>`)}
      ${showTabs ? html`<tab-bar .active=${path || '#/today'}></tab-bar>` : nothing}
    `;
  }
}
