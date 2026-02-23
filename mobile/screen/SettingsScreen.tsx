import React from 'react';
import { Text, SafeAreaView, ScrollView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import AppearanceSection from '../components/features/settings/AppearanceSection';
import DataSyncSection from '../components/features/settings/DataSyncSection';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export default function SettingsScreen({ navigation }: Props) {

    return (
        <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900">
            <ScrollView className="flex-1" contentContainerStyle={{ padding: 20 }}>
                <Text className="text-3xl font-bold text-slate-900 dark:text-white mb-6">
                    Settings
                </Text>

                <AppearanceSection />
                <DataSyncSection onNavigateChangelog={() => navigation.navigate('Changelog')} />
            </ScrollView>
        </SafeAreaView>
    );
}
