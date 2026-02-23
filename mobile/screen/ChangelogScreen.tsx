import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import { changelogData } from '../data/changelogData';
import ChangelogItem from '../components/features/changelog/ChangelogItem';

type Props = NativeStackScreenProps<RootStackParamList, 'Changelog'>;

export default function ChangelogScreen({ navigation }: Props) {

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
                {changelogData.map((release, i) => (
                    <ChangelogItem
                        key={release.version}
                        release={release}
                        isLast={i === changelogData.length - 1}
                    />
                ))}

                {/* Bottom Padding */}
                <View className="h-12" />
            </ScrollView>
        </SafeAreaView>
    );
}
