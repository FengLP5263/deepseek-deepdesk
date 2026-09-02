export interface BrowserCursorPoint {
  x: number
  y: number
}

export type BrowserCursorState = 'idle' | 'move' | 'arrive' | 'hover' | 'activity' | 'click'

export interface BrowserCursorClient {
  call(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
}

const CURSOR_SELECTOR = '[data-deepdesk-browser-cursor="v3"]'
const LEGACY_CURSOR_SELECTOR = '[data-deepdesk-browser-cursor="true"],[data-deepdesk-browser-cursor="v2"]'
const CURSOR_TRAVEL_DURATION_MS = 620
const CURSOR_ARRIVAL_DURATION_MS = 320
const CURSOR_ACTIVITY_DURATION_MS = 420
const CURSOR_CLICK_LEAD_MS = 110
const CURSOR_MARKUP = `<style>
  :host { display: block; }
  svg { display: block; overflow: visible; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .55)); }
  .ring { position: absolute; left: -9px; top: -9px; width: 18px; height: 18px; box-sizing: border-box; border: 2px solid rgba(116, 132, 232, .9); border-radius: 50%; opacity: 0; }
  .badge { position: absolute; left: 17px; top: 20px; height: 16px; padding: 0 5px; border: 1px solid rgba(255, 255, 255, .88); border-radius: 8px; background: #6172e8; color: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, .28); font: 600 10px/15px "Segoe UI", sans-serif; letter-spacing: .2px; white-space: nowrap; }
</style>
<svg data-deepdesk-browser-cursor-icon width="28" height="32" viewBox="0 0 24 28" aria-hidden="true">
  <path d="M0 0V19.7L5.7 14.3L10.2 24.2L14.3 22.3L9.9 12.8H18.8L0 0Z" fill="#202124" stroke="#fff" stroke-width="1.7" stroke-linejoin="round" />
</svg>
<span class="badge" data-deepdesk-browser-cursor-badge>AI</span>
<span class="ring" data-deepdesk-browser-cursor-ring></span>`

export function buildBrowserCursorExpression(point: BrowserCursorPoint | null, state: BrowserCursorState): string {
  const payload = JSON.stringify({
    x: point ? Math.round(point.x * 100) / 100 : null,
    y: point ? Math.round(point.y * 100) / 100 : null,
    state
  })
  return `(() => {
    const payload = ${payload};
    const root = document.documentElement;
    if (!root) return { ok: false };
    document.querySelectorAll(${JSON.stringify(LEGACY_CURSOR_SELECTOR)}).forEach(element => element.remove());
    let cursor = document.querySelector(${JSON.stringify(CURSOR_SELECTOR)});
    let created = false;
    if (!(cursor instanceof HTMLElement)) {
      cursor = document.createElement('div');
      cursor.setAttribute('data-deepdesk-browser-cursor', 'v3');
      cursor.setAttribute('aria-hidden', 'true');
      cursor.attachShadow({ mode: 'open' }).innerHTML = ${JSON.stringify(CURSOR_MARKUP)};
      root.appendChild(cursor);
      created = true;
    }
    const currentX = Number.parseFloat(cursor.style.left);
    const currentY = Number.parseFloat(cursor.style.top);
    const x = typeof payload.x === 'number'
      ? payload.x
      : Number.isFinite(currentX) ? currentX : Math.max(24, Math.round((window.innerWidth - 28) / 2));
    const y = typeof payload.y === 'number'
      ? payload.y
      : Number.isFinite(currentY) ? currentY : Math.max(24, Math.round((window.innerHeight - 32) / 2));
    Object.assign(cursor.style, {
      position: 'fixed',
      width: '28px',
      height: '32px',
      margin: '0',
      padding: '0',
      border: '0',
      background: 'transparent',
      pointerEvents: 'none',
      userSelect: 'none',
      transition: 'none',
      willChange: 'left, top, transform',
      contain: 'layout style'
    });
    cursor.style.setProperty('z-index', '2147483647', 'important');
    cursor.style.setProperty('pointer-events', 'none', 'important');
    cursor.style.setProperty('display', 'block', 'important');
    cursor.style.setProperty('visibility', 'visible', 'important');
    cursor.style.setProperty('opacity', '1', 'important');
    if (created) {
      cursor.style.left = String(x) + 'px';
      cursor.style.top = String(y) + 'px';
    }
    const animateMovement = (activeCursor, targetX, targetY) => {
      const rect = activeCursor.getBoundingClientRect();
      const fromX = rect.left;
      const fromY = rect.top;
      activeCursor.getAnimations().forEach(animation => animation.cancel());
      activeCursor.style.transform = 'none';
      if (Math.hypot(targetX - fromX, targetY - fromY) < 2) {
        activeCursor.style.left = String(targetX) + 'px';
        activeCursor.style.top = String(targetY) + 'px';
        return Promise.resolve();
      }
      const movementKey = '__deepdeskBrowserCursorMovement';
      const sequence = Number(activeCursor[movementKey] || 0) + 1;
      activeCursor[movementKey] = sequence;
      const startedAt = performance.now();
      return new Promise(resolve => {
        const step = now => {
          if (activeCursor[movementKey] !== sequence || !activeCursor.isConnected) {
            resolve();
            return;
          }
          const progress = Math.min(1, Math.max(0, (now - startedAt) / ${CURSOR_TRAVEL_DURATION_MS}));
          const eased = 1 - Math.pow(1 - progress, 3);
          activeCursor.style.left = String(fromX + (targetX - fromX) * eased) + 'px';
          activeCursor.style.top = String(fromY + (targetY - fromY) * eased) + 'px';
          if (progress < 1) setTimeout(() => step(performance.now()), 16);
          else resolve();
        };
        setTimeout(() => step(performance.now()), 16);
      });
    };
    const animateArrival = activeCursor => {
      activeCursor.getAnimations().forEach(animation => animation.cancel());
      const movementKey = '__deepdeskBrowserCursorMovement';
      const sequence = Number(activeCursor[movementKey] || 0) + 1;
      activeCursor[movementKey] = sequence;
      const startedAt = performance.now();
      return new Promise(resolve => {
        const step = now => {
          if (activeCursor[movementKey] !== sequence || !activeCursor.isConnected) {
            resolve();
            return;
          }
          const progress = Math.min(1, Math.max(0, (now - startedAt) / ${CURSOR_ARRIVAL_DURATION_MS}));
          const strength = 1 - progress;
          const wave = Math.sin(progress * Math.PI * 6);
          activeCursor.style.transform = 'translateX(' + String(wave * strength * 5) + 'px) rotate(' + String(wave * strength * 11) + 'deg)';
          if (progress < 1) setTimeout(() => step(performance.now()), 16);
          else {
            activeCursor.style.transform = 'none';
            resolve();
          }
        };
        setTimeout(() => step(performance.now()), 16);
      });
    };
    const animateClick = activeCursor => {
      const shadow = activeCursor.shadowRoot;
      const icon = shadow && shadow.querySelector('[data-deepdesk-browser-cursor-icon]');
      const ring = shadow && shadow.querySelector('[data-deepdesk-browser-cursor-ring]');
      if (ring && typeof ring.animate === 'function') {
        ring.getAnimations().forEach(animation => animation.cancel());
        ring.animate([
          { opacity: .9, transform: 'scale(.45)' },
          { opacity: 0, transform: 'scale(1.65)' }
        ], { duration: 430, easing: 'cubic-bezier(.2,.7,.2,1)' });
      }
      if (icon && typeof icon.animate === 'function') {
        icon.animate([
          { transform: 'scale(1)' },
          { transform: 'scale(.88)' },
          { transform: 'scale(1)' }
        ], { duration: 180, easing: 'ease-out' });
      }
    };
    const animateActivity = activeCursor => {
      activeCursor.getAnimations().forEach(animation => animation.cancel());
      const movementKey = '__deepdeskBrowserCursorMovement';
      const sequence = Number(activeCursor[movementKey] || 0) + 1;
      activeCursor[movementKey] = sequence;
      const startedAt = performance.now();
      return new Promise(resolve => {
        const step = now => {
          if (activeCursor[movementKey] !== sequence || !activeCursor.isConnected) {
            resolve();
            return;
          }
          const progress = Math.min(1, Math.max(0, (now - startedAt) / ${CURSOR_ACTIVITY_DURATION_MS}));
          const angle = progress * Math.PI * 2;
          const strength = Math.sin(progress * Math.PI);
          const offsetX = Math.sin(angle) * strength * 7;
          const offsetY = -Math.sin(progress * Math.PI) * 4;
          activeCursor.style.transform = 'translate(' + String(offsetX) + 'px, ' + String(offsetY) + 'px) rotate(' + String(offsetX * 1.2) + 'deg)';
          if (progress < 1) setTimeout(() => step(performance.now()), 16);
          else {
            activeCursor.style.transform = 'none';
            resolve();
          }
        };
        setTimeout(() => step(performance.now()), 16);
      });
    };
    cursor.dataset.state = payload.state;
    let animationTask = null;
    if (payload.state === 'move') {
      animationTask = animateMovement(cursor, x, y);
    } else {
      cursor.style.left = String(x) + 'px';
      cursor.style.top = String(y) + 'px';
    }
    if (payload.state === 'click') {
      animateClick(cursor);
    } else if (payload.state === 'arrive') {
      animationTask = animateArrival(cursor);
    } else if (payload.state === 'activity') {
      animationTask = animateActivity(cursor);
    } else if (payload.state === 'hover') {
      const badge = cursor.shadowRoot && cursor.shadowRoot.querySelector('[data-deepdesk-browser-cursor-badge]');
      if (badge && typeof badge.animate === 'function') {
        badge.animate([{ transform: 'scale(.88)' }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' });
      }
    } else if (payload.state === 'idle') {
      const badge = cursor.shadowRoot && cursor.shadowRoot.querySelector('[data-deepdesk-browser-cursor-badge]');
      if (badge && typeof badge.animate === 'function') {
        badge.animate([
          { opacity: .62, transform: 'translateY(1px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ], { duration: 320, easing: 'ease-out' });
      }
    }
    const result = { ok: true, x, y, state: payload.state };
    return animationTask ? animationTask.then(() => result) : result;
  })()`
}

export async function showBrowserCursor(client: BrowserCursorClient, point: BrowserCursorPoint | null, state: BrowserCursorState, signal?: AbortSignal): Promise<void> {
  await client.call('Runtime.evaluate', {
    expression: buildBrowserCursorExpression(point, state),
    returnByValue: true,
    awaitPromise: true,
    userGesture: false
  }, signal)
}

export async function showBrowserCursorPresence(client: BrowserCursorClient, signal?: AbortSignal): Promise<void> {
  await showBrowserCursor(client, null, 'idle', signal)
}

export async function showBrowserActivityCue(client: BrowserCursorClient, point: BrowserCursorPoint | null = null, signal?: AbortSignal): Promise<void> {
  await showBrowserCursor(client, point, 'activity', signal)
}

export async function showBrowserHoverCue(client: BrowserCursorClient, point: BrowserCursorPoint, signal?: AbortSignal): Promise<void> {
  await showBrowserCursor(client, point, 'move', signal)
  await showBrowserCursor(client, point, 'arrive', signal)
  await showBrowserCursor(client, point, 'hover', signal)
}

function waitForCursorPhase(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('浏览器操作已取消'), { name: 'AbortError' }))
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, durationMs)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(Object.assign(new Error('浏览器操作已取消'), { name: 'AbortError' }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function showBrowserClickCue(client: BrowserCursorClient, point: BrowserCursorPoint, signal?: AbortSignal): Promise<void> {
  await showBrowserCursor(client, point, 'move', signal)
  await showBrowserCursor(client, point, 'arrive', signal)
  await showBrowserCursor(client, point, 'click', signal)
  await waitForCursorPhase(CURSOR_CLICK_LEAD_MS, signal)
}
