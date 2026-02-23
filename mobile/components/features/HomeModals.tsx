import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Switch, Modal, TextInput, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../ui/Icon';
import IconButton from '../ui/IconButton';
import CompactCommodityRow from '../CompactCommodityRow';
import { Commodity } from '../../types/commodity';

interface HomeModalsProps {
    // Shared Data
    data: Commodity[];
    navigation: any;

    // Settings Modal
    isSettingsModalVisible: boolean;
    setSettingsModalVisible: (v: boolean) => void;
    showCategory: boolean;
    setShowCategory: (v: boolean) => void;
    showChangePercent: boolean;
    setShowChangePercent: (v: boolean) => void;
    showChangeAbs: boolean;
    setShowChangeAbs: (v: boolean) => void;
    showDate: boolean;
    setShowDate: (v: boolean) => void;
    showUnit: boolean;
    setShowUnit: (v: boolean) => void;
    fontScale: 'small' | 'medium' | 'large';
    setFontScale: (v: 'small' | 'medium' | 'large') => void;
    density: 'compact' | 'cozy' | 'roomy';
    setDensity: (v: 'compact' | 'cozy' | 'roomy') => void;

    // Sort Modal
    isSortModalVisible: boolean;
    setSortModalVisible: (v: boolean) => void;
    sortMethod: string;
    setSortMethod: (v: string) => void;
    sortOrder: string;
    setSortOrder: (v: string) => void;

    // Search Modal
    isSearchModalVisible: boolean;
    setSearchModalVisible: (v: boolean) => void;
    searchQuery: string;
    setSearchQuery: (v: string) => void;
}

export default function HomeModals({
    data, navigation,
    isSettingsModalVisible, setSettingsModalVisible,
    showCategory, setShowCategory,
    showChangePercent, setShowChangePercent,
    showChangeAbs, setShowChangeAbs,
    showDate, setShowDate,
    showUnit, setShowUnit,
    fontScale, setFontScale,
    density, setDensity,
    isSortModalVisible, setSortModalVisible,
    sortMethod, setSortMethod,
    sortOrder, setSortOrder,
    isSearchModalVisible, setSearchModalVisible,
    searchQuery, setSearchQuery
}: HomeModalsProps) {

    return (
        <>
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
                        <IconButton
                            icon="back"
                            onPress={() => {
                                setSearchModalVisible(false);
                                setSearchQuery('');
                            }}
                            variant="ghost"
                            className="mr-1"
                            iconClassName="text-slate-500 dark:text-slate-400"
                        />
                        <View className="flex-1 flex-row items-center bg-slate-200 dark:bg-slate-800 rounded-xl px-4 py-2 flex-row items-center">
                            <Icon name="search" size={18} className="text-slate-500 dark:text-slate-400 mr-2" />
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
        </>
    );
}
