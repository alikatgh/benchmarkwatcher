import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import IconButton from '../ui/IconButton';
import Badge from '../ui/Badge';

interface CommodityHeaderProps {
    commodity: any;
    isUp: boolean;
    changeColor: string;
    badgeColor: string;
    handleCopyPrice: () => void;
    selectedChangePeriod: '1' | '30' | '365';
    onChangePeriod: (period: '1' | '30' | '365') => void;
    changePercent: number;
    changeAbs: number | null;
    changeContextLabel: string;
}

export default function CommodityHeader({
    commodity,
    isUp,
    changeColor,
    badgeColor,
    handleCopyPrice,
    selectedChangePeriod,
    onChangePeriod,
    changePercent,
    changeAbs,
    changeContextLabel,
}: CommodityHeaderProps) {
    const periodButtons: Array<{ key: '1' | '30' | '365'; label: string }> = [
        { key: '1', label: 'Prev obs' },
        { key: '30', label: '~30 obs' },
        { key: '365', label: '~1 year' },
    ];

    return (
        <View className="px-5 pt-4">
            <Text className="text-xl text-slate-500 dark:text-slate-400 font-medium mb-1 uppercase tracking-wider">
                {commodity.category}
            </Text>
            <Text className="text-4xl font-bold text-slate-900 dark:text-white mb-6">
                {commodity.name}
            </Text>

            <View className="mb-6 flex-row items-center justify-between">
                <View>
                    <Text className="text-5xl font-bold text-slate-900 dark:text-white" numberOfLines={1} adjustsFontSizeToFit>
                        {commodity.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </Text>
                    <Text className="text-lg text-slate-500 dark:text-slate-400 mt-1">
                        {commodity.currency} / {commodity.unit}
                    </Text>
                </View>
                <IconButton
                    icon="copy"
                    variant="secondary"
                    onPress={handleCopyPrice}
                    ariaLabel="Copy price to clipboard"
                    iconClassName="text-slate-600 dark:text-slate-400"
                />
            </View>

            <View className="flex-row items-center flex-wrap gap-3 mb-6">
                <Text className={`text-xl font-bold ${changeColor}`}>
                    {isUp ? '+' : ''}{Math.abs(changePercent).toFixed(2)}%
                </Text>
                {selectedChangePeriod === '1' && typeof changeAbs === 'number' && (
                    <Text className={`text-sm ${changeColor}`}>
                        ({isUp ? '+' : ''}{changeAbs})
                    </Text>
                )}
                <View className="ml-2">
                    <Badge
                        label={isUp ? '↑' : '↓'}
                        variant={isUp ? 'success' : 'danger'}
                    />
                </View>
            </View>

            <Text className="text-xs text-slate-500 dark:text-slate-400 mb-3">{changeContextLabel}</Text>

            <View className="flex-row items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800 mb-6 self-start">
                {periodButtons.map((btn) => {
                    const isActive = selectedChangePeriod === btn.key;
                    return (
                        <TouchableOpacity
                            key={btn.key}
                            onPress={() => onChangePeriod(btn.key)}
                            className={`px-3 py-1.5 rounded-lg ${isActive ? 'bg-white dark:bg-slate-700' : ''}`}
                            accessibilityRole="button"
                            accessibilityState={{ selected: isActive }}
                        >
                            <Text className={`text-[11px] font-bold ${isActive ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                                {btn.label}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
}
