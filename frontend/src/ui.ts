// 라이트 DOM 공용 UI 헬퍼 - 모달 히스토리 스택, 배경 스크롤 잠금, 토스트, 길게 누르기 제스처

// ── 배경 스크롤 잠금 (iOS 대응: body를 fixed로 고정) ─────────────
let lockCount = 0;
let savedScrollY = 0;

function lockScroll(): void {
  if (++lockCount > 1) return;
  savedScrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${savedScrollY}px`;
  document.body.style.width = '100%';
}

function unlockScroll(): void {
  if (lockCount === 0) return;
  if (--lockCount > 0) return;
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  window.scrollTo(0, savedScrollY);
}

// ── 모달 히스토리 스택 ──────────────────────────────────────────
// 모든 모달 닫기는 history.back()을 경유한다.
// → iOS 엣지 스와이프(뒤로가기) = popstate와 완전히 같은 경로로 닫혀 상태가 꼬이지 않음.
interface ModalEntry {
  close: () => void;
}
const modalStack: ModalEntry[] = [];

window.addEventListener('popstate', () => {
  const entry = modalStack.pop();
  if (entry) {
    unlockScroll();
    entry.close();
  }
});

// 안전망: 모달이 열린 채 라우트가 강제로 바뀌면(예: 세션 만료 → 로그인 전환)
// 모달 요소는 뷰와 함께 사라지므로 스택과 스크롤 잠금만 정리한다
window.addEventListener('hashchange', () => {
  while (modalStack.length > 0) {
    modalStack.pop();
    unlockScroll();
  }
});

/**
 * 모달을 히스토리에 등록한다. 열려있는 동안 배경 스크롤이 잠긴다.
 * @param onClose 닫힐 때(뒤로가기·스와이프·requestClose) 한 번 실행
 * @returns requestClose - 호출하면 history.back()으로 닫힌다
 */
export function pushModal(onClose: () => void): () => void {
  const entry: ModalEntry = { close: onClose };
  modalStack.push(entry);
  lockScroll();
  history.pushState({ modal: modalStack.length }, '');
  return (): void => {
    if (modalStack.includes(entry)) history.back();
  };
}

// ── 토스트 ─────────────────────────────────────────────────────
const TOAST_STYLE =
  'position:fixed;left:50%;bottom:max(24px, env(safe-area-inset-bottom));transform:translateX(-50%);' +
  'background:#1f2a1f;color:#fff;padding:12px 18px;border-radius:12px;display:flex;gap:14px;' +
  'align-items:center;font:600 0.92rem -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;' +
  'box-shadow:0 4px 16px rgba(0,0,0,0.25);z-index:1000;max-width:90vw;';

let activeToast: HTMLElement | null = null;

/**
 * 하단 토스트 표시 (인아웃 애니메이션). actionLabel을 주면 액션 버튼(예: 취소)이 붙는다.
 * @param duration 자동 닫힘(ms), 기본 5초
 */
export function toast(
  message: string,
  opts?: { actionLabel?: string; onAction?: () => void; duration?: number },
): void {
  activeToast?.remove();
  const el = document.createElement('div');
  el.style.cssText = TOAST_STYLE;

  let dismissed = false;
  const dismiss = (): void => {
    if (dismissed) return;
    dismissed = true;
    el.animate(
      [
        { opacity: 1, transform: 'translateX(-50%)' },
        { opacity: 0, transform: 'translateX(-50%) translateY(12px)' },
      ],
      { duration: 180, easing: 'ease-in', fill: 'forwards' },
    ).finished.then(() => el.remove());
  };

  const span = document.createElement('span');
  span.textContent = message;
  // 한 줄 유지, 넘치면 말줄임
  span.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;';
  el.appendChild(span);
  if (opts?.actionLabel) {
    const btn = document.createElement('button');
    btn.textContent = opts.actionLabel;
    btn.style.cssText =
      'font:inherit;background:none;border:none;color:#8fd89f;font-weight:700;cursor:pointer;padding:2px;white-space:nowrap;';
    btn.onclick = (): void => {
      dismiss();
      opts.onAction?.();
    };
    el.appendChild(btn);
  }
  document.body.appendChild(el);
  activeToast = el;
  el.animate(
    [
      { opacity: 0, transform: 'translateX(-50%) translateY(16px)' },
      { opacity: 1, transform: 'translateX(-50%)' },
    ],
    { duration: 220, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.1)' },
  );
  setTimeout(dismiss, opts?.duration ?? 5000);
}

// ── 확인 다이얼로그 (window.confirm 대체, 인아웃 애니메이션) ─────
const FONT = '-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif';

export function uiConfirm(
  message: string,
  opts?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1200;display:grid;place-items:center;padding:32px;';
    const box = document.createElement('div');
    box.style.cssText =
      `background:var(--surface,#fff);color:var(--text,#1f2a1f);border-radius:16px;max-width:300px;width:100%;` +
      `overflow:hidden;font-family:${FONT};box-shadow:0 10px 40px rgba(0,0,0,0.25);`;
    const msg = document.createElement('div');
    msg.style.cssText = 'padding:22px 20px 18px;text-align:center;font-size:0.95rem;line-height:1.55;white-space:pre-wrap;';
    msg.textContent = message;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;border-top:1px solid rgba(128,128,128,0.25);';

    const close = (value: boolean): void => {
      overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' });
      box
        .animate([{ transform: 'scale(1)' }, { transform: 'scale(0.94)' }], { duration: 140, fill: 'forwards' })
        .finished.then(() => {
          overlay.remove();
          resolve(value);
        });
    };

    const makeButton = (label: string, style: string, value: boolean): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = `flex:1;padding:14px;font:600 0.95rem ${FONT};background:none;border:none;cursor:pointer;${style}`;
      btn.onclick = (): void => close(value);
      return btn;
    };
    row.appendChild(makeButton(opts?.cancelLabel ?? '취소', 'color:var(--text-sub,#5b6b5b);', false));
    const confirmColor = opts?.danger ? 'var(--danger,#c0392b)' : 'var(--green,#3d7a4a)';
    const confirmBtn = makeButton(opts?.confirmLabel ?? '확인', `color:${confirmColor};font-weight:700;`, true);
    confirmBtn.style.borderLeft = '1px solid rgba(128,128,128,0.25)';
    row.appendChild(confirmBtn);

    box.appendChild(msg);
    box.appendChild(row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 });
    box.animate(
      [{ transform: 'scale(0.92)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: 170, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.15)' },
    );
  });
}

// ── 길게 누르기 제스처 ──────────────────────────────────────────
// 탭과 길게 누르기(550ms)를 구분
export class Press {
  private timer: number | undefined;
  private long = false;
  private startX = 0;
  private startY = 0;

  constructor(
    private onTap: () => void,
    private onLong: () => void,
  ) {}

  down = (e: PointerEvent): void => {
    this.long = false;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.timer = window.setTimeout(() => {
      this.long = true;
      this.onLong();
    }, 550);
  };

  move = (e: PointerEvent): void => {
    if (Math.hypot(e.clientX - this.startX, e.clientY - this.startY) > 12) this.clear();
  };

  up = (): void => {
    this.clear();
  };

  click = (e: Event): void => {
    if (this.long) {
      e.preventDefault();
      e.stopPropagation();
      this.long = false;
      return;
    }
    this.onTap();
  };

  private clear(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
