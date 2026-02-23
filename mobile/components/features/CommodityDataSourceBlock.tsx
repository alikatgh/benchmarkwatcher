import React from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';

interface CommodityDataSourceBlockProps {
    commodity: any;
}

export default function CommodityDataSourceBlock({ commodity }: CommodityDataSourceBlockProps) {
    if (!commodity) return null;

    return (
        <View className="px-5 mb-6">
            <View className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                <View className="flex-row justify-between mb-2">
                    <Text className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider">DATA SOURCE</Text>
                    <Text className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider">UPDATED</Text>
                </View>
                <View className="flex-row justify-between items-center">
                    <View>
                        <Text className="text-sm font-bold text-slate-900 dark:text-white">{commodity.source_name || 'N/A'}</Text>
                        {commodity.source_url && (
                            <TouchableOpacity onPress={() => Linking.openURL(commodity.source_url)}>
                                <Text className="text-xs text-blue-500 mt-0.5">View Source →</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                    <View className="items-end">
                        <Text className="text-sm font-bold text-slate-900 dark:text-white">{commodity.updated_at ? commodity.updated_at.substring(0, 10) : 'N/A'}</Text>
                    </View>
                </View>
            </View>
        </View>
    );
}
