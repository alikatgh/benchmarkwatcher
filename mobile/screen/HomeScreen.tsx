import React, { useState, useContext, useEffect, useRef } from 'react';
import { View, Text, FlatList, ActivityIndicator, StatusBar, RefreshControl, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import IconButton from '../components/ui/IconButton';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import CommodityCard from '../components/CommodityCard';
import CompactCommodityRow from '../components/CompactCommodityRow';
import { SettingsContext } from '../context/SettingsContext';
import { useCommodities } from '../hooks/useCommodities';
import HomeModals from '../components/features/HomeModals';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

const CATEGORIES = ['All', 'Energy', 'Metal', 'Agricultural', 'Precious'];
const RANGES = ['1W', '1M', '3M', '6M', '1Y', 'ALL'];
const SORT_METHODS = ['change_percent', 'name', 'price', 'priority'];
const SORT_ORDERS = ['asc', 'desc'];
const HOME_STATE_KEY = '@home_state_v1';

export default function HomeScreen() {
    const navigation = useNavigation<NavigationProp>();
    const {
        syncEnabled, syncTrigger,
        showCategory, setShowCategory,
        showChangePercent, setShowChangePercent,
        showChangeAbs, setShowChangeAbs,
        showDate, setShowDate,
        showUnit, setShowUnit,
        fontScale, setFontScale,
        density, setDensity,
        isDarkMode,
    } = useContext(SettingsContext);

    // Filter State
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [selectedRange, setSelectedRange] = useState('1M'); // Default to 1M like web
    const [sortMethod, setSortMethod] = useState('change_percent');
    const [sortOrder, setSortOrder] = useState('desc');
    const [isCompactView, setIsCompactView] = useState(false);
    const [isSettingsModalVisible, setSettingsModalVisible] = useState(false);
    const [isSortModalVisible, setSortModalVisible] = useState(false);
    const [isSearchModalVisible, setSearchModalVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const hasHydratedHomeState = useRef(false);

    useEffect(() => {
        let isMounted = true;

        const restoreHomeState = async () => {
            try {
                const raw = await AsyncStorage.getItem(HOME_STATE_KEY);
                if (!raw) {
                    hasHydratedHomeState.current = true;
                    return;
                }

                const parsed = JSON.parse(raw) as {
                    selectedCategory?: string;
                    selectedRange?: string;
                    sortMethod?: string;
                    sortOrder?: string;
                    isCompactView?: boolean;
                };

                if (!isMounted) return;

                if (parsed.selectedCategory && CATEGORIES.includes(parsed.selectedCategory)) {
                    setSelectedCategory(parsed.selectedCategory);
                }
                if (parsed.selectedRange && RANGES.includes(parsed.selectedRange)) {
                    setSelectedRange(parsed.selectedRange);
                }
                if (parsed.sortMethod && SORT_METHODS.includes(parsed.sortMethod)) {
                    setSortMethod(parsed.sortMethod);
                }
                if (parsed.sortOrder && SORT_ORDERS.includes(parsed.sortOrder)) {
                    setSortOrder(parsed.sortOrder);
                }
                if (typeof parsed.isCompactView === 'boolean') {
                    setIsCompactView(parsed.isCompactView);
                }
            } catch {
                // non-blocking restore failure
            } finally {
                hasHydratedHomeState.current = true;
            }
        };

        restoreHomeState();

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        if (!hasHydratedHomeState.current) return;

        const persistHomeState = async () => {
            try {
                await AsyncStorage.setItem(HOME_STATE_KEY, JSON.stringify({
                    selectedCategory,
                    selectedRange,
                    sortMethod,
                    sortOrder,
                    isCompactView,
                }));
            } catch {
                // non-blocking persist failure
            }
        };

        persistHomeState();
    }, [selectedCategory, selectedRange, sortMethod, sortOrder, isCompactView]);

    const {
        data, loading, refreshing, error, lastFetchTime, handleRefresh
    } = useCommodities({
        syncEnabled, syncTrigger, selectedCategory, selectedRange, sortMethod, sortOrder
    });

    const getSortText = () => {
        if (sortMethod === 'change_percent') return sortOrder === 'desc' ? '↑ % Gain' : '↓ % Decrease';
        if (sortMethod === 'name' || sortMethod === 'priority') return sortOrder === 'asc' ? 'Name (A-Z)' : 'Name (Z-A)';
        if (sortMethod === 'price') return sortOrder === 'desc' ? 'Highest Price' : 'Lowest Price';
        return 'Sort Options';
    };

    const renderErrorBanner = () => {
        if (!error || data.length === 0) return null;
        return (
            <View className="mx-4 mt-2 mb-3 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 px-3 py-2">
                <Text className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                    {error}
                </Text>
                <Text className="text-[11px] mt-1 text-rose-600 dark:text-rose-400">
                    Showing last available data. Pull to refresh or retry.
                </Text>
            </View>
        );
    };

    const renderHeader = () => (
        <View className="pt-6 pb-2">
            <View className="px-4 mb-4 flex-row justify-between items-center">
                <View>
                    <Text className="text-3xl font-bold text-slate-900 dark:text-white">
                        Market Benchmarks
                    </Text>
                    <Text className="text-sm text-slate-500 mt-1 mb-1">
                        Historical reference data — not for trading decisions
                    </Text>
                    {lastFetchTime && (
                        <Text className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-bold">
                            Data as of {lastFetchTime}
                        </Text>
                    )}
                </View>
                <View className="flex-row items-center gap-2">
                    <IconButton
                        icon="search"
                        onPress={() => setSearchModalVisible(true)}
                        ariaLabel="Search"
                        variant="secondary"
                        iconClassName="text-slate-700 dark:text-slate-300"
                    />
                    <IconButton
                        icon={isCompactView ? "grid" : "list"}
                        onPress={() => setIsCompactView(!isCompactView)}
                        ariaLabel="Toggle View"
                        variant="secondary"
                        iconClassName="text-slate-700 dark:text-slate-300"
                    />
                    <IconButton
                        icon="settings"
                        onPress={() => navigation.navigate('Settings')}
                        variant="secondary"
                        iconClassName="text-slate-700 dark:text-slate-300"
                    />
                </View>
            </View>


            <View className="mb-4 mt-2">
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
                >
                    {CATEGORIES.map(category => {
                        const isActive = selectedCategory === category;
                        return (
                            <TouchableOpacity
                                key={category}
                                onPress={() => setSelectedCategory(category)}
                                className={`px-4 py-2 rounded-full border ${isActive ? 'bg-slate-900 border-slate-900 dark:bg-white dark:border-white' : 'bg-transparent border-slate-300 dark:border-slate-600'}`}
                            >
                                <Text className={`font-medium ${isActive ? 'text-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-300'}`}>
                                    {category}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
            </View>

            <View className="px-4 flex-row justify-between items-center mb-2">
                <View className="flex-row items-center">
                    <Text className="text-xs font-bold tracking-wider text-slate-500 uppercase mr-3">
                        Data Range
                    </Text>
                    <TouchableOpacity onPress={() => setSettingsModalVisible(true)} className="flex-row items-center border-l border-slate-300 dark:border-slate-700 pl-3">
                        <Text className="text-xs font-bold text-blue-500">Columns</Text>
                    </TouchableOpacity>
                </View>
                <View className="flex-row items-center">
                    <Text className="text-xs text-slate-500 mr-2">Sort:</Text>
                    <TouchableOpacity
                        onPress={() => setSortModalVisible(true)}
                        className="flex-row items-center bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700"
                    >
                        <Text className="text-xs font-bold text-slate-700 dark:text-slate-300">
                            {getSortText()}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 6 }}
            >
                {RANGES.map(range => {
                    const isActive = selectedRange === range;
                    return (
                        <TouchableOpacity
                            key={range}
                            onPress={() => setSelectedRange(range)}
                            className={`min-w-[44px] h-[34px] items-center justify-center rounded-lg ${isActive ? 'bg-blue-100 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800' : 'bg-slate-100 dark:bg-slate-800 border border-transparent'}`}
                        >
                            <Text className={`text-xs font-bold ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-600 dark:text-slate-400'}`}>
                                {range}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>
        </View>
    );

    if (loading && !refreshing) {
        return (
            <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900">
                {renderHeader()}
                <View className="flex-1 items-center justify-center">
                    <ActivityIndicator size="large" color="#3b82f6" />
                </View>
            </SafeAreaView>
        );
    }

    if (error && data.length === 0) {
        return (
            <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900">
                {renderHeader()}
                <View className="flex-1 items-center justify-center">
                    <Text className="text-rose-500 font-bold px-4 text-center">{error}</Text>
                    <TouchableOpacity
                        onPress={handleRefresh}
                        className="mt-4 bg-slate-900 dark:bg-white rounded-lg px-4 py-2"
                    >
                        <Text className="font-bold text-white dark:text-slate-900">Retry</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900">
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
            <FlatList
                data={data}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                    isCompactView ? (
                        <CompactCommodityRow
                            commodity={item}
                            onPress={(commodity) => navigation.navigate('CommodityDetail', { commodity })}
                        />
                    ) : (
                        <CommodityCard
                            commodity={item}
                            onPress={(commodity) => navigation.navigate('CommodityDetail', { commodity })}
                        />
                    )
                )}
                ListHeaderComponent={renderHeader}
                ListEmptyComponent={
                    <View className="px-4 pt-10 items-center">
                        <Text className="text-slate-500 dark:text-slate-400 text-center">
                            No commodities found for the selected filters.
                        </Text>
                    </View>
                }
                ListFooterComponent={renderErrorBanner}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
                }
                contentContainerStyle={{ paddingBottom: 20 }}
            />

            {/* Architectural Feature Modals */}
            <HomeModals
                data={data}
                navigation={navigation}
                isSettingsModalVisible={isSettingsModalVisible}
                setSettingsModalVisible={setSettingsModalVisible}
                showCategory={showCategory}
                setShowCategory={setShowCategory}
                showChangePercent={showChangePercent}
                setShowChangePercent={setShowChangePercent}
                showChangeAbs={showChangeAbs}
                setShowChangeAbs={setShowChangeAbs}
                showDate={showDate}
                setShowDate={setShowDate}
                showUnit={showUnit}
                setShowUnit={setShowUnit}
                fontScale={fontScale}
                setFontScale={setFontScale}
                density={density}
                setDensity={setDensity}
                isSortModalVisible={isSortModalVisible}
                setSortModalVisible={setSortModalVisible}
                sortMethod={sortMethod}
                setSortMethod={setSortMethod}
                sortOrder={sortOrder}
                setSortOrder={setSortOrder}
                isSearchModalVisible={isSearchModalVisible}
                setSearchModalVisible={setSearchModalVisible}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
            />
        </SafeAreaView>
    );
}
