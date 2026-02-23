import React from 'react';
import { View, Text } from 'react-native';
import { ChangelogRelease } from '../../../data/changelogData';

interface ChangelogItemProps {
    release: ChangelogRelease;
    isLast: boolean;
}

export default function ChangelogItem({ release, isLast }: ChangelogItemProps) {
    return (
        <View className={`mb-10 pb-10 ${!isLast ? 'border-b border-slate-100 dark:border-slate-800' : ''}`}>
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
    );
}
