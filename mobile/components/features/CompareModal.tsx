import React, { useState, useEffect, useContext } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { SettingsContext } from '../../context/SettingsContext';
import { Commodity, ComparisonSeries } from '../../types/commodity';
import { fetchCommodities } from '../../api/commodities';
import Icon from '../ui/Icon';

const COMPARISON_COLORS = [
    '#e11d48', '#8b5cf6', '#f59e0b', '#06b6d4',
    '#84cc16', '#ec4899', '#14b8a6', '#f97316',
];

const MAX_COMPARISONS = 4;

interface CompareModalProps {
    visible: boolean;
    onClose: () => void;
    currentCommodityId: string;
    comparisons: ComparisonSeries[];
    onToggleCommodity: (commodity: Commodity) => void;
    onRemoveComparison: (commodityId: string) => void;
    onClearAll: () => void;
}

export default function CompareModal({
    visible, onClose, currentCommodityId,
    comparisons, onToggleCommodity, onRemoveComparison, onClearAll,
}: CompareModalProps) {
    const { isDarkMode } = useContext(SettingsContext);
    const [search, setSearch] = useState('');
    const [commodities, setCommodities] = useState<Commodity[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    const loadCommodities = async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const data = await fetchCommodities('all', 'name', 'asc', '1W');
            setCommodities(data.filter(c => c.id !== currentCommodityId));
        } catch {
            setCommodities([]);
            setLoadError('Unable to load commodity list. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!visible) return;
        loadCommodities();
    }, [visible, currentCommodityId]);

    const filtered = search.trim()
        ? commodities.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
        : commodities;

    // Group by category
    const grouped = filtered.reduce<Record<string, Commodity[]>>((acc, c) => {
        const cat = c.category || 'Other';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(c);
        return acc;
    }, {});

    const isSelected = (id: string) => comparisons.some(c => c.id === id);
    const getColor = (id: string) => comparisons.find(c => c.id === id)?.color;
    const atLimit = comparisons.length >= MAX_COMPARISONS;

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <View className="flex-1 bg-white dark:bg-slate-900">
                {/* Header */}
                <View className="flex-row items-center justify-between px-5 pt-4 pb-3 border-b border-slate-200 dark:border-slate-700">
                    <Text className="text-lg font-bold text-slate-900 dark:text-white">Compare Commodities</Text>
                    <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close compare commodities" hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }} className="p-2">
                        <Icon name="close" size={20} color={isDarkMode ? '#94a3b8' : '#475569'} />
                    </TouchableOpacity>
                </View>

                {/* Search */}
                <View className="px-5 pt-3 pb-2">
                    <View className="flex-row items-center bg-slate-100 dark:bg-slate-800 rounded-xl px-4 py-2.5">
                        <Icon name="search" size={16} color="#94a3b8" />
                        <TextInput
                            value={search}
                            onChangeText={setSearch}
                            placeholder="Search commodities..."
                            placeholderTextColor="#94a3b8"
                            accessibilityLabel="Search commodities"
                            autoCapitalize="none"
                            autoCorrect={false}
                            returnKeyType="search"
                            clearButtonMode="while-editing"
                            className="flex-1 ml-2 text-sm text-slate-900 dark:text-white"
                        />
                    </View>
                    {comparisons.length > 0 && (
                        <View className="flex-row items-center justify-between mt-3">
                            <Text className="text-xs text-slate-500 dark:text-slate-400">
                                {comparisons.length}/{MAX_COMPARISONS} selected
                            </Text>
                            <TouchableOpacity onPress={onClearAll} accessibilityRole="button" accessibilityLabel="Clear all selected comparisons">
                                <Text className="text-xs font-bold text-rose-500">Clear All</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>

                {/* Active comparison tags */}
                {comparisons.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" className="px-5 pb-3">
                        <View className="flex-row gap-2">
                            {comparisons.map(comp => (
                                <TouchableOpacity
                                    key={comp.id}
                                    onPress={() => onRemoveComparison(comp.id)}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Remove ${comp.name} from comparison`}
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

                {/* Commodity List */}
                {loading ? (
                    <View className="flex-1 items-center justify-center">
                        <ActivityIndicator size="large" color="#3b82f6" />
                    </View>
                ) : loadError ? (
                    <View className="flex-1 items-center justify-center px-6">
                        <Text className="text-sm text-rose-500 font-semibold text-center">{loadError}</Text>
                        <TouchableOpacity onPress={loadCommodities} accessibilityRole="button" accessibilityLabel="Retry loading commodities" className="mt-4 bg-slate-900 dark:bg-white rounded-lg px-4 py-2">
                            <Text className="font-bold text-white dark:text-slate-900">Retry</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <ScrollView className="flex-1 px-5" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
                        {Object.entries(grouped).length === 0 ? (
                            <View className="pt-10 items-center">
                                <Text className="text-slate-500 dark:text-slate-400 text-center">
                                    No commodities match your search.
                                </Text>
                            </View>
                        ) : Object.entries(grouped).map(([category, items]) => (
                            <View key={category} className="mb-4">
                                <Text className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 mt-2">
                                    {category}
                                </Text>
                                {items.map(commodity => {
                                    const selected = isSelected(commodity.id);
                                    const disabled = !selected && atLimit;
                                    return (
                                        <TouchableOpacity
                                            key={commodity.id}
                                            onPress={() => !disabled && onToggleCommodity(commodity)}
                                            disabled={disabled}
                                            accessibilityRole="button"
                                            accessibilityLabel={`${isSelected(commodity.id) ? 'Remove' : 'Add'} ${commodity.name} ${isSelected(commodity.id) ? 'from' : 'to'} comparison`}
                                            accessibilityState={{ disabled, selected }}
                                            className={`flex-row items-center justify-between py-3 px-3 rounded-lg mb-1 ${selected ? 'bg-blue-50 dark:bg-blue-900/20' : ''} ${disabled ? 'opacity-40' : ''}`}
                                        >
                                            <View className="flex-row items-center gap-3 flex-1">
                                                {selected && (
                                                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: getColor(commodity.id) }} />
                                                )}
                                                <Text className={`text-sm font-medium ${selected ? 'text-blue-700 dark:text-blue-300' : 'text-slate-800 dark:text-white'}`} numberOfLines={1}>
                                                    {commodity.name}
                                                </Text>
                                            </View>
                                            <View className="flex-row items-center gap-2">
                                                <Text className="text-xs text-slate-400 dark:text-slate-500">
                                                    {commodity.price} {commodity.currency}
                                                </Text>
                                                {selected && (
                                                    <Icon name="check" size={16} color="#3b82f6" />
                                                )}
                                            </View>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        ))}
                    </ScrollView>
                )}
            </View>
        </Modal>
    );
}

export { COMPARISON_COLORS, MAX_COMPARISONS };
