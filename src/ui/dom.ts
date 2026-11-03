// 極簡的 DOM 建構工具。一律用 textContent 放文字，不使用 innerHTML，
// 所以匯入的存檔內容不會被當成 HTML 執行。

type Child = Node | string | null | undefined | false;

export interface ElementOptions {
  readonly class?: string | readonly (string | false | null | undefined)[];
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  readonly dataset?: Readonly<Record<string, string>>;
  /** 以 CSSOM 設定樣式（不受 CSP 對 style 屬性的限制）。值為 null 時略過。 */
  readonly style?: Readonly<Record<string, string | null | undefined>>;
}

function applyOptions(el: Element, options: ElementOptions): void {
  if (options.class !== undefined) {
    const classes = typeof options.class === 'string' ? [options.class] : options.class;
    for (const c of classes) if (c) el.classList.add(...c.split(/\s+/).filter(Boolean));
  }
  if (options.text !== undefined) el.textContent = options.text;
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      if (value === null || value === undefined || value === false) continue;
      el.setAttribute(name, value === true ? '' : String(value));
    }
  }
  if (options.dataset && (el instanceof HTMLElement || el instanceof SVGElement)) {
    for (const [name, value] of Object.entries(options.dataset)) el.dataset[name] = value;
  }
  if (options.style && (el instanceof HTMLElement || el instanceof SVGElement)) {
    for (const [name, value] of Object.entries(options.style)) {
      if (value !== null && value !== undefined) el.style.setProperty(name, value);
    }
  }
}

function append(el: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyOptions(el, options);
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  applyOptions(el, options);
  append(el, children);
  return el;
}

/** 把文字依換行切成段落，去掉空白行。 */
export function paragraphs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
