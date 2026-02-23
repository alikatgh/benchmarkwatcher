import React, { createContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'nativewind';

export type ThemeFlavor = 'standard' | 'bloomberg' | 'ft' | 'mono';
export type FontScale = 'small' | 'medium' | 'large';
export type Density = 'compact' | 'cozy' | 'roomy';
export type MarketTheme = 'western' | 'asian' | 'monochrome';

interface SettingsContextProps {
    isDarkMode: boolean;
    setIsDarkMode: (val: boolean) => void;
    themeFlavor: ThemeFlavor;
    setThemeFlavor: (flavor: ThemeFlavor) => void;
    marketTheme: MarketTheme;
    setMarketTheme: (theme: MarketTheme) => void;
    syncEnabled: boolean;
    setSyncEnabled: (val: boolean) => void;
    forceSync: () => void;
    syncTrigger: number;
    getMarketColors: (isUp: boolean) => { textColor: string, bgColor: string, badgeColor: string, chartColor: string };

    // Grid Settings
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
    fontScale: FontScale;
    setFontScale: (val: FontScale) => void;
    density: Density;
    setDensity: (val: Density) => void;
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

    useEffect(() => {
        // Load persisted settings on mount
        const loadSettings = async () => {
            try {
                const storedDarkMode = await AsyncStorage.getItem('@dark_mode');
                const storedFlavor = await AsyncStorage.getItem('@theme_flavor');
                const storedSync = await AsyncStorage.getItem('@sync_enabled');

                const storedCat = await AsyncStorage.getItem('@show_cat');
                const storedChgPct = await AsyncStorage.getItem('@show_chg_pct');
                const storedChgAbs = await AsyncStorage.getItem('@show_chg_abs');
                const storedDate = await AsyncStorage.getItem('@show_date');
                const storedUnit = await AsyncStorage.getItem('@show_unit');
                const storedFont = await AsyncStorage.getItem('@font_scale');
                const storedDensity = await AsyncStorage.getItem('@density');
                const storedMarket = await AsyncStorage.getItem('@market_theme');

                if (storedDarkMode !== null) {
                    const isDark = storedDarkMode === 'true';
                    setDarkModeState(isDark);
                    setColorScheme(isDark ? 'dark' : 'light');
                }
                if (storedFlavor) setThemeFlavorState(storedFlavor as ThemeFlavor);
                if (storedSync !== null) setSyncEnabledState(storedSync === 'true');

                if (storedCat !== null) setShowCategoryState(storedCat === 'true');
                if (storedChgPct !== null) setShowChangePercentState(storedChgPct === 'true');
                if (storedChgAbs !== null) setShowChangeAbsState(storedChgAbs === 'true');
                if (storedDate !== null) setShowDateState(storedDate === 'true');
                if (storedUnit !== null) setShowUnitState(storedUnit === 'true');
                if (storedFont) setFontScaleState(storedFont as FontScale);
                if (storedDensity) setDensityState(storedDensity as Density);
                if (storedMarket) setMarketThemeState(storedMarket as MarketTheme);
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
            getMarketColors
        }}>
            {children}
        </SettingsContext.Provider>
    );
};
