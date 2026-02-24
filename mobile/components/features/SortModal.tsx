import React from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';

interface SortModalProps {
    visible: boolean;
    onClose: () => void;
    sortMethod: string;
    setSortMethod: (v: string) => void;
    sortOrder: string;
    setSortOrder: (v: string) => void;
}

const SORT_OPTIONS = [
    { label: 'Name (A-Z)', method: 'name', order: 'asc' },
    { label: 'Name (Z-A)', method: 'name', order: 'desc' },
    { label: 'Highest % Gain', method: 'change_percent', order: 'desc' },
    { label: 'Highest % Loss', method: 'change_percent', order: 'asc' },
    { label: 'Highest Price', method: 'price', order: 'desc' },
    { label: 'Lowest Price', method: 'price', order: 'asc' },
    { label: 'Most Volatile (30d)', method: 'volatility', order: 'desc' },
    { label: 'Least Volatile (30d)', method: 'volatility', order: 'asc' },
] as const;

export default function SortModal({ visible, onClose, sortMethod, setSortMethod, sortOrder, setSortOrder }: SortModalProps) {
    return (
        <Modal
            animationType="fade"
            transparent={true}
            visible={visible}
            onRequestClose={onClose}
        >
            <TouchableOpacity
                className="flex-1 justify-center bg-black/50 p-6"
                activeOpacity={1}
                onPressOut={onClose}
            >
                <View className="bg-white dark:bg-slate-900 rounded-2xl overflow-hidden p-2">
                    <Text className="text-lg font-bold text-slate-900 dark:text-white mb-2 px-4 pt-3 pb-2 text-center border-b border-slate-100 dark:border-slate-800">
                        Sort Commodities
                    </Text>
                    {SORT_OPTIONS.map((option) => {
                        const isActive = sortMethod === option.method && sortOrder === option.order;
                        return (
                            <TouchableOpacity
                                key={option.label}
                                onPress={() => {
                                    setSortMethod(option.method);
                                    setSortOrder(option.order);
                                    onClose();
                                }}
                                className={`py-3 px-4 rounded-xl mb-1 ${isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                            >
                                <Text className={`text-center font-medium ${isActive ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-slate-700 dark:text-slate-300'}`}>
                                    {option.label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            </TouchableOpacity>
        </Modal>
    );
}
