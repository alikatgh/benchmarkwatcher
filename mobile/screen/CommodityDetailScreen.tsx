import React, { useEffect, useState, useContext, useRef, useCallback } from 'react';
import { View, Text, ScrollView, Dimensions, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { RootStackParamList } from '../App';
import { fetchCommodityDetail } from '../api/commodities';
import { Commodity, ComparisonSeries } from '../types/commodity';
import { SettingsContext } from '../context/SettingsContext';
import { ChartPoint, SelectedChartPoint } from '../components/features/SVGLineChart';
import { COMPARISON_COLORS, MAX_COMPARISONS } from '../components/features/CompareModal';

import CommodityHeader from '../components/features/CommodityHeader';
import CommodityDataSourceBlock from '../components/features/CommodityDataSourceBlock';
import CommodityStatsBar from '../components/features/CommodityStatsBar';
import CommodityChartSection from '../components/features/CommodityChartSection';
import CommodityChartControls from '../components/features/CommodityChartControls';
import ChartSettingsModal from '../components/features/ChartSettingsModal';
import CompareModal from '../components/features/CompareModal';
import { DETAIL_CHANGE_PERIOD_KEY } from '../utils/detailPreferences';

type Props = NativeStackScreenProps<RootStackParamList, 'CommodityDetail'>;

const screenWidth = Dimensions.get('window').width;

export default function CommodityDetailScreen({ route }: Props) {
    const { commodity: initialCommodity } = route.params;
    const [commodity, setCommodity] = useState<Commodity | any>(initialCommodity);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [selectedPoint, setSelectedPoint] = useState<SelectedChartPoint | null>(null);
    const [zoomLevel, setZoomLevel] = useState(1);

    const [selectedRange, setSelectedRange] = useState<'1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL'>('1M');
    const [selectedChangePeriod, setSelectedChangePeriod] = useState<'1' | '30' | '365'>('1');
    const [viewMode, setViewMode] = useState<'price' | 'percent'>('price');
    const chartRef = useRef<ViewShot>(null);

    // Modals
    const [settingsModalVisible, setSettingsModalVisible] = useState(false);
    const [compareModalVisible, setCompareModalVisible] = useState(false);

    // Comparison state
    const [comparisons, setComparisons] = useState<ComparisonSeries[]>([]);
    const [colorIndex, setColorIndex] = useState(0);

    const loadDetail = useCallback(async (isRefresh = false) => {
        if (isRefresh) {
            setRefreshing(true);
        } else {
            setLoading(true);
        }
        try {
            const detail = await fetchCommodityDetail(initialCommodity.id);
            setCommodity(detail);
            setError(null);
        } catch {
            setError('Unable to refresh commodity data. Please try again.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [initialCommodity.id]);

    useEffect(() => {
        const restoreChangePeriod = async () => {
            try {
                const stored = await AsyncStorage.getItem(DETAIL_CHANGE_PERIOD_KEY);
                if (stored === '1' || stored === '30' || stored === '365') {
                    setSelectedChangePeriod(stored);
                }
            } catch {
                // non-blocking preference read
            }
        };

        restoreChangePeriod();
        loadDetail();
    }, [loadDetail]);

    useEffect(() => {
        AsyncStorage.setItem(DETAIL_CHANGE_PERIOD_KEY, selectedChangePeriod).catch(() => {
            // non-blocking preference write
        });
    }, [selectedChangePeriod]);

    const { getMarketColors, chartSettings } = useContext(SettingsContext);

    const baseIsUp = (commodity.change ?? 0) >= 0;
    const { chartColor } = getMarketColors(baseIsUp);
    const positiveColor = getMarketColors(true).textColor;
    const negativeColor = getMarketColors(false).textColor;

    const derivedStats = (commodity.derived_stats || {}) as {
        abs_change_1_obs?: number;
        pct_change_1_obs?: number;
        pct_change_30_obs?: number;
        pct_change_365_obs?: number;
        pct_30d?: number;
        pct_1y?: number;
    };

    const changeOptions = {
        '1': {
            pct: Number(commodity.change_percent ?? derivedStats.pct_change_1_obs ?? 0),
            abs: Number(commodity.change ?? derivedStats.abs_change_1_obs ?? 0),
            context: `vs ${commodity.is_daily ? 'prev day' : 'prev month'}`,
        },
        '30': {
            pct: Number(derivedStats.pct_change_30_obs ?? derivedStats.pct_30d ?? 0),
            abs: null,
            context: 'vs ~30 obs',
        },
        '365': {
            pct: Number(derivedStats.pct_change_365_obs ?? derivedStats.pct_1y ?? 0),
            abs: null,
            context: 'vs ~1 year',
        },
    } as const;

    const selectedChange = changeOptions[selectedChangePeriod];
    const selectedChangeIsUp = selectedChange.pct >= 0;
    const { textColor: changeColor, badgeColor } = getMarketColors(selectedChangeIsUp);

    // Comparison handlers
    const handleToggleCommodity = useCallback(async (comp: Commodity) => {
        const existing = comparisons.find(c => c.id === comp.id);
        if (existing) {
            setComparisons(prev => prev.filter(c => c.id !== comp.id));
            return;
        }
        if (comparisons.length >= MAX_COMPARISONS) return;

        try {
            const detail = await fetchCommodityDetail(comp.id);
            const history = (detail as any).history || [];
            const newColor = COMPARISON_COLORS[colorIndex % COMPARISON_COLORS.length];
            setColorIndex(prev => prev + 1);
            setComparisons(prev => [...prev, {
                id: comp.id,
                name: comp.name,
                color: newColor,
                history,
            }]);
        } catch {
            Alert.alert('Compare failed', 'Unable to load selected commodity for comparison. Please try again.');
        }
    }, [comparisons, colorIndex]);

    const handleClearComparisons = useCallback(() => {
        setComparisons([]);
        setColorIndex(0);
    }, []);

    // Prepare chart data
    const getChartData = () => {
        const history: any[] | undefined = commodity.history;
        if (!history || history.length === 0) return null;

        let pointsCount = history.length;
        switch (selectedRange) {
            case '1W': pointsCount = 7; break;
            case '1M': pointsCount = 30; break;
            case '3M': pointsCount = 90; break;
            case '6M': pointsCount = 180; break;
            case '1Y': pointsCount = 365; break;
            case 'ALL': pointsCount = history.length; break;
        }

        const rawSlice = history
            .slice(-pointsCount)
            .filter((p: any) => p && typeof p.price === 'number' && !isNaN(p.price));

        if (rawSlice.length === 0) return null;

        const basePrice = rawSlice[0].price;
        const labelStep = Math.ceil(rawSlice.length / 6);

        const chartPoints: ChartPoint[] = rawSlice.map((p: any, i: number) => ({
            value: viewMode === 'percent'
                ? ((p.price - basePrice) / basePrice) * 100
                : p.price,
            date: p.date ?? '',
            label: (i === 0 || i === rawSlice.length - 1 || i % labelStep === 0)
                ? (p.date ?? '').substring(5)
                : '',
        }));

        return { chartPoints, rawSlice };
    };

    const chartDataResult = getChartData();
    const chartPoints = chartDataResult?.chartPoints ?? null;
    const rawSlice = chartDataResult?.rawSlice ?? null;
    const chartWidth = chartPoints
        ? Math.max(screenWidth, chartPoints.length * (zoomLevel > 1 ? 20 * zoomLevel : 10))
        : screenWidth;

    // Filter comparison histories to match visible date range
    const visibleComparisons = comparisons.map(comp => {
        if (!rawSlice || rawSlice.length === 0) return comp;
        const startDate = rawSlice[0].date;
        const endDate = rawSlice[rawSlice.length - 1].date;
        return {
            ...comp,
            history: comp.history.filter(h => h.date >= startDate && h.date <= endDate),
        };
    });

    const getStats = () => {
        if (!rawSlice || rawSlice.length === 0) return null;
        const prices = rawSlice.map((p: any) => p.price as number);
        const high = Math.max(...prices);
        const low = Math.min(...prices);
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        return { high, low, avg, range: high - low, count: prices.length };
    };
    const stats = getStats();

    useEffect(() => {
        setSelectedPoint(null);
    }, [selectedRange, viewMode, comparisons.length]);

    const handleCopyPrice = async () => {
        await Clipboard.setStringAsync(`${commodity.price} ${commodity.currency}`);
    };

    const handleExport = async (format: 'image' | 'csv') => {
        if (format === 'image') {
            if (chartRef.current && chartRef.current.capture) {
                try {
                    const canShare = await Sharing.isAvailableAsync();
                    if (!canShare) {
                        Alert.alert('Sharing unavailable', 'Sharing is not available on this device.');
                        return;
                    }
                    const uri = await chartRef.current.capture();
                    await Sharing.shareAsync(uri, { dialogTitle: 'Share Chart', mimeType: 'image/png' });
                    Alert.alert('Share opened', 'The native share sheet has been opened.');
                } catch (err) {
                    console.error('Failed to capture and share chart:', err);
                    Alert.alert('Export failed', 'Unable to prepare chart image for sharing.');
                }
            }
        } else if (format === 'csv') {
            if (!rawSlice || rawSlice.length === 0) return;
            const header = `Date,Price (${commodity.currency || 'USD'})`;
            const rows = rawSlice.map((p: any) => `${p.date},${p.price}`);
            const csv = [header, ...rows].join('\n');
            try {
                await Clipboard.setStringAsync(csv);
                Alert.alert('CSV copied', 'Chart data CSV has been copied to your clipboard.');
            } catch {
                Alert.alert('Export failed', 'Unable to copy CSV data to clipboard.');
            }
        }
    };

    return (
        <SafeAreaView className="flex-1 bg-white dark:bg-slate-900">
            <ScrollView
                className="flex-1"
                contentContainerStyle={{ paddingBottom: 40 }}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={() => loadDetail(true)} />
                }
            >
                {error && (
                    <View className="mx-5 mt-4 mb-2 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
                        <Text className="text-xs font-semibold text-amber-800 dark:text-amber-300">{error}</Text>
                        <Text className="text-[11px] mt-1 text-amber-700 dark:text-amber-400">Pull to refresh or tap retry in the chart section.</Text>
                    </View>
                )}

                <CommodityHeader
                    commodity={commodity}
                    isUp={selectedChangeIsUp}
                    changeColor={changeColor}
                    badgeColor={badgeColor}
                    handleCopyPrice={handleCopyPrice}
                    selectedChangePeriod={selectedChangePeriod}
                    onChangePeriod={setSelectedChangePeriod}
                    changePercent={selectedChange.pct}
                    changeAbs={selectedChange.abs}
                    changeContextLabel={`${selectedChange.context} · As of ${commodity.date}`}
                />

                <CommodityDataSourceBlock commodity={commodity} />

                <CommodityStatsBar
                    stats={stats}
                    positiveColor={positiveColor}
                    negativeColor={negativeColor}
                />

                {/* Active comparison tags */}
                {comparisons.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-5 mb-3">
                        <View className="flex-row gap-2">
                            {comparisons.map(comp => (
                                <TouchableOpacity
                                    key={comp.id}
                                    onPress={() => setComparisons(prev => prev.filter(c => c.id !== comp.id))}
                                    className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800"
                                >
                                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: comp.color }} />
                                    <Text className="text-xs font-medium text-slate-700 dark:text-slate-300" numberOfLines={1}>
                                        {comp.name}
                                    </Text>
                                    <Text className="text-xs text-slate-400 ml-0.5">&times;</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </ScrollView>
                )}

                <CommodityChartSection
                    loading={loading}
                    error={error}
                    chartPoints={chartPoints}
                    chartWidth={chartWidth}
                    autoFitBounds={chartSettings.chartAutoFitBounds}
                    hideGrid={!chartSettings.chartGridVisible}
                    fillArea={chartSettings.chartFillEnabled}
                    smoothCurve={chartSettings.chartSmoothCurve}
                    color={chartColor}
                    selectedPoint={selectedPoint}
                    setSelectedPoint={setSelectedPoint}
                    chartRef={chartRef}
                    comparisons={visibleComparisons}
                    viewMode={viewMode}
                    primaryName={commodity.name}
                    lineColor={chartSettings.chartLineColor}
                    fillColor={chartSettings.chartFillColor}
                    fillOpacity={chartSettings.chartFillOpacity}
                    gridColor={chartSettings.chartGridColor}
                    currency={commodity.currency}
                    onRetry={() => loadDetail(true)}
                />

                <CommodityChartControls
                    loading={loading}
                    error={error}
                    chartData={chartPoints}
                    selectedRange={selectedRange as any}
                    setSelectedRange={setSelectedRange as any}
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    onExport={handleExport}
                    onOpenSettings={() => setSettingsModalVisible(true)}
                    onOpenCompare={() => setCompareModalVisible(true)}
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
                                {baseIsUp ? '+' : ''}{commodity.change ?? 0}
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
                                    <Text className={`font-bold ${commodity.derived_stats.pct_30d != null ? (commodity.derived_stats.pct_30d >= 0 ? positiveColor : negativeColor) : 'text-slate-900 dark:text-white'}`}>
                                        {commodity.derived_stats.pct_30d != null ? `${commodity.derived_stats.pct_30d > 0 ? '+' : ''}${commodity.derived_stats.pct_30d.toFixed(2)}%` : 'N/A'}
                                    </Text>
                                </View>
                                <View className="flex-row justify-between pt-3 border-t border-slate-200 dark:border-slate-700">
                                    <Text className="text-slate-500 dark:text-slate-400">1Y Return</Text>
                                    <Text className={`font-bold ${commodity.derived_stats.pct_1y != null ? (commodity.derived_stats.pct_1y >= 0 ? positiveColor : negativeColor) : 'text-slate-900 dark:text-white'}`}>
                                        {commodity.derived_stats.pct_1y != null ? `${commodity.derived_stats.pct_1y > 0 ? '+' : ''}${commodity.derived_stats.pct_1y.toFixed(2)}%` : 'N/A'}
                                    </Text>
                                </View>
                                <View className="flex-row justify-between pt-3 border-t border-slate-200 dark:border-slate-700">
                                    <Text className="text-slate-500 dark:text-slate-400">Direction (30D)</Text>
                                    <Text className={`font-bold uppercase ${commodity.derived_stats.direction_30_obs === 'up' ? positiveColor : commodity.derived_stats.direction_30_obs === 'down' ? negativeColor : 'text-slate-500 dark:text-slate-400'}`}>
                                        {commodity.derived_stats.direction_30_obs || 'N/A'}
                                    </Text>
                                </View>
                            </>
                        )}
                    </View>
                </View>

            </ScrollView>

            {/* Modals */}
            <ChartSettingsModal
                visible={settingsModalVisible}
                onClose={() => setSettingsModalVisible(false)}
            />
            <CompareModal
                visible={compareModalVisible}
                onClose={() => setCompareModalVisible(false)}
                currentCommodityId={commodity.id}
                comparisons={comparisons}
                onToggleCommodity={handleToggleCommodity}
                onClearAll={handleClearComparisons}
            />
        </SafeAreaView>
    );
}
