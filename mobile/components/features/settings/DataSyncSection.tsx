import React, { useContext } from 'react';
import { View, Text, TouchableOpacity, Switch } from 'react-native';
import { SettingsContext } from '../../../context/SettingsContext';

interface DataSyncSectionProps {
    onNavigateChangelog: () => void;
}

export default function DataSyncSection({ onNavigateChangelog }: DataSyncSectionProps) {
    const { syncEnabled, setSyncEnabled, forceSync } = useContext(SettingsContext);

    return (
        <View className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700 space-y-4">
            <Text className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                Data Sync
            </Text>

            <View className="flex-row items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
                <View>
                    <Text className="text-base text-slate-700 dark:text-slate-300">Background Refresh</Text>
                    <Text className="text-xs text-slate-500 mt-1">Fetch latest prices automatically</Text>
                </View>
                <Switch
                    value={syncEnabled}
                    onValueChange={setSyncEnabled}
                    trackColor={{ false: '#cbd5e1', true: '#10b981' }}
                />
            </View>

            <TouchableOpacity
                onPress={forceSync}
                className="py-3 items-center justify-center bg-slate-100 dark:bg-slate-700 rounded-lg mt-2 active:opacity-75"
            >
                <Text className="text-blue-500 font-bold">Force Sync Now</Text>
            </TouchableOpacity>

            <View className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
                <TouchableOpacity
                    onPress={onNavigateChangelog}
                    className="py-3 items-center justify-center bg-slate-100 dark:bg-slate-700 rounded-lg active:opacity-75 flex-row gap-2"
                >
                    <Text className="text-slate-700 dark:text-slate-300 font-bold font-serif">View Changelog</Text>
                    <Text className="text-slate-400">→</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}
