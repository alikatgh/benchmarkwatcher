import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, Pressable } from 'react-native';
import Icon from '../ui/Icon';

type RangeType = '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL';
type ViewModeType = 'price' | 'percent';

interface CommodityChartControlsProps {
    loading: boolean;
    error: string | null;
    chartData: any;
    selectedRange: RangeType;
    setSelectedRange: (r: RangeType) => void;
    viewMode: ViewModeType;
    setViewMode: (v: ViewModeType) => void;
    onExport: (format: 'image' | 'csv') => void;
    onOpenSettings: () => void;
    onOpenCompare: () => void;
}

export default function CommodityChartControls({
    loading, error, chartData,
    selectedRange, setSelectedRange,
    viewMode, setViewMode,
    onExport,
    onOpenSettings,
    onOpenCompare,
}: CommodityChartControlsProps) {
    const [showExportMenu, setShowExportMenu] = useState(false);

    if (loading || error || !chartData) return null;

    return (
        <View className="px-5 mb-8">
            {/* Time Range Selector */}
            <Text className="text-sm font-bold text-slate-900 dark:text-white mb-3">Time Range</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-5">
                <View className="flex-row gap-2">
                    {(['1W', '1M', '3M', '6M', '1Y', 'ALL'] as RangeType[]).map((range) => (
                        <TouchableOpacity
                            key={range}
                            onPress={() => setSelectedRange(range)}
                            accessibilityRole="button"
                            accessibilityLabel={`Set time range to ${range}`}
                            accessibilityState={{ selected: selectedRange === range }}
                            className={`px-4 py-2 rounded-lg border ${selectedRange === range ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-500' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
                        >
                            <Text className={`font-bold ${selectedRange === range ? 'text-blue-600 dark:text-blue-400' : 'text-slate-600 dark:text-slate-400'}`}>{range}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </ScrollView>

            {/* View Mode Selector */}
            <Text className="text-sm font-bold text-slate-900 dark:text-white mb-3">View Mode</Text>
            <View className="flex-row gap-2 mb-5">
                <TouchableOpacity
                    onPress={() => setViewMode('price')}
                    accessibilityRole="button"
                    accessibilityLabel="Set chart view mode to price"
                    accessibilityState={{ selected: viewMode === 'price' }}
                    className={`flex-1 px-4 py-3 rounded-lg border items-center ${viewMode === 'price' ? 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-500' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
                >
                    <Text className={`font-bold ${viewMode === 'price' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-400'}`}>Price</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    onPress={() => setViewMode('percent')}
                    accessibilityRole="button"
                    accessibilityLabel="Set chart view mode to percent change"
                    accessibilityState={{ selected: viewMode === 'percent' }}
                    className={`flex-1 px-4 py-3 rounded-lg border items-center ${viewMode === 'percent' ? 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-500' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
                >
                    <Text className={`font-bold ${viewMode === 'percent' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-400'}`}>% Change</Text>
                </TouchableOpacity>
            </View>

            {/* Action Buttons Row: Compare | Settings | Export */}
            <Text className="text-sm font-bold text-slate-900 dark:text-white mb-3">Actions</Text>
            <View className="flex-row gap-2">
                <TouchableOpacity
                    onPress={onOpenCompare}
                    accessibilityRole="button"
                    accessibilityLabel="Open compare commodities panel"
                    className="flex-1 flex-row items-center justify-center gap-2 px-3 py-3 rounded-lg border bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                >
                    <Icon name="compare" size={16} color="#6366f1" />
                    <Text className="text-xs font-bold text-slate-700 dark:text-slate-300">Compare</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    onPress={onOpenSettings}
                    accessibilityRole="button"
                    accessibilityLabel="Open chart settings"
                    className="flex-1 flex-row items-center justify-center gap-2 px-3 py-3 rounded-lg border bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                >
                    <Icon name="settings" size={16} color="#6366f1" />
                    <Text className="text-xs font-bold text-slate-700 dark:text-slate-300">Settings</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    onPress={() => setShowExportMenu(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Open export and share options"
                    className="flex-1 flex-row items-center justify-center gap-2 px-3 py-3 rounded-lg border bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
                >
                    <Icon name="camera" size={16} color="#3b82f6" />
                    <Text className="text-xs font-bold text-blue-600 dark:text-blue-400">Export/Share</Text>
                </TouchableOpacity>
            </View>

            {/* Export Format Sheet */}
            <Modal
                animationType="fade"
                transparent
                visible={showExportMenu}
                onRequestClose={() => setShowExportMenu(false)}
            >
                <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setShowExportMenu(false)}>
                    <View className="bg-white dark:bg-slate-900 rounded-t-2xl px-5 pt-4 pb-8">
                        <Text className="text-sm font-bold text-slate-900 dark:text-white mb-4 text-center">Export or Share</Text>
                        {[
                            { key: 'csv', label: 'Copy CSV', desc: '(to clipboard)', icon: 'list' },
                            { key: 'image', label: 'Share Image', desc: '(native share sheet)', icon: 'download' },
                        ].map((opt) => (
                            <TouchableOpacity
                                key={opt.key}
                                onPress={() => { setShowExportMenu(false); onExport(opt.key as 'csv' | 'image'); }}
                                accessibilityRole="button"
                                accessibilityLabel={opt.key === 'csv' ? 'Copy chart data as CSV to clipboard' : 'Share chart image'}
                                className="flex-row items-center gap-4 py-3.5 px-2 border-b border-slate-100 dark:border-slate-800"
                            >
                                <Icon name={opt.icon as any} size={18} className="text-slate-500 dark:text-slate-400" />
                                <Text className="text-sm font-medium text-slate-800 dark:text-white">
                                    {opt.label} <Text className="text-slate-400 dark:text-slate-500 font-normal">{opt.desc}</Text>
                                </Text>
                            </TouchableOpacity>
                        ))}
                        <TouchableOpacity
                            onPress={() => setShowExportMenu(false)}
                            accessibilityRole="button"
                            accessibilityLabel="Close export menu"
                            className="mt-4 py-3 items-center bg-slate-100 dark:bg-slate-800 rounded-xl"
                        >
                            <Text className="text-sm font-bold text-slate-500 dark:text-slate-400">Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </Pressable>
            </Modal>
        </View>
    );
}
