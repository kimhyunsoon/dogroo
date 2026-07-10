import { css } from 'lit';

// 컴포넌트 공통 기반 - 테마 색상 변수는 index.html의 :root에서 상속받는다
export const tokens = css`
  :host {
    font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', sans-serif;
    color: var(--text);
    -webkit-tap-highlight-color: transparent;
  }
  * {
    box-sizing: border-box;
  }
`;

// 공용 컴포넌트 스타일 (버튼·입력·카드·배지·시트)
export const ui = css`
  button, .btn {
    font: inherit;
    border: none;
    cursor: pointer;
    -webkit-touch-callout: none;
    user-select: none;
  }
  .btn-primary {
    background: var(--green);
    color: #fff;
    border-radius: 12px;
    padding: 13px 18px;
    font-size: 1rem;
    font-weight: 700;
    width: 100%;
  }
  .btn-soft {
    background: var(--green-soft);
    color: var(--green);
    border-radius: 10px;
    padding: 9px 14px;
    font-weight: 700;
    font-size: 0.9rem;
  }
  .btn-ghost {
    background: none;
    color: var(--text-sub);
    padding: 8px;
    font-size: 0.88rem;
  }
  input, select, textarea {
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 11px 12px;
    width: 100%;
  }
  input:focus, select:focus, textarea:focus {
    outline: 2px solid var(--green);
    outline-offset: -1px;
    border-color: transparent;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 14px 16px;
  }
  .badge {
    display: inline-block;
    font-size: 0.76rem;
    font-weight: 700;
    padding: 2px 9px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .badge.over { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger); }
  .badge.today { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); }
  .badge.ok { background: var(--green-soft); color: var(--green); }
  .badge.none { background: var(--border); color: var(--text-sub); }
  .sub {
    color: var(--text-sub);
    font-size: 0.85rem;
  }
  a {
    color: inherit;
    text-decoration: none;
  }
  /* 애플 스타일 세그먼티드 컨트롤 */
  .segmented {
    display: flex;
    background: var(--border);
    border-radius: 10px;
    padding: 2px;
    gap: 2px;
  }
  .segmented button {
    flex: 1;
    padding: 7px 0;
    border-radius: 8px;
    background: none;
    color: var(--text-sub);
    font-size: 0.86rem;
    font-weight: 600;
  }
  .segmented button.on {
    background: var(--surface);
    color: var(--text);
    font-weight: 700;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }
`;

// 바텀시트 공통 스타일 (Lit 시트 컴포넌트용)
export const sheet = css`
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 100;
    display: flex;
    align-items: flex-end;
    animation: fade-in 0.18s;
    transition: opacity 0.18s;
  }
  .overlay.closing { opacity: 0; }
  .panel {
    background: var(--bg);
    width: 100%;
    max-height: 88dvh;
    border-radius: 18px 18px 0 0;
    display: flex;
    flex-direction: column;
    animation: slide-up 0.22s cubic-bezier(0.2, 0.9, 0.3, 1);
    transition: transform 0.18s ease-out;
  }
  .overlay.closing .panel { transform: translateY(105%); transition: transform 0.18s ease-in; }
  .drag-zone {
    touch-action: none;
    flex-shrink: 0;
    cursor: grab;
  }
  .grabber {
    width: 38px;
    height: 5px;
    border-radius: 999px;
    background: var(--border);
    margin: 8px auto 2px;
  }
  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
  }
  .panel-head h2 { font-size: 1.05rem; margin: 0; }
  .panel-body {
    overflow-y: auto;
    padding: 0 16px calc(20px + env(safe-area-inset-bottom));
    -webkit-overflow-scrolling: touch;
  }
  @keyframes slide-up { from { transform: translateY(45%); opacity: 0.6; } }
  @keyframes fade-in { from { opacity: 0; } }
`;
