import React from 'react';
import { View, Text, Modal, TextInput, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../ui/Icon';
import IconButton from '../ui/IconButton';
import CompactCommodityRow from '../CompactCommodityRow';
import { Commodity } from '../../types/commodity';

interface SearchModalProps {
    visible: boolean;
    onClose: () => void;
    data: Commodity[];
    navigation: any;
    searchQuery: string;
    setSearchQuery: (v: string) => void;
}

export default function SearchModal({ visible, onClose, data, navigation, searchQuery, setSearchQuery }: SearchModalProps) {
    const handleClose = () => {
        onClose();
        setSearchQuery('');
    };

    const filtered = data.filter(c =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.category.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <Modal
            animationType="slide"
            transparent={false}
            visible={visible}
            onRequestClose={handleClose}
        >
            <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900">
                <View className="px-4 py-4 flex-row items-center border-b border-slate-200 dark:border-slate-800">
                    <IconButton
                        icon="back"
                        onPress={handleClose}
                        variant="ghost"
                        className="mr-1"
                        iconClassName="text-slate-500 dark:text-slate-400"
                    />
                    <View className="flex-1 flex-row items-center bg-slate-200 dark:bg-slate-800 rounded-xl px-4 py-2">
                        <Icon name="search" size={18} className="text-slate-500 dark:text-slate-400 mr-2" />
                        <TextInput
                            className="flex-1 text-slate-900 dark:text-white text-base"
                            placeholder="Search commodities..."
                            placeholderTextColor="#94a3b8"
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            autoFocus
                            clearButtonMode="while-editing"
                        />
                    </View>
                </View>

                <FlatList
                    data={filtered}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={{ paddingTop: 12, paddingBottom: 20 }}
                    keyboardShouldPersistTaps="handled"
                    ListEmptyComponent={
                        <View className="flex-1 items-center justify-center pt-10">
                            <Text className="text-slate-500 text-base">No commodities found matching "{searchQuery}"</Text>
                        </View>
                    }
                    renderItem={({ item }) => (
                        <CompactCommodityRow
                            commodity={item}
                            onPress={(commodity) => {
                                onClose();
                                navigation.navigate('CommodityDetail', { commodity });
                            }}
                        />
                    )}
                />
            </SafeAreaView>
        </Modal>
    );
}
