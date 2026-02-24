import React, { useContext } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, Switch } from 'react-native';
import Slider from '@react-native-community/slider';
import { SettingsContext } from '../../context/SettingsContext';
import { ChartThemeName, ChartThemePreset } from '../../types/settings';
import Icon from '../ui/Icon';

const CHART_THEME_PRESETS: ChartThemePreset[] = [
    { name: 'default', label: 'Default', lineColor: '59, 130, 246', fillColor: '59, 130, 246', fillOpacity: 0.3, gridColor: 'rgba(148,163,184,0.25)', backgroundColor: '#ffffff' },
    { name: 'ocean', label: 'Ocean', lineColor: '14, 165, 233', fillColor: '14, 165, 233', fillOpacity: 0.2, gridColor: 'rgba(14,165,233,0.15)', backgroundColor: '#f0f9ff' },
    { name: 'sunset', label: 'Sunset', lineColor: '249, 115, 22', fillColor: '249, 115, 22', fillOpacity: 0.25, gridColor: 'rgba(249,115,22,0.12)', backgroundColor: '#fff7ed' },
    { name: 'forest', label: 'Forest', lineColor: '22, 163, 74', fillColor: '22, 163, 74', fillOpacity: 0.2, gridColor: 'rgba(22,163,74,0.12)', backgroundColor: '#f0fdf4' },
    { name: 'midnight', label: 'Midnight', lineColor: '99, 102, 241', fillColor: '99, 102, 241', fillOpacity: 0.25, gridColor: 'rgba(99,102,241,0.15)', backgroundColor: '#1e1b4b' },
    { name: 'neon', label: 'Neon', lineColor: '34, 211, 238', fillColor: '34, 211, 238', fillOpacity: 0.2, gridColor: 'rgba(34,211,238,0.15)', backgroundColor: '#0f172a' },
    { name: 'pastel', label: 'Pastel', lineColor: '168, 85, 247', fillColor: '196, 181, 253', fillOpacity: 0.35, gridColor: 'rgba(168,85,247,0.1)', backgroundColor: '#faf5ff' },
    { name: 'monochrome', label: 'Mono', lineColor: '71, 85, 105', fillColor: '71, 85, 105', fillOpacity: 0.15, gridColor: 'rgba(71,85,105,0.15)', backgroundColor: '#f8fafc' },
];

const COLOR_SWATCHES = [
    '59, 130, 246',   // blue
    '14, 165, 233',   // sky
    '6, 182, 212',    // cyan
    '20, 184, 166',   // teal
    '16, 185, 129',   // emerald
    '22, 163, 74',    // green
    '132, 204, 22',   // lime
    '245, 158, 11',   // amber
    '249, 115, 22',   // orange
    '239, 68, 68',    // red
    '225, 29, 72',    // rose
    '168, 85, 247',   // purple
    '139, 92, 246',   // violet
    '99, 102, 241',   // indigo
    '71, 85, 105',    // slate
    '15, 23, 42',     // dark
];

interface ChartSettingsModalProps {
    visible: boolean;
    onClose: () => void;
}

export default function ChartSettingsModal({ visible, onClose }: ChartSettingsModalProps) {
    const { chartSettings, updateChartSettings, resetChartSettings, isDarkMode } = useContext(SettingsContext);

    const applyTheme = (preset: ChartThemePreset) => {
        updateChartSettings({
            chartTheme: preset.name,
            chartLineColor: preset.lineColor,
            chartFillColor: preset.fillColor,
            chartFillOpacity: preset.fillOpacity,
            chartGridColor: preset.gridColor,
        });
    };

    const renderColorSwatch = (selectedColor: string, onSelect: (color: string) => void) => (
        <View className="flex-row flex-wrap gap-2 mt-2">
            {COLOR_SWATCHES.map((color) => (
                <TouchableOpacity
                    key={color}
                    onPress={() => onSelect(color)}
                    style={{
                        width: 32, height: 32, borderRadius: 8,
                        backgroundColor: `rgb(${color})`,
                        borderWidth: selectedColor === color ? 3 : 1,
                        borderColor: selectedColor === color ? (isDarkMode ? '#fff' : '#000') : 'rgba(148,163,184,0.3)',
                    }}
                />
            ))}
        </View>
    );

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <View className="flex-1 bg-white dark:bg-slate-900">
                {/* Header */}
                <View className="flex-row items-center justify-between px-5 pt-4 pb-3 border-b border-slate-200 dark:border-slate-700">
                    <Text className="text-lg font-bold text-slate-900 dark:text-white">Chart Settings</Text>
                    <TouchableOpacity onPress={onClose} className="p-2">
                        <Icon name="close" size={20} color={isDarkMode ? '#94a3b8' : '#475569'} />
                    </TouchableOpacity>
                </View>

                <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 40 }}>
                    {/* Theme Presets */}
                    <Text className="text-sm font-bold text-slate-900 dark:text-white mt-5 mb-3">Theme Presets</Text>
                    <View className="flex-row flex-wrap gap-3">
                        {CHART_THEME_PRESETS.map((preset) => (
                            <TouchableOpacity
                                key={preset.name}
                                onPress={() => applyTheme(preset)}
                                className={`rounded-xl border-2 p-1 ${chartSettings.chartTheme === preset.name ? 'border-blue-500' : 'border-slate-200 dark:border-slate-700'}`}
                                style={{ width: '30%', minWidth: 90 }}
                            >
                                <View style={{ backgroundColor: preset.backgroundColor, borderRadius: 8, height: 48, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
                                    {/* Mini preview line */}
                                    <View style={{ width: '70%', height: 3, backgroundColor: `rgb(${preset.lineColor})`, borderRadius: 2 }} />
                                    <View style={{ width: '70%', height: 16, backgroundColor: `rgba(${preset.fillColor}, ${preset.fillOpacity})`, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 }} />
                                </View>
                                <Text className="text-xs font-medium text-center text-slate-700 dark:text-slate-300 mt-1">{preset.label}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* Line Settings */}
                    <Text className="text-sm font-bold text-slate-900 dark:text-white mt-6 mb-3">Line Color</Text>
                    {renderColorSwatch(chartSettings.chartLineColor, (color) => updateChartSettings({ chartLineColor: color, chartTheme: 'default' }))}

                    <Text className="text-sm font-bold text-slate-900 dark:text-white mt-5 mb-2">Smooth Curve</Text>
                    <View className="flex-row items-center justify-between bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3">
                        <Text className="text-sm text-slate-700 dark:text-slate-300">Catmull-Rom interpolation</Text>
                        <Switch
                            value={chartSettings.chartSmoothCurve}
                            onValueChange={(val) => updateChartSettings({ chartSmoothCurve: val })}
                            trackColor={{ false: '#cbd5e1', true: '#3b82f6' }}
                        />
                    </View>

                    {/* Fill Settings */}
                    <Text className="text-sm font-bold text-slate-900 dark:text-white mt-6 mb-2">Fill Area</Text>
                    <View className="flex-row items-center justify-between bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3">
                        <Text className="text-sm text-slate-700 dark:text-slate-300">Show gradient fill below line</Text>
                        <Switch
                            value={chartSettings.chartFillEnabled}
                            onValueChange={(val) => updateChartSettings({ chartFillEnabled: val })}
                            trackColor={{ false: '#cbd5e1', true: '#3b82f6' }}
                        />
                    </View>

                    {chartSettings.chartFillEnabled && (
                        <>
                            <Text className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-3 mb-1">Fill Color</Text>
                            {renderColorSwatch(chartSettings.chartFillColor, (color) => updateChartSettings({ chartFillColor: color }))}

                            <Text className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-4 mb-1">
                                Fill Opacity: {chartSettings.chartFillOpacity.toFixed(2)}
                            </Text>
                            <Slider
                                minimumValue={0.05}
                                maximumValue={0.8}
                                step={0.05}
                                value={chartSettings.chartFillOpacity}
                                onValueChange={(val) => updateChartSettings({ chartFillOpacity: val })}
                                minimumTrackTintColor="#3b82f6"
                                maximumTrackTintColor={isDarkMode ? '#334155' : '#cbd5e1'}
                            />
                        </>
                    )}

                    {/* Grid Settings */}
                    <Text className="text-sm font-bold text-slate-900 dark:text-white mt-6 mb-2">Grid</Text>
                    <View className="flex-row items-center justify-between bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3">
                        <Text className="text-sm text-slate-700 dark:text-slate-300">Show grid lines</Text>
                        <Switch
                            value={chartSettings.chartGridVisible}
                            onValueChange={(val) => updateChartSettings({ chartGridVisible: val })}
                            trackColor={{ false: '#cbd5e1', true: '#3b82f6' }}
                        />
                    </View>

                    {/* Auto-Fit Bounds */}
                    <Text className="text-sm font-bold text-slate-900 dark:text-white mt-6 mb-2">Auto-Fit Bounds</Text>
                    <View className="flex-row items-center justify-between bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3">
                        <Text className="text-sm text-slate-700 dark:text-slate-300">Fit Y-axis to data range</Text>
                        <Switch
                            value={chartSettings.chartAutoFitBounds}
                            onValueChange={(val) => updateChartSettings({ chartAutoFitBounds: val })}
                            trackColor={{ false: '#cbd5e1', true: '#3b82f6' }}
                        />
                    </View>

                    {/* Reset Button */}
                    <TouchableOpacity
                        onPress={resetChartSettings}
                        className="mt-8 py-3 items-center bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700"
                    >
                        <Text className="text-sm font-bold text-slate-500 dark:text-slate-400">Reset to Default</Text>
                    </TouchableOpacity>
                </ScrollView>
            </View>
        </Modal>
    );
}
