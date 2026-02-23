import React, { useContext } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Switch } from 'react-native';
import { SettingsContext } from '../../../context/SettingsContext';
import { ThemeFlavor, MarketTheme } from '../../../types/settings';

export default function AppearanceSection() {
    const {
        isDarkMode, setIsDarkMode,
        themeFlavor, setThemeFlavor,
        marketTheme, setMarketTheme,
    } = useContext(SettingsContext);

    return (
        <View className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700 mb-6 space-y-4">
            <Text className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                Appearance
            </Text>

            <View className="flex-row items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
                <Text className="text-base text-slate-700 dark:text-slate-300">Dark Mode</Text>
                <Switch
                    value={isDarkMode}
                    onValueChange={setIsDarkMode}
                    trackColor={{ false: '#cbd5e1', true: '#3b82f6' }}
                />
            </View>

            <View className="py-2">
                <Text className="text-base text-slate-700 dark:text-slate-300 mb-3">Theme Flavor</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row gap-3">
                    <TouchableOpacity
                        onPress={() => setThemeFlavor('standard')}
                        className={`px-4 py-2 rounded-lg border-2 ${themeFlavor === 'standard' ? 'bg-slate-200 dark:bg-slate-600 border-slate-400 dark:border-slate-400' : 'bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-500'}`}
                    >
                        <Text className="text-slate-800 dark:text-white font-medium">Standard</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => setThemeFlavor('mono')}
                        className={`px-4 py-2 rounded-lg border-2 ${themeFlavor === 'mono' ? 'bg-slate-900 dark:bg-slate-100 border-slate-900 dark:border-white' : 'bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-500'}`}
                    >
                        <Text className={`font-mono font-bold ${themeFlavor === 'mono' ? 'text-white dark:text-slate-900' : 'text-slate-800 dark:text-white'}`}>Mono</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => setThemeFlavor('bloomberg')}
                        className={`px-4 py-2 bg-black rounded-lg border-2 ${themeFlavor === 'bloomberg' ? 'border-green-500' : 'border-transparent'}`}
                    >
                        <Text className="text-green-500 font-bold">Bloomberg</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => setThemeFlavor('ft')}
                        className={`px-4 py-2 bg-[#fff1e5] rounded-lg border-2 ${themeFlavor === 'ft' ? 'border-slate-900' : 'border-[#f2e6d9]'}`}
                    >
                        <Text className="text-slate-900 font-serif">Financial Times</Text>
                    </TouchableOpacity>
                </ScrollView>
            </View>

            <View className="py-2 border-t border-slate-100 dark:border-slate-700 mt-2">
                <Text className="text-base text-slate-700 dark:text-slate-300 mb-3 mt-2">Market Color Theme</Text>
                <View className="flex-row gap-2">
                    <TouchableOpacity
                        onPress={() => setMarketTheme('western')}
                        className={`flex-1 items-center py-2 rounded-lg border-2 ${marketTheme === 'western' ? 'bg-slate-200 dark:bg-slate-600 border-slate-400 dark:border-slate-400' : 'bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-500'}`}
                    >
                        <Text className="text-sm text-slate-800 dark:text-white font-medium">Western</Text>
                        <Text className="text-[10px] text-slate-500 mt-1">Green Up, Red Down</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => setMarketTheme('asian')}
                        className={`flex-1 items-center py-2 rounded-lg border-2 ${marketTheme === 'asian' ? 'bg-slate-200 dark:bg-slate-600 border-slate-400 dark:border-slate-400' : 'bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-500'}`}
                    >
                        <Text className="text-sm text-slate-800 dark:text-white font-medium">Asian</Text>
                        <Text className="text-[10px] text-slate-500 mt-1">Red Up, Green Down</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => setMarketTheme('monochrome')}
                        className={`flex-1 items-center py-2 rounded-lg border-2 ${marketTheme === 'monochrome' ? 'bg-slate-200 dark:bg-slate-600 border-slate-400 dark:border-slate-400' : 'bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-500'}`}
                    >
                        <Text className="text-sm text-slate-800 dark:text-white font-medium">Mono</Text>
                        <Text className="text-[10px] text-slate-500 mt-1">Black & Slate</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );
}
