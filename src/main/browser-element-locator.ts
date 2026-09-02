export interface BrowserElementPoint {
  x: number
  y: number
  tag: string
  text: string
  target: 'content' | 'element'
}

interface BrowserElementClient {
  call(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function buildBrowserElementLocatorExpression(selector: string, editable: boolean): string {
  return `(async () => {
    const locatorVersion = 'deepdesk-visible-content-v1';
    void locatorVersion;
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return { ok: false, error: '未找到元素' };
    if (${editable ? 'true' : 'false'} && !(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement) && !element.isContentEditable) {
      return { ok: false, error: '元素不支持输入' };
    }
    if (element.disabled) return { ok: false, error: '元素已禁用' };
    element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const elementRect = element.getBoundingClientRect();
    if (elementRect.width <= 0 || elementRect.height <= 0) return { ok: false, error: '元素当前不可见' };
    const clipRect = rect => ({
      left: Math.max(1, rect.left),
      top: Math.max(1, rect.top),
      right: Math.min(window.innerWidth - 1, rect.right),
      bottom: Math.min(window.innerHeight - 1, rect.bottom)
    });
    const isVisibleRect = rect => rect.right - rect.left >= 3 && rect.bottom - rect.top >= 3;
    const containsHit = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      return hit === element || (hit instanceof Node && element.contains(hit));
    };
    const pointFromRect = (rawRect, target) => {
      const rect = clipRect(rawRect);
      if (!isVisibleRect(rect)) return null;
      const x = rect.left + (rect.right - rect.left) / 2;
      const y = rect.top + (rect.bottom - rect.top) / 2;
      return containsHit(x, y) ? { x, y, target, area: (rect.right - rect.left) * (rect.bottom - rect.top) } : null;
    };
    const contentPoints = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode) {
      const parent = textNode.parentElement;
      const value = String(textNode.textContent || '').trim();
      if (parent && value) {
        const style = getComputedStyle(parent);
        if (style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0) {
          const range = document.createRange();
          range.selectNodeContents(textNode);
          for (const rect of range.getClientRects()) {
            const point = pointFromRect(rect, 'content');
            if (point) contentPoints.push(point);
          }
        }
      }
      textNode = walker.nextNode();
    }
    for (const visual of element.querySelectorAll('svg, img, [role="img"], [data-icon]')) {
      const style = getComputedStyle(visual);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0) continue;
      const point = pointFromRect(visual.getBoundingClientRect(), 'content');
      if (point) contentPoints.push(point);
    }
    contentPoints.sort((a, b) => b.area - a.area);
    const contentPoint = contentPoints[0];
    const clampX = value => Math.max(1, Math.min(window.innerWidth - 1, value));
    const clampY = value => Math.max(1, Math.min(window.innerHeight - 1, value));
    const fallbackPoint = [
      [.5, .5], [.25, .5], [.75, .5], [.5, .25], [.5, .75],
      [.25, .25], [.75, .25], [.25, .75], [.75, .75]
    ].map(([rx, ry]) => ({
      x: clampX(elementRect.left + elementRect.width * rx),
      y: clampY(elementRect.top + elementRect.height * ry),
      target: 'element'
    })).find(point => containsHit(point.x, point.y));
    const point = contentPoint || fallbackPoint;
    if (!point) return { ok: false, error: '元素被其他内容遮挡' };
    return {
      ok: true,
      x: point.x,
      y: point.y,
      target: point.target,
      tag: element.tagName.toLowerCase(),
      text: String(element.innerText || element.getAttribute('aria-label') || '').trim().slice(0, 200)
    };
  })()`
}

export async function locateBrowserElement(
  client: BrowserElementClient,
  selector: string,
  editable: boolean,
  signal?: AbortSignal
): Promise<BrowserElementPoint> {
  const response = record(await client.call('Runtime.evaluate', {
    expression: buildBrowserElementLocatorExpression(selector, editable),
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  }, signal))
  const exception = record(response?.exceptionDetails)
  if (exception) throw new Error(stringValue(exception.text) || '页面脚本执行失败')
  const result = record(record(response?.result)?.value)
  if (!result?.ok) throw new Error(stringValue(result?.error) || '无法定位页面元素')
  const x = numberValue(result.x)
  const y = numberValue(result.y)
  if (x <= 0 || y <= 0) throw new Error('页面元素不在可操作区域')
  return {
    x,
    y,
    tag: stringValue(result.tag),
    text: stringValue(result.text),
    target: result.target === 'content' ? 'content' : 'element'
  }
}
