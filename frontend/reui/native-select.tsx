import { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from './ui/command';
import { Button } from './ui/button';
import { portalHost } from './utils';

const targets = '.gr-filter select, .gr-chart-controls select, #tw-filters select, #tw-view-select, #tw-density';
const mounted = new Map<HTMLSelectElement, { root: Root; host: HTMLElement; update(): void; dispose(): void }>();
const EMPTY = '__bw_reui_all__';

function labelFor(select: HTMLSelectElement) {
  if (select.getAttribute('aria-label')) return select.getAttribute('aria-label')!;
  const label = select.labels?.[0]?.cloneNode(true) as HTMLElement | undefined;
  label?.querySelectorAll('select, .reui').forEach(node => node.remove());
  return label?.textContent?.trim() || select.name || 'Choose an option';
}

function enhance(select: HTMLSelectElement) {
  if (mounted.has(select) || select.closest('.reui') || select.multiple || select.size > 1) return;
  const label = labelFor(select);
  const host = document.createElement('span');
  host.className = 'reui style-nova rui-select-host';
  host.dataset.reuiSelect = select.id || select.name;
  select.after(host);
  let snapshot = '';
  const listeners = new Set<() => void>();
  const getSnapshot = () => JSON.stringify([select.value, select.disabled, [...select.options].map(option => [option.value, option.text, option.disabled])]);
  const update = () => { const next = getSnapshot(); if (snapshot === next) return; snapshot = next; listeners.forEach(listener => listener()); };
  update();
  const observer = new MutationObserver(update);
  observer.observe(select, { attributes: true, childList: true, subtree: true, characterData: true });
  select.addEventListener('change', update);
  select.form?.addEventListener('reset', onReset);
  function onReset() { queueMicrotask(update); }
  const root = createRoot(host);
  mounted.set(select, { root, host, update, dispose() { observer.disconnect(); select.removeEventListener('change', update); select.form?.removeEventListener('reset', onReset); } });
  root.render(<NativeSelect />);
  // Keep the actual field for GET serialization and legacy controller events.
  select.hidden = true;
  select.dataset.reuiEnhanced = 'true';

  function NativeSelect() {
    useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, () => snapshot);
    const [open, setOpen] = useState(false);
    useEffect(() => {
      if (!open) return;
      const closeWhenHidden = () => {
        if (!host.getClientRects().length || host.closest('dialog:not([open])')) setOpen(false);
      };
      const visibility = new MutationObserver(closeWhenHidden);
      let parent = host.parentElement;
      while (parent && parent !== document.body) {
        visibility.observe(parent, { attributes: true, attributeFilter: ['hidden', 'open', 'inert', 'class'] });
        parent = parent.parentElement;
      }
      const dialog = host.closest('dialog');
      dialog?.addEventListener('close', closeWhenHidden);
      return () => { visibility.disconnect(); dialog?.removeEventListener('close', closeWhenHidden); };
    }, [open]);
    const options = [...select.options];
    const commit = (value: string) => {
      select.value = value === EMPTY ? '' : value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      update();
      setOpen(false);
    };
    const selected = options.find(option => option.value === select.value);
    const props = { 'aria-label': label, disabled: select.disabled, 'aria-required': select.required || undefined };
    if (options.length > 12) return <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant="outline" className="rui-select-trigger" {...props} role="combobox" aria-expanded={open}><span>{selected?.text || label}</span><ChevronsUpDown size={14} aria-hidden="true" /></Button></PopoverTrigger>
      <PopoverContent aria-label={'Find ' + label.toLowerCase()} portalContainer={portalHost(host)} className="rui-combobox" align="start" collisionPadding={12} onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); }}>
        <Command label={'Find ' + label.toLowerCase()}><CommandInput placeholder={'Find ' + label.toLowerCase() + '…'} aria-label={'Find ' + label.toLowerCase()} /><CommandList><CommandEmpty>No matching options.</CommandEmpty>{options.map(option => <CommandItem key={option.value} value={option.value || EMPTY} keywords={[option.text]} disabled={option.disabled} onSelect={() => commit(option.value || EMPTY)}><span>{option.text}</span>{option.value === select.value && <Check size={14} aria-hidden="true" />}</CommandItem>)}</CommandList></Command>
      </PopoverContent>
    </Popover>;
    return <Select value={select.value || EMPTY} onValueChange={commit} disabled={select.disabled} open={open} onOpenChange={setOpen}>
      <SelectTrigger className="rui-select-trigger" {...props}><SelectValue>{selected?.text || label}</SelectValue></SelectTrigger>
      <SelectContent portalContainer={portalHost(host)} position="popper" align="start" collisionPadding={12} onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); }}>{options.map(option => <SelectItem key={option.value} value={option.value || EMPTY} disabled={option.disabled}>{option.text}</SelectItem>)}</SelectContent>
    </Select>;
  }
}

export function installNativeSelects() {
  const scan = () => {
    for (const [select, item] of mounted) {
      if (!select.isConnected) { item.dispose(); item.root.unmount(); item.host.remove(); mounted.delete(select); }
    }
    document.querySelectorAll<HTMLSelectElement>(targets).forEach(enhance);
  };
  scan();
  // Only DOM additions matter: existing controllers still own their panels.
  new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches('select, dialog') || node.querySelector('select'))))) scan();
  }).observe(document.getElementById('main-content') || document.body, { childList: true, subtree: true });
  const update = () => mounted.forEach(item => item.update());
  document.addEventListener('bw:table-view-change', update);
  document.addEventListener('bw:table-ready', () => { scan(); update(); });
}
