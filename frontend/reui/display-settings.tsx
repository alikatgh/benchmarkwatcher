import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, Monitor, Moon, Sun, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { Separator } from './ui/separator';

const themes = [
  ['light', 'Light', 'Warm cream', 'Light theme with warm cream colors'],
  ['dark', 'Dark', 'Low light', 'Dark theme with terminal colors'],
  ['mono-light', 'Mono light', 'Black on white', 'Monochrome light theme'],
  ['mono-dark', 'Mono dark', 'White on black', 'Monochrome dark theme'],
  ['bloomberg', 'Terminal', 'Amber on black', 'Bloomberg terminal theme'],
  ['ft', 'Paper', 'Warm paper', 'Financial Times theme'],
];

type SettingsAPI = { updateUI(): void; toggle(): void; setTheme(value: string): void; setMarketTheme(value: string): void; setView(value: string): void };

export function installDisplaySettings(api: SettingsAPI) {
  const fallback = document.getElementById('settings-modal');
  if (!fallback || fallback.dataset.reuiReady) return;
  const host = document.createElement('div');
  host.className = 'reui style-nova';
  host.dataset.reuiSettings = '';
  fallback.replaceWith(host);
  let toggle = () => {};
  api.toggle = () => toggle();
  createRoot(host).render(<Settings />);

  function Settings() {
    const [open, setOpen] = useState(false);
    const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light');
    const [market, setMarket] = useState(document.documentElement.dataset.market || 'western');
    const opener = document.getElementById('settings-button');
    toggle = () => setOpen(value => !value);
    useEffect(() => {
      const observer = new MutationObserver(() => {
        setTheme(document.documentElement.dataset.theme || 'light');
        setMarket(document.documentElement.dataset.market || 'western');
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-market'] });
      return () => observer.disconnect();
    }, []);
    useEffect(() => { opener?.setAttribute('aria-expanded', String(open)); }, [open, opener]);
    return <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent id="settings-modal" className="rui-settings" showCloseButton={false}
        onOpenAutoFocus={() => api.updateUI()}
        onCloseAutoFocus={event => { event.preventDefault(); opener?.focus(); }}>
        <div className="rui-modal-heading">
          <div><DialogTitle id="settings-title">Display settings</DialogTitle><DialogDescription>Make this workspace comfortable to read.</DialogDescription></div>
          <Button variant="ghost" size="icon" aria-label="Close settings" onClick={() => setOpen(false)}><X /></Button>
        </div>
        <section aria-labelledby="rui-theme-label">
          <h3 id="rui-theme-label">Appearance</h3>
          <ToggleGroup type="single" value={theme} onValueChange={value => { if (value) api.setTheme(value); }} className="rui-theme-grid" aria-labelledby="rui-theme-label">
            {themes.map(([value, label, description, ariaLabel]) => <ToggleGroupItem key={value} id={'theme-' + value} value={value} aria-label={ariaLabel} className="rui-theme-option">
              <span className="rui-theme-preview" data-preview={value} aria-hidden="true"><i /><span><b /><b /><b /></span></span>
              <span className="rui-theme-caption"><span>{label}</span>{theme === value && <Check size={13} aria-hidden="true" />}</span>
              <small>{description}</small>
            </ToggleGroupItem>)}
          </ToggleGroup>
        </section>
        <Separator />
        <section aria-labelledby="rui-market-label">
          <h3 id="rui-market-label">Historical change colors</h3><p className="rui-help">Choose how increases and decreases appear.</p>
          <ToggleGroup type="single" value={market} onValueChange={value => { if (value) api.setMarketTheme(value); }} className="rui-market-group" aria-labelledby="rui-market-label">
            {[['western', 'Green up', '↑ Green · ↓ Red'], ['asian', 'Red up', '↑ Red · ↓ Green'], ['monochrome', 'Neutral', '↑ / ↓ Monochrome']].map(([value, label, detail]) => <ToggleGroupItem key={value} id={'market-' + value} value={value} className="rui-market-option"><span>{label}</span><small>{detail}</small></ToggleGroupItem>)}
          </ToggleGroup>
        </section>
        {document.getElementById('table-workspace') && <><Separator /><section aria-labelledby="rui-layout-label"><h3 id="rui-layout-label">Benchmark layout</h3><div className="rui-layout-options"><Button id="view-compact" variant="outline" onClick={() => api.setView('compact')}><Monitor />Table</Button><Button id="view-grid" variant="outline" onClick={() => api.setView('grid')}>Cards</Button></div></section></>}
        <div className="rui-settings-footer"><span><Sun size={13} aria-hidden="true" /><Moon size={13} aria-hidden="true" /> Saved in this browser</span><Button onClick={() => setOpen(false)}>Done</Button></div>
      </DialogContent>
    </Dialog>;
  }
}
