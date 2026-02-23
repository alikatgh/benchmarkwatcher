export type ThemeFlavor = 'standard' | 'mono' | 'bloomberg' | 'ft';
export type MarketTheme = 'western' | 'asian' | 'monochrome';

export interface SettingsContextType {
    isDarkMode: boolean;
    setIsDarkMode: (val: boolean) => void;
    themeFlavor: ThemeFlavor;
    setThemeFlavor: (val: ThemeFlavor) => void;
    marketTheme: MarketTheme;
    setMarketTheme: (val: MarketTheme) => void;
    fontScale: 'small' | 'medium' | 'large';
    setFontScale: (val: 'small' | 'medium' | 'large') => void;
    density: 'compact' | 'cozy' | 'roomy';
    setDensity: (val: 'compact' | 'cozy' | 'roomy') => void;
    syncEnabled: boolean;
    setSyncEnabled: (val: boolean) => void;
    syncTrigger: number;
    forceSync: () => void;

    // Grid Visibility columns
    showCategory: boolean;
    setShowCategory: (val: boolean) => void;
    showChangePercent: boolean;
    setShowChangePercent: (val: boolean) => void;
    showChangeAbs: boolean;
    setShowChangeAbs: (val: boolean) => void;
    showDate: boolean;
    setShowDate: (val: boolean) => void;
    showUnit: boolean;
    setShowUnit: (val: boolean) => void;
}
