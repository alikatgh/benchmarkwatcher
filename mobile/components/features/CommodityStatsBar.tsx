import React from 'react';
import { View, Text } from 'react-native';

interface CommodityStatsBarProps {
    stats: {
        high: number;
        low: number;
        avg: number;
        count: number;
    } | null;
    positiveColor: string;
    negativeColor: string;
}

export default function CommodityStatsBar({ stats, positiveColor, negativeColor }: CommodityStatsBarProps) {
    if (!stats) return null;

    return (
        <View className="px-5 mb-6">
            <View className="flex-row justify-between p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                <View className="items-center flex-1">
                    <Text className="text-[10px] uppercase font-bold text-slate-500 mb-1">High</Text>
                    <Text className={`text-sm font-bold ${positiveColor}`}>{stats.high.toFixed(2)}</Text>
                </View>
                <View className="items-center flex-1">
                    <Text className="text-[10px] uppercase font-bold text-slate-500 mb-1">Low</Text>
                    <Text className={`text-sm font-bold ${negativeColor}`}>{stats.low.toFixed(2)}</Text>
                </View>
                <View className="items-center flex-1">
                    <Text className="text-[10px] uppercase font-bold text-slate-500 mb-1">Avg</Text>
                    <Text className="text-sm font-bold text-slate-900 dark:text-white">{stats.avg.toFixed(2)}</Text>
                </View>
                <View className="items-center flex-1 break-word">
                    <Text className="text-[10px] uppercase font-bold text-slate-500 mb-1">Data Pts</Text>
                    <Text className="text-sm font-bold text-slate-900 dark:text-white">{stats.count}</Text>
                </View>
            </View>
        </View>
    );
}
