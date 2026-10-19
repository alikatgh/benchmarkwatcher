import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...values: ClassValue[]) => twMerge(clsx(values));

/** Portals share the product theme and remain inside native modal top layers. */
export function portalHost(near?: Element): HTMLElement {
  const parent = near?.closest('dialog[open]') || document.body;
  let host = Array.from(parent.children).find(node => node.hasAttribute('data-reui-portals')) as HTMLElement | undefined;
  if (!host) {
    host = document.createElement('div');
    host.className = 'reui style-nova';
    host.setAttribute('data-reui-portals', '');
    parent.append(host);
  }
  return host;
}
