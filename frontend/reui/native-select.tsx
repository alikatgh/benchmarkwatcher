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
let uninstall: (() => void) | null = null;

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
  let optionRevision = 0;
  let options = [...select.options].map(option => ({ value: option.value, text: option.text, disabled: option.disabled }));
  const wasHidden = select.hidden;
  const listeners = new Set<() => void>();
  const update = (optionsChanged = false) => {
    if (optionsChanged) {
      options = [...select.options].map(option => ({ value: option.value, text: option.text, disabled: option.disabled }));
      optionRevision += 1;
    }
    const next = JSON.stringify([select.value, select.disabled, select.required, optionRevision]);
    if (snapshot === next) return;
    snapshot = next; listeners.forEach(listener => listener());
  };
  update();
  const observer = new MutationObserver(() => update(true));
  observer.observe(select, { attributes: true, attributeFilter: ['disabled', 'required', 'value', 'label', 'selected'], childList: true, subtree: true, characterData: true });
  const onChange = () => update();
  select.addEventListener('change', onChange);
  select.form?.addEventListener('reset', onReset);
  function onReset() { queueMicrotask(update); }
  const root = createRoot(host);
  mounted.set(select, { root, host, update, dispose() { observer.disconnect(); select.removeEventListener('change', onChange); select.form?.removeEventListener('reset', onReset); select.hidden = wasHidden; delete select.dataset.reuiEnhanced; } });
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
  if (uninstall) return uninstall;
  const scan = (root: ParentNode = document) => {
    if (root instanceof Element) {
      // React's own hidden select and menu DOM are not legacy fields.
      if (!(root instanceof HTMLElement) || root.closest('.reui')) return;
      if (root.matches(targets)) enhance(root as HTMLSelectElement);
    }
    root.querySelectorAll<HTMLSelectElement>('select').forEach(select => { if (select.matches(targets)) enhance(select); });
  };
  scan();
  const observer = new MutationObserver(records => {
    let removed = false;
    for (const record of records) {
      if (record.removedNodes.length) removed = true;
      for (const node of record.addedNodes) if (node instanceof Element) scan(node);
    }
    if (removed) for (const [select, item] of mounted) {
      if (!select.isConnected) { item.dispose(); item.root.unmount(); item.host.remove(); mounted.delete(select); }
    }
  });
  observer.observe(document.getElementById('main-content') || document.body, { childList: true, subtree: true });
  const update = () => mounted.forEach(item => item.update());
  // Existing fields keep their option observer; a view change only synchronizes values.
  const ready = () => { scan(); update(); };
  document.addEventListener('bw:table-view-change', update);
  document.addEventListener('bw:table-ready', ready);
  uninstall = () => {
    observer.disconnect();
    document.removeEventListener('bw:table-view-change', update);
    document.removeEventListener('bw:table-ready', ready);
    for (const item of mounted.values()) { item.dispose(); item.root.unmount(); item.host.remove(); }
    mounted.clear(); uninstall = null;
  };
  return uninstall;
}
