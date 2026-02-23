import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
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
    smoothCurve: boolean;
    setSmoothCurve: (v: boolean) => void;
    fillArea: boolean;
    setFillArea: (v: boolean) => void;
    hideGrid: boolean;
    setHideGrid: (v: boolean) => void;
    autoFitBounds: boolean;
    setAutoFitBounds: (v: boolean) => void;
    zoomLevel: number;
    setZoomLevel: (v: number | ((prev: number) => number)) => void;
    setSelectedPoint: (p: any) => void;
    handleDownloadChart: () => void;
}

export default function CommodityChartControls({
    loading, error, chartData,
    selectedRange, setSelectedRange,
    viewMode, setViewMode,
    smoothCurve, setSmoothCurve,
    fillArea, setFillArea,
    hideGrid, setHideGrid,
    autoFitBounds, setAutoFitBounds,
    zoomLevel, setZoomLevel,
    setSelectedPoint,
    handleDownloadChart
}: CommodityChartControlsProps) {

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
                    className={`flex-1 px-4 py-3 rounded-lg border items-center ${viewMode === 'price' ? 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-500' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
                >
                    <Text className={`font-bold ${viewMode === 'price' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-400'}`}>Absolute Price</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    onPress={() => setViewMode('percent')}
                    className={`flex-1 px-4 py-3 rounded-lg border items-center ${viewMode === 'percent' ? 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-500' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
                >
                    <Text className={`font-bold ${viewMode === 'percent' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-400'}`}>% Change</Text>
                </TouchableOpacity>
            </View>

            <Text className="text-sm font-bold text-slate-900 dark:text-white mb-3">Chart Appearance</Text>
            <View className="flex-row flex-wrap gap-2">
                <TouchableOpacity
                    onPress={() => setSmoothCurve(!smoothCurve)}
                    className={`px-3 py-1.5 rounded-lg border ${smoothCurve ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-500' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
                >
                    <Text className={`text-xs font-medium ${smoothCurve ? 'text-blue-600 dark:text-blue-400' : 'text-slate-600 dark:text-slate-400'}`}>Smooth Curve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    onPress={() => setFillArea(!fillArea)}
                    className={`px-3 py-1.5 rounded-lg border ${fillArea ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-500' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
                >
                    <Text className={`text-xs font-medium ${fillArea ? 'text-blue-600 dark:text-blue-400' : 'text-slate-600 dark:text-slate-400'}`}>Fill Area</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    onPress={() => setHideGrid(!hideGrid)}
                    className={`px-3 py-1.5 rounded-lg border ${hideGrid ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-500' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
                >
                    <Text className={`text-xs font-medium ${hideGrid ? 'text-blue-600 dark:text-blue-400' : 'text-slate-600 dark:text-slate-400'}`}>Hide Grid</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    onPress={() => setAutoFitBounds(!autoFitBounds)}
                    className={`px-3 py-1.5 rounded-lg border ${autoFitBounds ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-500' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
                >
                    <Text className={`text-xs font-medium ${autoFitBounds ? 'text-blue-600 dark:text-blue-400' : 'text-slate-600 dark:text-slate-400'}`}>Auto-Fit Bounds</Text>
                </TouchableOpacity>
            </View>
            <View className="flex-row flex-wrap gap-2 mt-3">
                <TouchableOpacity
                    onPress={() => setZoomLevel((prev: number) => Math.min(prev + 0.5, 4))}
                    className={`px-3 py-1.5 rounded-lg border bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 flex-row items-center gap-1`}
                >
                    <Icon name="zoomIn" size={14} className="text-slate-600 dark:text-slate-400" />
                    <Text className={`text-xs font-medium text-slate-600 dark:text-slate-400`}>Zoom In</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    onPress={() => setZoomLevel((prev: number) => Math.max(prev - 0.5, 1))}
                    className={`px-3 py-1.5 rounded-lg border bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 flex-row items-center gap-1`}
                >
                    <Icon name="zoomOut" size={14} className="text-slate-600 dark:text-slate-400" />
                    <Text className={`text-xs font-medium text-slate-600 dark:text-slate-400`}>Zoom Out</Text>
                </TouchableOpacity>
                {zoomLevel > 1 && (
                    <TouchableOpacity
                        onPress={() => { setZoomLevel(1); setSelectedPoint(null); }}
                        className={`px-3 py-1.5 rounded-lg border bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700`}
                    >
                        <Text className={`text-xs font-medium text-slate-600 dark:text-slate-400`}>Reset Zoom</Text>
                    </TouchableOpacity>
                )}
                <TouchableOpacity
                    onPress={handleDownloadChart}
                    className={`px-3 py-1.5 rounded-lg border bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 flex-row items-center gap-1.5`}
                >
                    <Icon name="download" size={14} className="text-blue-600 dark:text-blue-400" />
                    <Text className={`text-xs font-medium text-blue-600 dark:text-blue-400`}>Download PNG</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}
