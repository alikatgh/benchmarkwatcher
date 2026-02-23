import React, { useEffect, useState, useContext, useRef } from 'react';
import { View, Text, FlatList, ActivityIndicator, SafeAreaView, StatusBar, RefreshControl, ScrollView, TouchableOpacity, AppState, Modal, Switch, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import { fetchCommodities } from '../api/commodities';
import { Commodity } from '../types/commodity';
import CommodityCard from '../components/CommodityCard';
import CompactCommodityRow from '../components/CompactCommodityRow';
import { SettingsContext } from '../context/SettingsContext';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

const CATEGORIES = ['All', 'Energy', 'Metal', 'Agricultural', 'Precious', 'Livestock'];
const RANGES = ['1W', '1M', '3M', '6M', '1Y', 'ALL'];

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
        density, setDensity
    } = useContext(SettingsContext);

    // Data State
    const [data, setData] = useState<Commodity[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
    const [lastFetchTime, setLastFetchTime] = useState<string | null>(null);

    const appState = useRef(AppState.currentState);

    const getSortText = () => {
        if (sortMethod === 'change_percent') return sortOrder === 'desc' ? '↑ % Gain' : '↓ % Loss';
        if (sortMethod === 'name' || sortMethod === 'priority') return sortOrder === 'asc' ? 'Name (A-Z)' : 'Name (Z-A)';
        if (sortMethod === 'price') return sortOrder === 'desc' ? 'Highest Price' : 'Lowest Price';
        if (sortMethod === 'volatility') return sortOrder === 'desc' ? 'Most Volatile' : 'Least Volatile';
        return 'Sort Options';
    };

    const loadData = async (category = selectedCategory, range = selectedRange, sort = sortMethod, order = sortOrder) => {
        try {
            const apiCat = category.toLowerCase() === 'all' ? '' : category.toLowerCase();
            const result = await fetchCommodities(apiCat, sort, order, range);
            setData(result);
            setLastFetchTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            setError(null);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch data');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    // Load data when filters change
    useEffect(() => {
        setLoading(true);
        loadData(selectedCategory, selectedRange, sortMethod, sortOrder);
    }, [selectedCategory, selectedRange, sortMethod, sortOrder]);

    // Background Sync
    useEffect(() => {
        let intervalId: ReturnType<typeof setInterval>;

        if (syncEnabled) {
            intervalId = setInterval(() => {
                loadData();
            }, 30000);
        }

        const subscription = AppState.addEventListener('change', nextAppState => {
            if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
                if (syncEnabled) loadData();
            }
            appState.current = nextAppState;
        });

        return () => {
            clearInterval(intervalId);
            subscription.remove();
        };
    }, [syncEnabled, selectedCategory, selectedRange, sortMethod, sortOrder]);

    // Force Sync
    useEffect(() => {
        if (syncTrigger > 0) {
            setRefreshing(true);
            loadData();
        }
    }, [syncTrigger]);

    const handleRefresh = () => {
        setRefreshing(true);
        loadData();
    };

    const renderHeader = () => (
        <View className="pt-6 pb-2">
            <View className="px-4 mb-4 flex-row justify-between items-center">
                <View>
                    <Text className="text-3xl font-bold text-slate-900 dark:text-white">
                        Markets
                    </Text>
                    <Text className="text-sm text-slate-500 mt-1 mb-1">
                        Latest commodity benchmarks
                    </Text>
                    {lastFetchTime && (
                        <Text className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-bold">
                            Data as of {lastFetchTime}
                        </Text>
                    )}
                </View>
                <View className="flex-row items-center gap-2">
                    <TouchableOpacity
                        onPress={() => setSearchModalVisible(true)}
                        className="p-2 bg-slate-200 dark:bg-slate-700 rounded-full"
                        aria-label="Search"
                    >
                        <Text className="text-xl">🔍</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => setIsCompactView(!isCompactView)}
                        className="p-2 bg-slate-200 dark:bg-slate-700 rounded-full"
                        aria-label="Toggle View"
                    >
                        <Text className="text-xl">{isCompactView ? '🔳' : '≣'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => navigation.navigate('Settings')}
                        className="p-2 bg-slate-200 dark:bg-slate-700 rounded-full"
                    >
                        <Text className="text-xl">⚙️</Text>
                    </TouchableOpacity>
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
                        Display Range
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
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900">
            <StatusBar barStyle="dark-content" />
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
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
                }
                contentContainerStyle={{ paddingBottom: 20 }}
            />

            {/* Grid Settings Modal */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={isSettingsModalVisible}
                onRequestClose={() => setSettingsModalVisible(false)}
            >
                <View className="flex-1 justify-end bg-black/50">
                    <View className="bg-white dark:bg-slate-900 rounded-t-3xl pt-5 pb-8 px-6 max-h-[80%]">
                        <View className="flex-row justify-between items-center mb-6">
                            <Text className="text-xl font-bold text-slate-900 dark:text-white">Grid Layout & Columns</Text>
                            <TouchableOpacity onPress={() => setSettingsModalVisible(false)} className="bg-slate-100 dark:bg-slate-800 p-2 rounded-full">
                                <Text className="text-slate-500 dark:text-slate-400 font-bold">Close</Text>
                            </TouchableOpacity>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false}>
                            {/* Column Visibility Toggles */}
                            <Text className="text-xs font-bold tracking-wider text-slate-500 uppercase mb-3 mt-2">Column Visibility</Text>
                            <View className="bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden mb-6">
                                {[
                                    { label: 'Category Tag', value: showCategory, setter: setShowCategory },
                                    { label: '% Change Badge', value: showChangePercent, setter: setShowChangePercent },
                                    { label: 'Absolute Change', value: showChangeAbs, setter: setShowChangeAbs },
                                    { label: 'Last Update Date', value: showDate, setter: setShowDate },
                                    { label: 'Currency / Unit', value: showUnit, setter: setShowUnit },
                                ].map((item, index) => (
                                    <View key={item.label} className={`flex-row justify-between items-center p-4 ${index !== 4 ? 'border-b border-slate-200 dark:border-slate-700' : ''}`}>
                                        <Text className="text-slate-700 dark:text-slate-300 font-medium">{item.label}</Text>
                                        <Switch
                                            value={item.value}
                                            onValueChange={item.setter}
                                            trackColor={{ false: '#cbd5e1', true: '#3b82f6' }}
                                            thumbColor="#ffffff"
                                        />
                                    </View>
                                ))}
                            </View>

                            {/* Font Scale */}
                            <Text className="text-xs font-bold tracking-wider text-slate-500 uppercase mb-3">Font Scale</Text>
                            <View className="flex-row bg-slate-100 dark:bg-slate-800 p-1 rounded-xl mb-6">
                                {['small', 'medium', 'large'].map((scale) => (
                                    <TouchableOpacity
                                        key={scale}
                                        onPress={() => setFontScale(scale as 'small' | 'medium' | 'large')}
                                        className={`flex-1 items-center py-2 rounded-lg ${fontScale === scale ? 'bg-white dark:bg-slate-700 shadow-sm' : ''}`}
                                    >
                                        <Text className={`capitalize font-medium ${fontScale === scale ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}>{scale}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            {/* Density */}
                            <Text className="text-xs font-bold tracking-wider text-slate-500 uppercase mb-3">Layout Density</Text>
                            <View className="flex-row bg-slate-100 dark:bg-slate-800 p-1 rounded-xl mb-8">
                                {['compact', 'cozy', 'roomy'].map((dens) => (
                                    <TouchableOpacity
                                        key={dens}
                                        onPress={() => setDensity(dens as 'compact' | 'cozy' | 'roomy')}
                                        className={`flex-1 items-center py-2 rounded-lg ${density === dens ? 'bg-white dark:bg-slate-700 shadow-sm' : ''}`}
                                    >
                                        <Text className={`capitalize font-medium ${density === dens ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}>{dens}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            {/* Advanced Sorting Modal */}
            <Modal
                animationType="fade"
                transparent={true}
                visible={isSortModalVisible}
                onRequestClose={() => setSortModalVisible(false)}
            >
                <TouchableOpacity
                    className="flex-1 justify-center bg-black/50 p-6"
                    activeOpacity={1}
                    onPressOut={() => setSortModalVisible(false)}
                >
                    <View className="bg-white dark:bg-slate-900 rounded-2xl overflow-hidden p-2">
                        <Text className="text-lg font-bold text-slate-900 dark:text-white mb-2 px-4 pt-3 pb-2 text-center border-b border-slate-100 dark:border-slate-800">
                            Sort Commodities
                        </Text>
                        {[
                            { label: 'Name (A-Z)', method: 'name', order: 'asc' },
                            { label: 'Name (Z-A)', method: 'name', order: 'desc' },
                            { label: 'Highest % Gain', method: 'change_percent', order: 'desc' },
                            { label: 'Highest % Loss', method: 'change_percent', order: 'asc' },
                            { label: 'Highest Price', method: 'price', order: 'desc' },
                            { label: 'Lowest Price', method: 'price', order: 'asc' },
                            { label: 'Most Volatile (30d)', method: 'volatility', order: 'desc' },
                            { label: 'Least Volatile (30d)', method: 'volatility', order: 'asc' },
                        ].map((option) => {
                            const isActive = sortMethod === option.method && sortOrder === option.order;
                            return (
                                <TouchableOpacity
                                    key={option.label}
                                    onPress={() => {
                                        setSortMethod(option.method);
                                        setSortOrder(option.order);
                                        setSortModalVisible(false);
                                    }}
                                    className={`py-3 px-4 rounded-xl mb-1 ${isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                                >
                                    <Text className={`text-center font-medium ${isActive ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-slate-700 dark:text-slate-300'}`}>
                                        {option.label}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* Global Search Modal */}
            <Modal
                animationType="slide"
                transparent={false}
                visible={isSearchModalVisible}
                onRequestClose={() => {
                    setSearchModalVisible(false);
                    setSearchQuery('');
                }}
            >
                <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900">
                    <View className="px-4 py-4 flex-row items-center border-b border-slate-200 dark:border-slate-800">
                        <TouchableOpacity
                            onPress={() => {
                                setSearchModalVisible(false);
                                setSearchQuery('');
                            }}
                            className="mr-3"
                        >
                            <Text className="text-2xl text-slate-500 dark:text-slate-400">←</Text>
                        </TouchableOpacity>
                        <View className="flex-1 flex-row items-center bg-slate-200 dark:bg-slate-800 rounded-xl px-4 py-2 flex-row items-center">
                            <Text className="text-lg mr-2">🔍</Text>
                            <TextInput
                                className="flex-1 text-slate-900 dark:text-white text-base"
                                placeholder="Search commodities..."
                                placeholderTextColor="#94a3b8"
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                                autoFocus
                                clearButtonMode="while-editing"
                            />
                        </View>
                    </View>

                    <FlatList
                        data={data.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.category.toLowerCase().includes(searchQuery.toLowerCase()))}
                        keyExtractor={(item) => item.id}
                        contentContainerStyle={{ paddingTop: 12, paddingBottom: 20 }}
                        keyboardShouldPersistTaps="handled"
                        ListEmptyComponent={
                            <View className="flex-1 items-center justify-center pt-10">
                                <Text className="text-slate-500 text-base">No commodities found matching "{searchQuery}"</Text>
                            </View>
                        }
                        renderItem={({ item }) => (
                            <CompactCommodityRow
                                commodity={item}
                                onPress={(commodity) => {
                                    setSearchModalVisible(false);
                                    navigation.navigate('CommodityDetail', { commodity });
                                }}
                            />
                        )}
                    />
                </SafeAreaView>
            </Modal>
        </SafeAreaView>
    );
}
