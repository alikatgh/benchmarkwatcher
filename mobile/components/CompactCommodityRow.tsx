import React, { useContext } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Commodity } from '../types/commodity';
import { SettingsContext } from '../context/SettingsContext';

interface Props {
    commodity: Commodity;
    onPress: (commodity: Commodity) => void;
}

export default function CompactCommodityRow({ commodity, onPress }: Props) {
    const {
        showCategory, showChangePercent, showChangeAbs,
        showUnit, showDate, fontScale, density,
        getMarketColors
    } = useContext(SettingsContext);

    const isUp = commodity.change >= 0;
    const { textColor: changeColor, bgColor } = getMarketColors(isUp);

    // Style adjustments based on Density
    const rowPadding = density === 'compact' ? 'py-1.5 px-3' : density === 'roomy' ? 'py-4 px-6' : 'py-3 px-4';
    const iconSize = density === 'compact' ? 'w-8 h-8' : density === 'roomy' ? 'w-12 h-12' : 'w-10 h-10';

    // Style adjustments based on Font Scale
    const titleText = fontScale === 'small' ? 'text-xs' : fontScale === 'large' ? 'text-base' : 'text-sm';
    const metaText = fontScale === 'small' ? 'text-[9px]' : fontScale === 'large' ? 'text-xs' : 'text-[10px]';

    const isDaily = commodity.is_daily === true;
    const frequencyTag = isDaily ? 'D' : 'M';

    const trendDirection = (() => {
        const history = commodity.history;
        if (!history || history.length < 2) {
            if (commodity.change > 0) return { icon: '▲', label: 'Up' };
            if (commodity.change < 0) return { icon: '▼', label: 'Down' };
            return { icon: '→', label: 'Flat' };
        }
        const last = history[history.length - 1]?.price;
        const prev = history[history.length - 2]?.price;
        if (typeof last !== 'number' || typeof prev !== 'number') return { icon: '→', label: 'Flat' };
        if (last > prev) return { icon: '▲', label: 'Up' };
        if (last < prev) return { icon: '▼', label: 'Down' };
        return { icon: '→', label: 'Flat' };
    })();

    return (
        <TouchableOpacity
            onPress={() => onPress(commodity)}
            className={`flex-row items-center justify-between bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700/50 ${rowPadding}`}
        >
            {/* Left Box: Icon/Name/Category */}
            <View className="flex-row items-center flex-1">
                <View className={`${iconSize} rounded-lg bg-slate-100 dark:bg-slate-700 items-center justify-center mr-3`}>
                    <Text className={`font-bold text-slate-500 dark:text-slate-400 ${metaText}`}>
                        {commodity.name.substring(0, 2).toUpperCase()}
                    </Text>
                </View>
                <View className="flex-1 mr-2">
                    <Text className={`${titleText} font-bold text-slate-900 dark:text-white`} numberOfLines={1}>
                        {commodity.name}
                    </Text>
                    {showCategory && (
                        <View className="flex-row items-center mt-0.5 gap-1.5">
                            <Text className={`text-slate-500 dark:text-slate-400 ${metaText}`}>
                                {commodity.category}
                            </Text>
                            <Text className={`font-bold text-slate-400 dark:text-slate-500 ${metaText}`}>
                                {frequencyTag}
                            </Text>
                        </View>
                    )}
                </View>
            </View>

            {/* Middle Box: Price */}
            <View className="items-end mr-4">
                <Text className={`${titleText} font-bold text-slate-900 dark:text-white`}>
                    {commodity.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                </Text>
                {showUnit && (
                    <Text className={`text-slate-500 dark:text-slate-400 mt-0.5 ${metaText}`}>
                        {commodity.currency} / {commodity.unit}
                    </Text>
                )}
                {showDate && (
                    <Text className={`text-slate-400 dark:text-slate-500 mt-0.5 ${metaText}`}>
                        {commodity.date}
                    </Text>
                )}
                <Text className={`mt-0.5 ${metaText} ${isUp ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                    {trendDirection.icon} Trend {trendDirection.label}
                </Text>
            </View>

            {/* Right Box: Change */}
            {(showChangePercent || showChangeAbs) && (
                <View className={`items-end px-2 py-1 rounded-md min-w-[64px] ${bgColor}`}>
                    {showChangePercent && (
                        <Text className={`font-bold ${changeColor} ${fontScale === 'small' ? 'text-[10px]' : fontScale === 'large' ? 'text-sm' : 'text-xs'}`}>
                            {isUp ? '+' : ''}{commodity.change_percent}%
                        </Text>
                    )}
                    {showChangeAbs && (
                        <Text className={`${changeColor} mt-0.5 ${metaText}`}>
                            {isUp ? '+' : ''}{commodity.change}
                        </Text>
                    )}
                </View>
            )}
        </TouchableOpacity>
    );
}
