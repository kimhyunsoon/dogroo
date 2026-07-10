import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens } from '../style.js';
import { pushModal } from '../ui.js';
import { icon } from '../icons.js';
import type { Photo } from '../types.js';

// 사진 크게보기 - 가로 스와이프로 넘기기, 뒤로가기(스와이프)로 닫힘
@customElement('photo-lightbox')
export class PhotoLightbox extends LitElement {
  static styles = [
    tokens,
    css`
      .overlay {
        position: fixed;
        inset: 0;
        background: #000;
        z-index: 200;
        display: flex;
        flex-direction: column;
        animation: fade-in 0.18s;
        transition: opacity 0.18s;
      }
      .overlay.closing { opacity: 0; }
      @keyframes fade-in { from { opacity: 0; } }
      .top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: calc(10px + env(safe-area-inset-top)) 16px 10px;
        color: #fff;
        font-size: 0.9rem;
      }
      .top button {
        background: none;
        border: none;
        color: #fff;
        font-size: 1.4rem;
        cursor: pointer;
        padding: 4px 8px;
      }
      .strip {
        flex: 1;
        display: flex;
        overflow-x: auto;
        scroll-snap-type: x mandatory;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      .strip::-webkit-scrollbar { display: none; }
      .strip img {
        width: 100vw;
        height: 100%;
        object-fit: contain;
        scroll-snap-align: center;
        flex-shrink: 0;
      }
      .date {
        text-align: center;
        color: #bbb;
        font-size: 0.8rem;
        padding: 10px 0 calc(14px + env(safe-area-inset-bottom));
      }
    `,
  ];

  @state() private open = false;
  @state() private closing = false;
  @state() private photos: Photo[] = [];
  @state() private index = 0;

  private startIndex = 0;
  private requestClose?: () => void;

  show(photos: Photo[], startIndex = 0): void {
    this.photos = photos;
    this.startIndex = startIndex;
    this.index = startIndex;
    this.open = true;
    this.closing = false;
    this.requestClose = pushModal(() => void this.animateOut());
  }

  private async animateOut(): Promise<void> {
    this.closing = true;
    await new Promise((resolve) => setTimeout(resolve, 190));
    this.open = false;
    this.closing = false;
  }

  protected updated(): void {
    if (!this.open) return;
    const strip = this.renderRoot.querySelector<HTMLElement>('.strip');
    if (strip && strip.dataset.scrolled !== '1') {
      strip.dataset.scrolled = '1';
      strip.scrollLeft = this.startIndex * strip.clientWidth;
    }
  }

  private onScroll(e: Event): void {
    const el = e.target as HTMLElement;
    this.index = Math.round(el.scrollLeft / el.clientWidth);
  }

  render(): TemplateResult | typeof nothing {
    if (!this.open) return nothing;
    const current = this.photos[this.index];
    return html`
      <div class="overlay ${this.closing ? 'closing' : ''}">
        <div class="top">
          <span>${this.index + 1} / ${this.photos.length}</span>
          <button @click=${(): void => this.requestClose?.()} aria-label="닫기">${icon('x', 22)}</button>
        </div>
        <div class="strip" @scroll=${this.onScroll}>
          ${this.photos.map((p) => html`<img src="/api/files/${p.path}" alt="" loading="lazy">`)}
        </div>
        <div class="date">${current?.taken_at?.slice(0, 10) ?? ''}</div>
      </div>
    `;
  }
}
