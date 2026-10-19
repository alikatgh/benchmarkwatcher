import { installWorkspaceSearch } from './workspace-search';
import { installDisplaySettings } from './display-settings';
import { installNativeSelects } from './native-select';

const bw = (window as unknown as { BW: {
  ReUI?: { installWorkspaceSearch: typeof installWorkspaceSearch };
  SettingsModal?: Parameters<typeof installDisplaySettings>[0];
} }).BW;
bw.ReUI = { installWorkspaceSearch };
const init = () => {
  if (bw.SettingsModal) installDisplaySettings(bw.SettingsModal);
  installNativeSelects();
  document.documentElement.dataset.reui = 'ready';
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
