import React from 'react';
import { View, Text, SafeAreaView, ScrollView, TouchableOpacity } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Changelog'>;

export default function ChangelogScreen({ navigation }: Props) {
    const changelog = [
        {
            version: "v1.2.0",
            date: "February 23, 2026",
            title: "USDA Source Expansion & Mobile-First UI",
            tag: "NEW",
            tagColor: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
            description: "Massive expansion from 26 to 72 tracked commodities, plus a complete mobile-first UI overhaul.",
            sections: [
                {
                    header: "Data Pipeline",
                    points: [
                        "Added USDA NASS as a third data source (alongside FRED and EIA)",
                        "New Livestock category: Cattle, Hogs, Milk, Chicken, Eggs, Turkeys, Wool, Lamb",
                        "Expanded agricultural coverage: Oats, Barley, Sorghum, and US Farm Prices",
                        "Refactored monolithic fetch script into modular package (scripts/fetchers/)",
                        "Shared utilities: SmartDateParser, safe_get, merge_history, compute_metrics",
                        "Total commodities: 72 across 5 sources"
                    ]
                },
                {
                    header: "Mobile-First UI",
                    points: [
                        "Scroll-hide category nav (Google Console style) — hides on scroll down, reappears on scroll up",
                        "Added Livestock and Indices links to category navigation",
                        "Horizontally scrollable range buttons and chart controls on mobile",
                        "Price hero section stacks vertically on mobile with responsive font sizes",
                        "Responsive chart height (280px → 350px → 400px by breakpoint)",
                        "Crosshair info and chart actions stack on narrow screens"
                    ]
                }
            ]
        },
        {
            version: "v1.1.0",
            date: "January 11, 2026",
            title: "Telegram & Discord Bots",
            tag: "UPDATE",
            tagColor: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
            description: "Get commodity prices directly in your messaging apps! We've launched official bots for both Telegram and Discord.",
            sections: [
                {
                    header: "Bot Commands",
                    points: [
                        "/price brent — Get a commodity price",
                        "/prices energy — All prices in a category",
                        "/top — Top gainers and losers",
                        "/list — All available commodities"
                    ]
                }
            ]
        },
        {
            version: "v1.0.0",
            date: "January 2026",
            title: "Initial Release",
            tag: "LAUNCH",
            tagColor: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
            description: "BenchmarkWatcher launches with daily commodity benchmark tracking.",
            sections: [
                {
                    header: "Features",
                    points: [
                        "30+ commodities across energy, precious metals, industrial metals, and agriculture",
                        "Daily end-of-day prices from EIA, FRED, and World Bank",
                        "Historical charts and price change tracking",
                        "Multiple themes: Light, Dark, Bloomberg, FT, and Monochrome",
                        "Responsive design for desktop and mobile",
                        "Open source on GitHub"
                    ]
                }
            ]
        }
    ];

    return (
        <SafeAreaView className="flex-1 bg-white dark:bg-slate-900">
            {/* Header */}
            <View className="px-5 pt-6 pb-4 border-b border-slate-100 dark:border-slate-800 flex-row items-center">
                <TouchableOpacity onPress={() => navigation.goBack()} className="mr-4">
                    <Text className="text-blue-600 dark:text-blue-400 font-bold text-lg">{'<'}</Text>
                </TouchableOpacity>
                <View>
                    <Text className="text-2xl font-bold text-slate-900 dark:text-white font-serif">Changelog</Text>
                    <Text className="text-sm text-slate-500 dark:text-slate-400 mt-1">Updates, new features, and improvements</Text>
                </View>
            </View>

            {/* List */}
            <ScrollView className="flex-1 px-5 pt-6 pb-12">
                {changelog.map((release, i) => (
                    <View key={release.version} className={`mb-10 pb-10 ${i !== changelog.length - 1 ? 'border-b border-slate-100 dark:border-slate-800' : ''}`}>
                        <View className="flex-row items-center gap-3 mb-3">
                            <View className={`px-2.5 py-1 rounded-full ${release.tagColor}`}>
                                <Text className="text-[10px] font-bold tracking-wider">{release.tag}</Text>
                            </View>
                            <Text className="text-sm text-slate-400 dark:text-slate-500 font-medium">{release.date}</Text>
                        </View>

                        <Text className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            {release.version} — {release.title}
                        </Text>

                        <Text className="text-slate-600 dark:text-slate-300 leading-relaxed mb-6">
                            {release.description}
                        </Text>

                        {release.sections.map(section => (
                            <View key={section.header} className="mb-5">
                                <Text className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-3">
                                    {section.header}
                                </Text>
                                {section.points.map((point, j) => (
                                    <View key={j} className="flex-row items-start mb-2 pl-2">
                                        <View className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 mt-2 mr-3" />
                                        <Text className="flex-1 text-slate-600 dark:text-slate-400 leading-relaxed">
                                            {point}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        ))}
                    </View>
                ))}

                {/* Bottom Padding */}
                <View className="h-12" />
            </ScrollView>
        </SafeAreaView>
    );
}
