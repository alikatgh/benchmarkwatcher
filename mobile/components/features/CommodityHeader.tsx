import React from 'react';
import { View, Text } from 'react-native';
import IconButton from '../ui/IconButton';
import Badge from '../ui/Badge';

interface CommodityHeaderProps {
    commodity: any;
    isUp: boolean;
    changeColor: string;
    badgeColor: string;
    handleCopyPrice: () => void;
}

export default function CommodityHeader({ commodity, isUp, changeColor, badgeColor, handleCopyPrice }: CommodityHeaderProps) {
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
                    {isUp ? '+' : ''}{commodity.change_percent}%
                </Text>
                <View className="ml-2">
                    <Badge
                        label={isUp ? '↑' : '↓'}
                        variant={isUp ? 'success' : 'danger'}
                    />
                </View>
            </View>
        </View>
    );
}
