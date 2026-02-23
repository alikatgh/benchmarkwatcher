import React, { useEffect, useState, useContext, useRef } from 'react';
import { View, Text, SafeAreaView, ScrollView, Dimensions, TouchableOpacity } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { RootStackParamList } from '../App';
import { fetchCommodityDetail } from '../api/commodities';
import { Commodity } from '../types/commodity';
import { SettingsContext } from '../context/SettingsContext';

import CommodityHeader from '../components/features/CommodityHeader';
import CommodityDataSourceBlock from '../components/features/CommodityDataSourceBlock';
import CommodityStatsBar from '../components/features/CommodityStatsBar';
import CommodityChartSection from '../components/features/CommodityChartSection';
import CommodityChartControls from '../components/features/CommodityChartControls';

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

    // New Features State
    const [selectedRange, setSelectedRange] = useState<'1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL'>('1M');
    const [viewMode, setViewMode] = useState<'price' | 'percent'>('price');
    const chartRef = useRef<ViewShot>(null);

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
    const getChartData = () => {
        if (!commodity.history || commodity.history.length === 0) return null;

        let pointsCount = commodity.history.length;
        switch (selectedRange) {
            case '1W': pointsCount = 7; break;
            case '1M': pointsCount = 30; break;
            case '3M': pointsCount = 90; break;
            case '6M': pointsCount = 180; break;
            case '1Y': pointsCount = 365; break;
            case 'ALL': pointsCount = commodity.history.length; break;
        }

        const chartPoints = commodity.history.slice(-pointsCount);
        if (chartPoints.length === 0) return null;

        const basePrice = chartPoints[0].price;

        const dataPoints = chartPoints.map((p: any) => {
            if (viewMode === 'percent') {
                return ((p.price - basePrice) / basePrice) * 100;
            }
            return p.price;
        });

        // Downsample labels for cleaner x-axis if there are many points
        const labelStep = Math.ceil(chartPoints.length / 6);
        const labels = chartPoints.map((p: any, i: number) =>
            (i === 0 || i === chartPoints.length - 1 || i % labelStep === 0) ? p.date.substring(5) : ''
        );

        return {
            labels,
            points: chartPoints, // Keep raw points for stats/tooltip
            data: dataPoints,
            datasets: [
                {
                    data: dataPoints,
                    color: (opacity = 1) => `rgba(${chartColor}, ${opacity})`,
                    strokeWidth: 2
                }
            ],
            legend: [viewMode === 'percent' ? "% Change" : "Price History"]
        };
    };

    const chartDataObj = getChartData();
    const chartData = chartDataObj ? { labels: chartDataObj.labels, datasets: chartDataObj.datasets, legend: chartDataObj.legend } : null;
    const chartWidth = chartData ? Math.max(screenWidth, chartData.labels.length * (zoomLevel > 1 ? 20 * zoomLevel : 10)) : screenWidth;

    // Dynamic Stats Calculation
    const getStats = () => {
        if (!chartDataObj || chartDataObj.points.length === 0) return null;
        const prices = chartDataObj.points.map((p: any) => p.price);
        const high = Math.max(...prices);
        const low = Math.min(...prices);
        const avg = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
        return { high, low, avg, range: high - low, count: prices.length };
    };
    const stats = getStats();

    const handleCopyPrice = async () => {
        await Clipboard.setStringAsync(`${commodity.price} ${commodity.currency}`);
    };

    const handleDownloadChart = async () => {
        if (chartRef.current && chartRef.current.capture) {
            try {
                const uri = await chartRef.current.capture();
                await Sharing.shareAsync(uri, { dialogTitle: 'Share Chart', mimeType: 'image/png' });
            } catch (err) {
                console.error('Failed to capture and share chart:', err);
            }
        }
    };

    return (
        <SafeAreaView className="flex-1 bg-white dark:bg-slate-900">
            <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
                <CommodityHeader
                    commodity={commodity}
                    isUp={isUp}
                    changeColor={changeColor}
                    badgeColor={badgeColor}
                    handleCopyPrice={handleCopyPrice}
                />

                <CommodityDataSourceBlock commodity={commodity} />

                <CommodityStatsBar
                    stats={stats}
                    positiveColor={positiveColor}
                    negativeColor={negativeColor}
                />

                <CommodityChartSection
                    loading={loading}
                    error={error}
                    chartData={chartData}
                    chartWidth={chartWidth}
                    autoFitBounds={autoFitBounds}
                    hideGrid={hideGrid}
                    fillArea={fillArea}
                    smoothCurve={smoothCurve}
                    changeColor={changeColor}
                    selectedPoint={selectedPoint}
                    setSelectedPoint={setSelectedPoint}
                    chartRef={chartRef}
                />

                <CommodityChartControls
                    loading={loading}
                    error={error}
                    chartData={chartData}
                    selectedRange={selectedRange as any}
                    setSelectedRange={setSelectedRange as any}
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    smoothCurve={smoothCurve}
                    setSmoothCurve={setSmoothCurve}
                    fillArea={fillArea}
                    setFillArea={setFillArea}
                    hideGrid={hideGrid}
                    setHideGrid={setHideGrid}
                    autoFitBounds={autoFitBounds}
                    setAutoFitBounds={setAutoFitBounds}
                    zoomLevel={zoomLevel}
                    setZoomLevel={setZoomLevel}
                    setSelectedPoint={setSelectedPoint}
                    handleDownloadChart={handleDownloadChart}
                />

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
