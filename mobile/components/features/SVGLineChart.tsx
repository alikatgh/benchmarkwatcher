import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Path, Line, Circle, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';

const PAD = { top: 20, right: 16, bottom: 40, left: 56 };

export interface ChartPoint {
    value: number;
    label: string; // x-axis label (empty string = skip)
    date: string;  // full date for tooltip
}

export interface SelectedChartPoint {
    index: number;
    value: number;
    x: number; // SVG coordinate
    y: number; // SVG coordinate
    date: string;
}

interface SVGLineChartProps {
    data: ChartPoint[];
    width: number;
    height?: number;
    color: string;          // RGB values string e.g. "16, 185, 129"
    fillArea?: boolean;
    hideGrid?: boolean;
    smoothCurve?: boolean;
    autoFitBounds?: boolean;
    selectedPoint?: SelectedChartPoint | null;
    onSelectPoint?: (pt: SelectedChartPoint | null) => void;
}

function formatYLabel(v: number): string {
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    if (abs >= 100) return v.toFixed(0);
    if (abs >= 10) return v.toFixed(1);
    return v.toFixed(2);
}

function niceTicks(min: number, max: number, count = 4): number[] {
    const step = (max - min) / count;
    return Array.from({ length: count + 1 }, (_, i) => min + i * step);
}

function buildPath(pts: { x: number; y: number }[], smooth: boolean): string {
    if (pts.length === 0) return '';
    if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;

    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;

    if (!smooth) {
        for (let i = 1; i < pts.length; i++) {
            d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
        }
        return d;
    }

    // Catmull-Rom → Cubic Bezier
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(i - 1, 0)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(i + 2, pts.length - 1)];

        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;

        d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
}

export default function SVGLineChart({
    data,
    width,
    height = 260,
    color,
    fillArea = false,
    hideGrid = false,
    smoothCurve = true,
    autoFitBounds = true,
    selectedPoint,
    onSelectPoint,
}: SVGLineChartProps) {
    if (!data || data.length === 0) return null;

    const innerW = width - PAD.left - PAD.right;
    const innerH = height - PAD.top - PAD.bottom;
    const chartBottom = PAD.top + innerH;

    const values = data.map(d => d.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const range = rawMax - rawMin;
    const pad = range === 0 ? (Math.abs(rawMax) * 0.1 || 1) : range * 0.08;

    const yMin = autoFitBounds ? rawMin - pad : Math.min(0, rawMin - pad);
    const yMax = rawMax + pad;
    const yRange = yMax - yMin;

    const n = data.length;
    const scaleX = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const scaleY = (v: number) => PAD.top + (1 - (v - yMin) / yRange) * innerH;

    const pts = data.map((d, i) => ({ x: scaleX(i), y: scaleY(d.value) }));
    const linePath = buildPath(pts, smoothCurve);

    const fillPath = pts.length > 1
        ? `${linePath} L ${pts[n - 1].x.toFixed(1)} ${chartBottom} L ${pts[0].x.toFixed(1)} ${chartBottom} Z`
        : '';

    const ticks = niceTicks(yMin, yMax, 4);
    const showDots = n <= 60;

    const handlePress = (evt: any) => {
        if (!onSelectPoint || n === 0) return;
        const touchX = evt.nativeEvent.locationX;
        const chartX = Math.max(0, touchX - PAD.left);
        const t = Math.max(0, Math.min(1, chartX / innerW));
        const index = Math.round(t * (n - 1));
        if (selectedPoint?.index === index) {
            onSelectPoint(null);
        } else {
            onSelectPoint({ index, value: data[index].value, date: data[index].date, x: pts[index].x, y: pts[index].y });
        }
    };

    return (
        <View style={{ width, height }}>
            <Svg width={width} height={height}>
                <Defs>
                    <LinearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0" stopColor={`rgb(${color})`} stopOpacity="0.3" />
                        <Stop offset="1" stopColor={`rgb(${color})`} stopOpacity="0.02" />
                    </LinearGradient>
                </Defs>

                {/* Y-axis grid lines + labels */}
                {ticks.map((tick, i) => {
                    const y = scaleY(tick);
                    if (y < PAD.top - 4 || y > chartBottom + 4) return null;
                    return (
                        <React.Fragment key={i}>
                            {!hideGrid && (
                                <Line
                                    x1={PAD.left} y1={y}
                                    x2={PAD.left + innerW} y2={y}
                                    stroke="rgba(148,163,184,0.25)"
                                    strokeWidth={1}
                                    strokeDasharray="4,4"
                                />
                            )}
                            <SvgText
                                x={PAD.left - 6}
                                y={y + 4}
                                textAnchor="end"
                                fontSize={10}
                                fill="rgba(100,116,139,0.8)"
                            >
                                {formatYLabel(tick)}
                            </SvgText>
                        </React.Fragment>
                    );
                })}

                {/* X-axis labels */}
                {data.map((d, i) => {
                    if (!d.label) return null;
                    return (
                        <SvgText
                            key={i}
                            x={pts[i].x}
                            y={chartBottom + 16}
                            textAnchor="middle"
                            fontSize={10}
                            fill="rgba(100,116,139,0.8)"
                        >
                            {d.label}
                        </SvgText>
                    );
                })}

                {/* Fill area */}
                {fillArea && pts.length > 1 && (
                    <Path d={fillPath} fill="url(#fillGrad)" />
                )}

                {/* Line */}
                <Path
                    d={linePath}
                    fill="none"
                    stroke={`rgb(${color})`}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />

                {/* Data point dots */}
                {showDots && pts.map((pt, i) => {
                    const isSelected = selectedPoint?.index === i;
                    return (
                        <Circle
                            key={i}
                            cx={pt.x} cy={pt.y}
                            r={isSelected ? 6 : 3}
                            fill={`rgb(${color})`}
                            stroke={isSelected ? 'white' : 'transparent'}
                            strokeWidth={2}
                            opacity={selectedPoint && !isSelected ? 0.35 : 1}
                        />
                    );
                })}

                {/* Selected point dot when dots are hidden (many points) */}
                {!showDots && selectedPoint && (
                    <Circle
                        cx={pts[selectedPoint.index].x}
                        cy={pts[selectedPoint.index].y}
                        r={6}
                        fill={`rgb(${color})`}
                        stroke="white"
                        strokeWidth={2}
                    />
                )}
            </Svg>

            {/* Touch overlay */}
            <Pressable style={[StyleSheet.absoluteFillObject, { left: PAD.left }]} onPress={handlePress} />

            {/* Tooltip */}
            {selectedPoint && (
                <View
                    style={{
                        position: 'absolute',
                        left: Math.max(PAD.left, Math.min(selectedPoint.x - 40, width - PAD.right - 80)),
                        top: Math.max(PAD.top, selectedPoint.y - 52),
                        backgroundColor: 'rgba(15,23,42,0.92)',
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 8,
                    }}
                    pointerEvents="none"
                >
                    <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>
                        {formatYLabel(selectedPoint.value)}
                    </Text>
                    <Text style={{ color: 'rgba(203,213,225,0.9)', fontSize: 10, marginTop: 1 }}>
                        {selectedPoint.date}
                    </Text>
                </View>
            )}
        </View>
    );
}
