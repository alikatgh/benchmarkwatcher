export type ThemeFlavor = 'standard' | 'mono' | 'bloomberg' | 'ft';
export type MarketTheme = 'western' | 'asian' | 'monochrome';
export type ChartThemeName = 'default' | 'ocean' | 'sunset' | 'forest' | 'midnight' | 'neon' | 'pastel' | 'monochrome';

export interface ChartThemePreset {
    name: ChartThemeName;
    label: string;
    lineColor: string;
    fillColor: string;
    fillOpacity: number;
    gridColor: string;
    backgroundColor: string;
}

export interface ChartSettings {
    chartTheme: ChartThemeName;
    chartLineColor: string;
    chartFillColor: string;
    chartFillOpacity: number;
    chartFillEnabled: boolean;
    chartGridVisible: boolean;
    chartGridColor: string;
    chartAnimationEnabled: boolean;
    chartLineTension: number;
    chartSmoothCurve: boolean;
    chartAutoFitBounds: boolean;
}

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

    // Chart appearance settings
    chartSettings: ChartSettings;
    updateChartSettings: (settings: Partial<ChartSettings>) => void;
    resetChartSettings: () => void;
}
