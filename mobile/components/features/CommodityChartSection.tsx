import React from 'react';
import { View, Text, ActivityIndicator, ScrollView } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import ViewShot from 'react-native-view-shot';

interface CommodityChartSectionProps {
    loading: boolean;
    error: string | null;
    chartData: any;
    chartWidth: number;
    autoFitBounds: boolean;
    hideGrid: boolean;
    fillArea: boolean;
    smoothCurve: boolean;
    changeColor: string;
    selectedPoint: any;
    setSelectedPoint: (point: any) => void;
    chartRef: React.RefObject<ViewShot | null>;
}

export default function CommodityChartSection({
    loading, error, chartData, chartWidth,
    autoFitBounds, hideGrid, fillArea, smoothCurve,
    changeColor, selectedPoint, setSelectedPoint, chartRef
}: CommodityChartSectionProps) {
    return (
        <View className="mb-6">
            {loading ? (
                <View className="h-[220px] items-center justify-center">
                    <ActivityIndicator size="large" color="#3b82f6" />
                </View>
            ) : error || !chartData ? (
                <View className="h-[220px] items-center justify-center bg-slate-50 dark:bg-slate-800 mx-5 rounded-xl border border-slate-100 dark:border-slate-700">
                    <Text className="text-slate-500 dark:text-slate-400">No chart data available</Text>
                </View>
            ) : (
                <ViewShot ref={chartRef} options={{ format: 'png', quality: 1.0 }} style={{ backgroundColor: '#fff' }}>
                    <ScrollView horizontal={true} showsHorizontalScrollIndicator={false}>
                        <View>
                            <LineChart
                                data={chartData}
                                width={chartWidth}
                                height={260}
                                fromZero={!autoFitBounds}
                                withDots={true}
                                withInnerLines={!hideGrid}
                                withOuterLines={false}
                                withVerticalLines={false}
                                withHorizontalLines={!hideGrid}
                                withShadow={fillArea}
                                onDataPointClick={({ value, getColor, index, x, y }) => {
                                    setSelectedPoint({ index, value, x, y, date: chartData.labels[index] });
                                }}
                                chartConfig={{
                                    backgroundColor: 'transparent',
                                    backgroundGradientFrom: 'transparent',
                                    backgroundGradientFromOpacity: 0,
                                    backgroundGradientTo: 'transparent',
                                    backgroundGradientToOpacity: 0,
                                    decimalPlaces: 2,
                                    color: (opacity = 1) => `rgba(148, 163, 184, ${opacity})`, // Slate 400 for grid lines
                                    labelColor: (opacity = 1) => `rgba(100, 116, 139, ${opacity})`, // Slate 500 for text
                                    style: {
                                        borderRadius: 16
                                    },
                                    propsForDots: {
                                        r: "4",
                                        strokeWidth: "2",
                                        stroke: changeColor.includes('emerald') ? '#10b981' : '#f43f5e'
                                    },
                                    propsForBackgroundLines: {
                                        strokeDasharray: '4',
                                        strokeWidth: 1,
                                        stroke: 'rgba(148, 163, 184, 0.2)',
                                    },
                                }}
                                bezier={smoothCurve}
                                style={{
                                    marginVertical: 8,
                                }}
                            />
                            {selectedPoint && (
                                <View
                                    style={{
                                        position: 'absolute',
                                        left: Math.max(0, Math.min(selectedPoint.x - 40, chartWidth - 80)),
                                        top: selectedPoint.y - 50,
                                    }}
                                    className="bg-slate-900 dark:bg-slate-100 px-3 py-2 rounded-lg items-center shadow-lg"
                                >
                                    <Text className="text-white dark:text-slate-900 font-bold text-sm">
                                        {selectedPoint.value.toFixed(2)}
                                    </Text>
                                    <Text className="text-slate-300 dark:text-slate-600 font-medium text-[10px]">
                                        {selectedPoint.date}
                                    </Text>
                                </View>
                            )}
                        </View>
                    </ScrollView>
                </ViewShot>
            )}
        </View>
    );
}
