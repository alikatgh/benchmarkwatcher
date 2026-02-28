import React from 'react';
import { View, Text, ActivityIndicator, ScrollView } from 'react-native';
import ViewShot from 'react-native-view-shot';
import SVGLineChart, { ChartPoint, SelectedChartPoint } from './SVGLineChart';
import { ComparisonSeries } from '../../types/commodity';

interface CommodityChartSectionProps {
    loading: boolean;
    error: string | null;
    chartPoints: ChartPoint[] | null;
    chartWidth: number;
    autoFitBounds: boolean;
    hideGrid: boolean;
    fillArea: boolean;
    smoothCurve: boolean;
    color: string; // RGB string e.g. "16, 185, 129"
    selectedPoint: SelectedChartPoint | null;
    setSelectedPoint: (point: SelectedChartPoint | null) => void;
    chartRef: React.RefObject<ViewShot | null>;
    // New props
    comparisons?: ComparisonSeries[];
    viewMode?: 'price' | 'percent';
    primaryName?: string;
    lineColor?: string;
    fillColor?: string;
    fillOpacity?: number;
    gridColor?: string;
    currency?: string;
}

export default function CommodityChartSection({
    loading, error, chartPoints, chartWidth,
    autoFitBounds, hideGrid, fillArea, smoothCurve,
    color, selectedPoint, setSelectedPoint, chartRef,
    comparisons, viewMode, primaryName,
    lineColor, fillColor, fillOpacity, gridColor, currency,
}: CommodityChartSectionProps) {
    return (
        <View className="mb-6">
            {loading ? (
                <View className="h-[220px] items-center justify-center">
                    <ActivityIndicator size="large" color="#3b82f6" />
                </View>
            ) : error || !chartPoints ? (
                <View className="h-[220px] items-center justify-center bg-slate-50 dark:bg-slate-800 mx-5 rounded-xl border border-slate-100 dark:border-slate-700">
                    <Text className="text-slate-500 dark:text-slate-400">No chart data available</Text>
                </View>
            ) : (
                <ViewShot ref={chartRef} options={{ format: 'png', quality: 1.0 }} style={{ backgroundColor: '#fff' }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <SVGLineChart
                            data={chartPoints}
                            width={chartWidth}
                            height={260}
                            color={color}
                            fillArea={fillArea}
                            hideGrid={hideGrid}
                            smoothCurve={smoothCurve}
                            autoFitBounds={autoFitBounds}
                            selectedPoint={selectedPoint}
                            onSelectPoint={setSelectedPoint}
                            comparisons={comparisons}
                            viewMode={viewMode}
                            primaryName={primaryName}
                            lineColor={lineColor}
                            fillColor={fillColor}
                            fillOpacity={fillOpacity}
                            gridColor={gridColor}
                            currency={currency}
                        />
                    </ScrollView>
                </ViewShot>
            )}
        </View>
    );
}
