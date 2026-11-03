// 預覽上的小選單（只在螢幕上顯示，不會印出）。

import { h } from './dom.ts';

export interface PopoverAction {
  readonly label: string;
  readonly run: () => void;
}

let current: HTMLElement | null = null;

export function closePopover(): void {
  current?.remove();
  current = null;
}

/** 在 container 內、相對於 container 的 (x, y) 位置顯示選單。 */
export function showPopover(container: HTMLElement, x: number, y: number, title: string, actions: readonly PopoverAction[]): void {
  closePopover();
  const menu = h(
    'div',
    { class: 'popover', attrs: { role: 'menu' }, style: { left: `${Math.round(x)}px`, top: `${Math.round(y)}px` } },
    h('div', { class: 'popover-title', text: title }),
    ...actions.map((a) => {
      const b = h('button', { class: 'btn btn-small', attrs: { type: 'button', role: 'menuitem' }, text: a.label });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        closePopover();
        a.run();
      });
      return b;
    }),
  );
  container.appendChild(menu);
  current = menu;
  menu.querySelector<HTMLButtonElement>('button')?.focus();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePopover();
});
