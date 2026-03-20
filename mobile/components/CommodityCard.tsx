import React, { useContext, useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Commodity } from '../types/commodity';
import { SettingsContext } from '../context/SettingsContext';
import MiniSparkline from './ui/MiniSparkline';

interface Props {
    commodity: Commodity;
    onPress: (commodity: Commodity) => void;
}

export default function CommodityCard({ commodity, onPress }: Props) {
    const {
        showCategory, showChangePercent, showChangeAbs,
        showDate, showUnit, fontScale, density,
        getMarketColors
    } = useContext(SettingsContext);

    const isUp = commodity.change >= 0;
    const { textColor: changeColor, bgColor: changeBg } = getMarketColors(isUp);

    const sparklineData = useMemo(() => {
        const h = commodity.history;
        if (!h || h.length < 2) return null;
        return h.slice(-30).map(p => p.price);
    }, [commodity.history]);

    const sparklineColor = isUp ? '#10b981' : '#ef4444';

    // Style adjustments based on Density
    const cardPadding = density === 'compact' ? 'p-3 mb-2 mx-3' : density === 'roomy' ? 'p-6 mb-5 mx-5' : 'p-4 mb-3 mx-4';
    const footerPadding = density === 'compact' ? 'mt-2 pt-2' : density === 'roomy' ? 'mt-4 pt-4' : 'mt-3 pt-3';

    // Style adjustments based on Font Scale
    const titleText = fontScale === 'small' ? 'text-base' : fontScale === 'large' ? 'text-xl' : 'text-lg';
    const metaText = fontScale === 'small' ? 'text-[10px]' : fontScale === 'large' ? 'text-sm' : 'text-xs';

    return (
        <TouchableOpacity
            className={`bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 ${cardPadding}`}
            activeOpacity={0.7}
            onPress={() => onPress(commodity)}
            accessibilityRole="button"
            accessibilityLabel={`${commodity.name}, ${commodity.price} ${commodity.currency}, ${isUp ? 'up' : 'down'} ${Math.abs(commodity.change_percent)}%`}
        >
            <View className="flex-row justify-between items-start mb-2">
                <View className="flex-1 mr-2">
                    <Text className={`${titleText} font-bold text-slate-800 dark:text-white mb-0.5`} numberOfLines={1}>
                        {commodity.name}
                    </Text>
                    {(showCategory || showUnit) && (
                        <Text className={`${metaText} text-slate-500 uppercase mt-0.5`}>
                            {showCategory ? commodity.category : ''}
                            {showCategory && showUnit ? ' • ' : ''}
                            {showUnit ? commodity.unit : ''}
                        </Text>
                    )}
                </View>
                <View className="items-end shrink-0">
                    <Text className={`${titleText} font-bold text-slate-800 dark:text-white mb-0.5`}>
                        {commodity.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </Text>
                    <Text className={`${metaText} text-slate-500 mt-0.5`}>
                        {commodity.currency}
                    </Text>
                </View>
            </View>

            {sparklineData && (
                <View className="my-1 items-center">
                    <MiniSparkline data={sparklineData} width={140} height={28} color={sparklineColor} />
                </View>
            )}

            {(showDate || showChangePercent || showChangeAbs) && (
                <View className={`flex-row items-center justify-between border-t border-slate-100 dark:border-slate-700 ${footerPadding}`}>
                    <Text className={`${metaText} text-slate-400`}>
                        {showDate ? commodity.date : ''}
                    </Text>
                    {(showChangePercent || showChangeAbs) && (
                        <View className={`px-2 py-1 rounded-md flex-row items-center ${changeBg}`}>
                            <Text className={`${metaText} font-bold ${changeColor}`}>
                                {showChangeAbs ? `${isUp ? '+' : ''}${commodity.change}` : ''}
                                {showChangeAbs && showChangePercent ? ' (' : ''}
                                {showChangePercent ? `${isUp ? '+' : ''}${commodity.change_percent}%` : ''}
                                {showChangeAbs && showChangePercent ? ')' : ''}
                            </Text>
                        </View>
                    )}
                </View>
            )}
        </TouchableOpacity>
    );
}
