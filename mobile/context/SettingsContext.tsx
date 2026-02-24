import React, { createContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'nativewind';

import { ThemeFlavor, MarketTheme, SettingsContextType, ChartSettings, ChartThemeName } from '../types/settings';

export type FontScale = 'small' | 'medium' | 'large';
export type Density = 'compact' | 'cozy' | 'roomy';

const DEFAULT_CHART_SETTINGS: ChartSettings = {
    chartTheme: 'default',
    chartLineColor: '59, 130, 246',
    chartFillColor: '59, 130, 246',
    chartFillOpacity: 0.3,
    chartFillEnabled: false,
    chartGridVisible: true,
    chartGridColor: 'rgba(148,163,184,0.25)',
    chartAnimationEnabled: true,
    chartLineTension: 0.4,
    chartSmoothCurve: true,
    chartAutoFitBounds: true,
};

interface SettingsContextProps extends SettingsContextType {
    getMarketColors: (isUp: boolean) => { textColor: string, bgColor: string, badgeColor: string, chartColor: string };
}

export const SettingsContext = createContext<SettingsContextProps>({
    isDarkMode: false,
    setIsDarkMode: () => { },
    themeFlavor: 'standard',
    setThemeFlavor: () => { },
    syncEnabled: true,
    setSyncEnabled: () => { },
    forceSync: () => { },
    syncTrigger: 0,
    showCategory: true,
    setShowCategory: () => { },
    showChangePercent: true,
    setShowChangePercent: () => { },
    showChangeAbs: true,
    setShowChangeAbs: () => { },
    showDate: true,
    setShowDate: () => { },
    showUnit: true,
    setShowUnit: () => { },
    fontScale: 'medium',
    setFontScale: () => { },
    density: 'cozy',
    setDensity: () => { },
    marketTheme: 'western',
    setMarketTheme: () => { },
    chartSettings: DEFAULT_CHART_SETTINGS,
    updateChartSettings: () => { },
    resetChartSettings: () => { },
    getMarketColors: () => ({ textColor: '', bgColor: '', badgeColor: '', chartColor: '' })
});

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
    const { colorScheme, setColorScheme } = useColorScheme();
    const [isDarkMode, setDarkModeState] = useState(colorScheme === 'dark');
    const [themeFlavor, setThemeFlavorState] = useState<ThemeFlavor>('standard');
    const [syncEnabled, setSyncEnabledState] = useState(true);
    const [syncTrigger, setSyncTrigger] = useState(0);

    // Grid Settings State
    const [showCategory, setShowCategoryState] = useState(true);
    const [showChangePercent, setShowChangePercentState] = useState(true);
    const [showChangeAbs, setShowChangeAbsState] = useState(true);
    const [showDate, setShowDateState] = useState(true);
    const [showUnit, setShowUnitState] = useState(true);
    const [fontScale, setFontScaleState] = useState<FontScale>('medium');
    const [density, setDensityState] = useState<Density>('cozy');
    const [marketTheme, setMarketThemeState] = useState<MarketTheme>('western');
    const [chartSettings, setChartSettingsState] = useState<ChartSettings>(DEFAULT_CHART_SETTINGS);

    useEffect(() => {
        // Load all persisted settings in a single multiGet call
        const loadSettings = async () => {
            try {
                const keys = [
                    '@dark_mode', '@theme_flavor', '@sync_enabled',
                    '@show_cat', '@show_chg_pct', '@show_chg_abs',
                    '@show_date', '@show_unit', '@font_scale',
                    '@density', '@market_theme', '@chart_settings',
                ];
                const pairs = await AsyncStorage.multiGet(keys);
                const stored = Object.fromEntries(pairs.map(([k, v]) => [k, v]));

                if (stored['@dark_mode'] !== null) {
                    const isDark = stored['@dark_mode'] === 'true';
                    setDarkModeState(isDark);
                    setColorScheme(isDark ? 'dark' : 'light');
                }
                if (stored['@theme_flavor']) setThemeFlavorState(stored['@theme_flavor'] as ThemeFlavor);
                if (stored['@sync_enabled'] !== null) setSyncEnabledState(stored['@sync_enabled'] === 'true');

                if (stored['@show_cat'] !== null) setShowCategoryState(stored['@show_cat'] === 'true');
                if (stored['@show_chg_pct'] !== null) setShowChangePercentState(stored['@show_chg_pct'] === 'true');
                if (stored['@show_chg_abs'] !== null) setShowChangeAbsState(stored['@show_chg_abs'] === 'true');
                if (stored['@show_date'] !== null) setShowDateState(stored['@show_date'] === 'true');
                if (stored['@show_unit'] !== null) setShowUnitState(stored['@show_unit'] === 'true');
                if (stored['@font_scale']) setFontScaleState(stored['@font_scale'] as FontScale);
                if (stored['@density']) setDensityState(stored['@density'] as Density);
                if (stored['@market_theme']) setMarketThemeState(stored['@market_theme'] as MarketTheme);
                if (stored['@chart_settings']) {
                    try {
                        const parsed = JSON.parse(stored['@chart_settings']);
                        setChartSettingsState({ ...DEFAULT_CHART_SETTINGS, ...parsed });
                    } catch { }
                }
            } catch (e) {
                console.error("Failed to load settings from AsyncStorage", e);
            }
        };
        loadSettings();
    }, []);

    const setIsDarkMode = async (val: boolean) => {
        setDarkModeState(val);
        setColorScheme(val ? 'dark' : 'light');
        await AsyncStorage.setItem('@dark_mode', String(val));
    };

    const setThemeFlavor = async (val: ThemeFlavor) => {
        setThemeFlavorState(val);
        await AsyncStorage.setItem('@theme_flavor', val);
    };

    const setSyncEnabled = async (val: boolean) => {
        setSyncEnabledState(val);
        await AsyncStorage.setItem('@sync_enabled', String(val));
    };

    const setShowCategory = async (val: boolean) => { setShowCategoryState(val); await AsyncStorage.setItem('@show_cat', String(val)); };
    const setShowChangePercent = async (val: boolean) => { setShowChangePercentState(val); await AsyncStorage.setItem('@show_chg_pct', String(val)); };
    const setShowChangeAbs = async (val: boolean) => { setShowChangeAbsState(val); await AsyncStorage.setItem('@show_chg_abs', String(val)); };
    const setShowDate = async (val: boolean) => { setShowDateState(val); await AsyncStorage.setItem('@show_date', String(val)); };
    const setShowUnit = async (val: boolean) => { setShowUnitState(val); await AsyncStorage.setItem('@show_unit', String(val)); };
    const setFontScale = async (val: FontScale) => { setFontScaleState(val); await AsyncStorage.setItem('@font_scale', val); };
    const setDensity = async (val: Density) => { setDensityState(val); await AsyncStorage.setItem('@density', val); };
    const setMarketTheme = async (val: MarketTheme) => { setMarketThemeState(val); await AsyncStorage.setItem('@market_theme', val); };

    const updateChartSettings = useCallback(async (updates: Partial<ChartSettings>) => {
        setChartSettingsState(prev => {
            const next = { ...prev, ...updates };
            AsyncStorage.setItem('@chart_settings', JSON.stringify(next));
            return next;
        });
    }, []);

    const resetChartSettings = useCallback(async () => {
        setChartSettingsState(DEFAULT_CHART_SETTINGS);
        await AsyncStorage.setItem('@chart_settings', JSON.stringify(DEFAULT_CHART_SETTINGS));
    }, []);

    const getMarketColors = (isUp: boolean) => {
        if (marketTheme === 'asian') {
            return {
                textColor: isUp ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-500 dark:text-emerald-400',
                bgColor: isUp ? 'bg-rose-500/10' : 'bg-emerald-500/10',
                badgeColor: isUp ? 'bg-rose-500' : 'bg-emerald-500',
                chartColor: isUp ? '244, 63, 94' : '16, 185, 129'
            };
        }
        if (marketTheme === 'monochrome') {
            return {
                textColor: isUp ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400',
                bgColor: isUp ? 'bg-slate-900/10 dark:bg-white/10' : 'bg-slate-500/10 dark:bg-slate-400/10',
                badgeColor: isUp ? 'bg-slate-800 dark:bg-slate-200' : 'bg-slate-400 dark:bg-slate-500',
                chartColor: isUp ? (isDarkMode ? '255, 255, 255' : '15, 23, 42') : (isDarkMode ? '148, 163, 184' : '100, 116, 139')
            };
        }
        // Default Western
        return {
            textColor: isUp ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400',
            bgColor: isUp ? 'bg-emerald-500/10' : 'bg-rose-500/10',
            badgeColor: isUp ? 'bg-emerald-500' : 'bg-rose-500',
            chartColor: isUp ? '16, 185, 129' : '244, 63, 94'
        };
    };

    const forceSync = () => {
        setSyncTrigger(prev => prev + 1);
    };

    return (
        <SettingsContext.Provider value={{
            isDarkMode, setIsDarkMode,
            themeFlavor, setThemeFlavor,
            syncEnabled, setSyncEnabled,
            forceSync, syncTrigger,
            showCategory, setShowCategory,
            showChangePercent, setShowChangePercent,
            showChangeAbs, setShowChangeAbs,
            showDate, setShowDate,
            showUnit, setShowUnit,
            fontScale, setFontScale,
            density, setDensity,
            marketTheme, setMarketTheme,
            chartSettings, updateChartSettings, resetChartSettings,
            getMarketColors
        }}>
            {children}
        </SettingsContext.Provider>
    );
};
