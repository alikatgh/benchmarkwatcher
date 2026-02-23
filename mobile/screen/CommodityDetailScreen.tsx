import React, { useEffect, useState, useContext } from 'react';
import { View, Text, SafeAreaView, ScrollView, ActivityIndicator, Dimensions, TouchableOpacity } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LineChart } from 'react-native-chart-kit';
import { RootStackParamList } from '../App';
import { fetchCommodityDetail } from '../api/commodities';
import { Commodity } from '../types/commodity';
import { SettingsContext } from '../context/SettingsContext';

type Props = NativeStackScreenProps<RootStackParamList, 'CommodityDetail'>;

const screenWidth = Dimensions.get('window').width;

export default function CommodityDetailScreen({ route }: Props) {
    const { commodity: initialCommodity } = route.params;
    const [commodity, setCommodity] = useState<Commodity | any>(initialCommodity);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Chart Settings State
    const [smoothCurve, setSmoothCurve] = useState(true);
    const [fillArea, setFillArea] = useState(false);
    const [hideGrid, setHideGrid] = useState(false);
    const [autoFitBounds, setAutoFitBounds] = useState(true);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [selectedPoint, setSelectedPoint] = useState<{ index: number, value: number, x: number, y: number, date: string } | null>(null);

    useEffect(() => {
        const loadDetail = async () => {
            try {
                const detail = await fetchCommodityDetail(initialCommodity.id);
                setCommodity(detail);
            } catch (err: any) {
                setError('Failed to load chart data');
            } finally {
                setLoading(false);
            }
        };
        loadDetail();
    }, [initialCommodity.id]);

    const { getMarketColors } = useContext(SettingsContext);

    const isUp = commodity.change >= 0;
    const { textColor: changeColor, bgColor: changeBg, badgeColor, chartColor } = getMarketColors(isUp);
    const positiveColor = getMarketColors(true).textColor;
    const negativeColor = getMarketColors(false).textColor;

    // Prepare chart data
    // The history array is expected to be { date: string, price: number }[]
    const getChartData = () => {
        if (!commodity.history || commodity.history.length === 0) return null;

        // Take up to 30 points for the chart to avoid overloading
        const chartPoints = commodity.history.length > 30
            ? commodity.history.slice(-30)
            : commodity.history;

        return {
            labels: chartPoints.map((p: any) => p.date.substring(5)), // MM-DD
            datasets: [
                {
                    data: chartPoints.map((p: any) => p.price),
                    color: (opacity = 1) => `rgba(${chartColor}, ${opacity})`,
                    strokeWidth: 2
                }
            ],
            legend: ["Price History"]
        };
    };

    const chartData = getChartData();
    const chartWidth = chartData ? Math.max(screenWidth, chartData.labels.length * 20 * zoomLevel) : screenWidth;

    return (
        <SafeAreaView className="flex-1 bg-white dark:bg-slate-900">
            <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
                {/* Header Info */}
                <View className="px-5 pt-4">
                    <Text className="text-xl text-slate-500 dark:text-slate-400 font-medium mb-1 uppercase tracking-wider">
                        {commodity.category}
                    </Text>
                    <Text className="text-4xl font-bold text-slate-900 dark:text-white mb-6">
                        {commodity.name}
                    </Text>

                    <View className="mb-6">
                        <Text className="text-5xl font-bold text-slate-900 dark:text-white" numberOfLines={1} adjustsFontSizeToFit>
                            {commodity.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                        </Text>
                        <Text className="text-lg text-slate-500 dark:text-slate-400 mt-1">
                            {commodity.currency} / {commodity.unit}
                        </Text>
                    </View>

                    <View className="flex-row items-center flex-wrap gap-3 mb-6">
                        <View className={`px-4 py-2 flex-row rounded-lg items-center ${changeBg}`}>
                            <Text className={`text-xl font-bold ${changeColor}`}>
                                {isUp ? '+' : ''}{commodity.change_percent}%
                            </Text>
                            <Text className={`text-xs font-bold py-1 px-2.5 ml-2 rounded-full text-white ${badgeColor}`}>
                                {isUp ? '↑' : '↓'}
                            </Text>
                        </View>
                    </View>
                </View>

                {/* Chart Section */}
                <View className="mb-6">
                    {loading ? (
                        <View className="h-[220px] items-center justify-center">
                            <ActivityIndicator size="large" color="#3b82f6" />
                        </View>
                    ) : error || !chartData ? (
                        <View className="h-[220px] items-center justify-center bg-slate-50 dark:bg-slate-800 mx-5 rounded-xl border border-slate-100 dark:border-slate-700">
                            <Text className="text-slate-500 dark:text-slate-400">No chart data available</Text>
                        </View>
                    ) : (
                        <View>
                            <ScrollView horizontal={true} showsHorizontalScrollIndicator={false}>
                                <View>
                                    <LineChart
                                        data={chartData}
                                        width={chartWidth}
                                        height={260}
                                        fromZero={!autoFitBounds}
                                        withDots={true}
                                        withInnerLines={!hideGrid}
                                        withOuterLines={false}
                                        withVerticalLines={false}
                                        withHorizontalLines={!hideGrid}
                                        withShadow={fillArea}
                                        onDataPointClick={({ value, getColor, index, x, y }) => {
                                            setSelectedPoint({ index, value, x, y, date: chartData.labels[index] });
                                        }}
                                        chartConfig={{
                                            backgroundColor: 'transparent',
                                            backgroundGradientFrom: 'transparent',
                                            backgroundGradientFromOpacity: 0,
                                            backgroundGradientTo: 'transparent',
                                            backgroundGradientToOpacity: 0,
                                            decimalPlaces: 2,
                                            color: (opacity = 1) => `rgba(148, 163, 184, ${opacity})`, // Slate 400 for grid lines
                                            labelColor: (opacity = 1) => `rgba(100, 116, 139, ${opacity})`, // Slate 500 for text
                                            style: {
                                                borderRadius: 16
                                            },
                                            propsForDots: {
                                                r: "4",
                                                strokeWidth: "2",
                                                stroke: changeColor.includes('emerald') ? '#10b981' : '#f43f5e'
                                            },
                                            propsForBackgroundLines: {
                                                strokeDasharray: '4',
                                                strokeWidth: 1,
                                                stroke: 'rgba(148, 163, 184, 0.2)',
                                            },
                                        }}
                                        bezier={smoothCurve}
                                        style={{
                                            marginVertical: 8,
                                        }}
                                    />
                                    {selectedPoint && (
                                        <View
                                            style={{
                                                position: 'absolute',
                                                left: Math.max(0, Math.min(selectedPoint.x - 40, chartWidth - 80)),
                                                top: selectedPoint.y - 50,
                                            }}
                                            className="bg-slate-900 dark:bg-slate-100 px-3 py-2 rounded-lg items-center shadow-lg"
                                        >
                                            <Text className="text-white dark:text-slate-900 font-bold text-sm">
                                                {selectedPoint.value.toFixed(2)}
                                            </Text>
                                            <Text className="text-slate-300 dark:text-slate-600 font-medium text-[10px]">
                                                {selectedPoint.date}
                                            </Text>
                                        </View>
                                    )}
                                </View>
                            </ScrollView>
                        </View>
                    )}
                </View>

                {/* Chart Settings Toggles */}
                {!loading && !error && chartData && (
                    <View className="px-5 mb-8">
                        <Text className="text-sm font-bold text-slate-900 dark:text-white mb-3">Chart Settings</Text>
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
                                onPress={() => setZoomLevel(prev => Math.min(prev + 0.5, 4))}
                                className={`px-3 py-1.5 rounded-lg border bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700`}
                            >
                                <Text className={`text-xs font-medium text-slate-600 dark:text-slate-400`}>Zoom In 🔍</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={() => setZoomLevel(prev => Math.max(prev - 0.5, 1))}
                                className={`px-3 py-1.5 rounded-lg border bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700`}
                            >
                                <Text className={`text-xs font-medium text-slate-600 dark:text-slate-400`}>Zoom Out 🔍</Text>
                            </TouchableOpacity>
                            {zoomLevel > 1 && (
                                <TouchableOpacity
                                    onPress={() => { setZoomLevel(1); setSelectedPoint(null); }}
                                    className={`px-3 py-1.5 rounded-lg border bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700`}
                                >
                                    <Text className={`text-xs font-medium text-slate-600 dark:text-slate-400`}>Reset Zoom</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>
                )}

                {/* Details Section */}
                <View className="px-5">
                    <View className="bg-slate-50 dark:bg-slate-800 rounded-xl p-5 border border-slate-100 dark:border-slate-700 space-y-4">
                        <View className="flex-row justify-between pb-3 border-b border-slate-200 dark:border-slate-700">
                            <Text className="text-slate-500 dark:text-slate-400">Date</Text>
                            <Text className="font-bold text-slate-900 dark:text-white">{commodity.date}</Text>
                        </View>
                        <View className="flex-row justify-between pb-3 border-b border-slate-200 dark:border-slate-700">
                            <Text className="text-slate-500 dark:text-slate-400">Absolute Change</Text>
                            <Text className={`font-bold ${changeColor}`}>
                                {isUp ? '+' : ''}{commodity.change}
                            </Text>
                        </View>
                        <View className="flex-row justify-between">
                            <Text className="text-slate-500 dark:text-slate-400">Previous Date</Text>
                            <Text className="font-bold text-slate-900 dark:text-white">{commodity.prev_date || 'N/A'}</Text>
                        </View>
                        {commodity.derived_stats && (
                            <>
                                <View className="flex-row justify-between pt-3 border-t border-slate-200 dark:border-slate-700">
                                    <Text className="text-slate-500 dark:text-slate-400">30D Return</Text>
                                    <Text className={`font-bold ${commodity.derived_stats.pct_30d !== undefined ? (commodity.derived_stats.pct_30d >= 0 ? positiveColor : negativeColor) : 'text-slate-900 dark:text-white'}`}>
                                        {commodity.derived_stats.pct_30d !== undefined ? `${commodity.derived_stats.pct_30d > 0 ? '+' : ''}${commodity.derived_stats.pct_30d.toFixed(2)}%` : 'N/A'}
                                    </Text>
                                </View>
                                <View className="flex-row justify-between pt-3 border-t border-slate-200 dark:border-slate-700">
                                    <Text className="text-slate-500 dark:text-slate-400">1Y Return</Text>
                                    <Text className={`font-bold ${commodity.derived_stats.pct_1y !== undefined ? (commodity.derived_stats.pct_1y >= 0 ? positiveColor : negativeColor) : 'text-slate-900 dark:text-white'}`}>
                                        {commodity.derived_stats.pct_1y !== undefined ? `${commodity.derived_stats.pct_1y > 0 ? '+' : ''}${commodity.derived_stats.pct_1y.toFixed(2)}%` : 'N/A'}
                                    </Text>
                                </View>
                                <View className="flex-row justify-between pt-3 border-t border-slate-200 dark:border-slate-700">
                                    <Text className="text-slate-500 dark:text-slate-400">Trend (30D)</Text>
                                    <Text className={`font-bold uppercase ${commodity.derived_stats.trend === 'up' ? positiveColor : commodity.derived_stats.trend === 'down' ? negativeColor : 'text-slate-500 dark:text-slate-400'}`}>
                                        {commodity.derived_stats.trend || 'N/A'}
                                    </Text>
                                </View>
                            </>
                        )}
                    </View>
                </View>

            </ScrollView>
        </SafeAreaView>
    );
}
