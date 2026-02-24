import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Switch, Modal } from 'react-native';

interface GridSettingsModalProps {
    visible: boolean;
    onClose: () => void;
    showCategory: boolean;
    setShowCategory: (v: boolean) => void;
    showChangePercent: boolean;
    setShowChangePercent: (v: boolean) => void;
    showChangeAbs: boolean;
    setShowChangeAbs: (v: boolean) => void;
    showDate: boolean;
    setShowDate: (v: boolean) => void;
    showUnit: boolean;
    setShowUnit: (v: boolean) => void;
    fontScale: 'small' | 'medium' | 'large';
    setFontScale: (v: 'small' | 'medium' | 'large') => void;
    density: 'compact' | 'cozy' | 'roomy';
    setDensity: (v: 'compact' | 'cozy' | 'roomy') => void;
}

export default function GridSettingsModal({
    visible, onClose,
    showCategory, setShowCategory,
    showChangePercent, setShowChangePercent,
    showChangeAbs, setShowChangeAbs,
    showDate, setShowDate,
    showUnit, setShowUnit,
    fontScale, setFontScale,
    density, setDensity,
}: GridSettingsModalProps) {
    return (
        <Modal
            animationType="slide"
            transparent={true}
            visible={visible}
            onRequestClose={onClose}
        >
            <View className="flex-1 justify-end bg-black/50">
                <View className="bg-white dark:bg-slate-900 rounded-t-3xl pt-5 pb-8 px-6 max-h-[80%]">
                    <View className="flex-row justify-between items-center mb-6">
                        <Text className="text-xl font-bold text-slate-900 dark:text-white">Grid Layout & Columns</Text>
                        <TouchableOpacity onPress={onClose} className="bg-slate-100 dark:bg-slate-800 p-2 rounded-full">
                            <Text className="text-slate-500 dark:text-slate-400 font-bold">Close</Text>
                        </TouchableOpacity>
                    </View>

                    <ScrollView showsVerticalScrollIndicator={false}>
                        <Text className="text-xs font-bold tracking-wider text-slate-500 uppercase mb-3 mt-2">Column Visibility</Text>
                        <View className="bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden mb-6">
                            {[
                                { label: 'Category Tag', value: showCategory, setter: setShowCategory },
                                { label: '% Change Badge', value: showChangePercent, setter: setShowChangePercent },
                                { label: 'Absolute Change', value: showChangeAbs, setter: setShowChangeAbs },
                                { label: 'Last Update Date', value: showDate, setter: setShowDate },
                                { label: 'Currency / Unit', value: showUnit, setter: setShowUnit },
                            ].map((item, index) => (
                                <View key={item.label} className={`flex-row justify-between items-center p-4 ${index !== 4 ? 'border-b border-slate-200 dark:border-slate-700' : ''}`}>
                                    <Text className="text-slate-700 dark:text-slate-300 font-medium">{item.label}</Text>
                                    <Switch
                                        value={item.value}
                                        onValueChange={item.setter}
                                        trackColor={{ false: '#cbd5e1', true: '#3b82f6' }}
                                        thumbColor="#ffffff"
                                    />
                                </View>
                            ))}
                        </View>

                        <Text className="text-xs font-bold tracking-wider text-slate-500 uppercase mb-3">Font Scale</Text>
                        <View className="flex-row bg-slate-100 dark:bg-slate-800 p-1 rounded-xl mb-6">
                            {(['small', 'medium', 'large'] as const).map((scale) => (
                                <TouchableOpacity
                                    key={scale}
                                    onPress={() => setFontScale(scale)}
                                    className={`flex-1 items-center py-2 rounded-lg ${fontScale === scale ? 'bg-white dark:bg-slate-700 shadow-sm' : ''}`}
                                >
                                    <Text className={`capitalize font-medium ${fontScale === scale ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}>{scale}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <Text className="text-xs font-bold tracking-wider text-slate-500 uppercase mb-3">Layout Density</Text>
                        <View className="flex-row bg-slate-100 dark:bg-slate-800 p-1 rounded-xl mb-8">
                            {(['compact', 'cozy', 'roomy'] as const).map((dens) => (
                                <TouchableOpacity
                                    key={dens}
                                    onPress={() => setDensity(dens)}
                                    className={`flex-1 items-center py-2 rounded-lg ${density === dens ? 'bg-white dark:bg-slate-700 shadow-sm' : ''}`}
                                >
                                    <Text className={`capitalize font-medium ${density === dens ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}>{dens}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}
