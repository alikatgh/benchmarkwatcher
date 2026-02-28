import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import Svg, { Path, Line, Circle, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';
import { ComparisonSeries } from '../../types/commodity';

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
    // Multi-series comparison
    comparisons?: ComparisonSeries[];
    viewMode?: 'price' | 'percent';
    primaryName?: string;
    // Configurable appearance (from chart settings)
    lineColor?: string;       // RGB override for the primary line
    fillColor?: string;       // RGB override for the fill
    fillOpacity?: number;
    gridColor?: string;
    currency?: string;
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
    comparisons = [],
    viewMode = 'price',
    primaryName,
    lineColor,
    fillColor,
    fillOpacity,
    gridColor,
    currency,
}: SVGLineChartProps) {
    if (!data || data.length === 0) return null;

    const activeLineColor = lineColor || color;
    const activeFillColor = fillColor || color;
    const activeFillOpacity = fillOpacity ?? 0.3;
    const activeGridColor = gridColor || 'rgba(148,163,184,0.25)';

    const hasComparisons = comparisons.length > 0;
    const chartHeight = hasComparisons ? height + 30 : height; // extra for legend
    const innerW = width - PAD.left - PAD.right;
    const innerH = height - PAD.top - PAD.bottom;
    const chartBottom = PAD.top + innerH;

    // Build date→index map from primary series for alignment
    const dateMap = new Map<string, number>();
    data.forEach((d, i) => dateMap.set(d.date, i));

    // Primary series scaling
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

    // Build comparison series paths
    const comparisonPaths = comparisons.map(comp => {
        // Align comparison history to primary dates
        const priceMap = new Map<string, number>();
        comp.history.forEach(h => priceMap.set(h.date, h.price));

        const alignedValues: { index: number; value: number }[] = [];
        data.forEach((d, i) => {
            const price = priceMap.get(d.date);
            if (price !== undefined) {
                let val = price;
                if (viewMode === 'percent') {
                    const firstPrice = comp.history[0]?.price;
                    if (firstPrice && firstPrice !== 0) {
                        val = ((price - firstPrice) / firstPrice) * 100;
                    }
                }
                alignedValues.push({ index: i, value: val });
            }
        });

        if (alignedValues.length === 0) return null;

        // Scale comparison values to chart area
        // In percent mode, use same Y scale as primary. In price mode, use own scale (right Y-axis)
        let compPts: { x: number; y: number }[];
        if (viewMode === 'percent') {
            compPts = alignedValues.map(av => ({
                x: scaleX(av.index),
                y: scaleY(av.value),
            }));
        } else {
            const compValues = alignedValues.map(av => av.value);
            const cMin = Math.min(...compValues);
            const cMax = Math.max(...compValues);
            const cRange = cMax - cMin;
            const cPad = cRange === 0 ? (Math.abs(cMax) * 0.1 || 1) : cRange * 0.08;
            const cyMin = cMin - cPad;
            const cyMax = cMax + cPad;
            const cyRange = cyMax - cyMin;
            compPts = alignedValues.map(av => ({
                x: scaleX(av.index),
                y: PAD.top + (1 - (av.value - cyMin) / cyRange) * innerH,
            }));
        }

        return {
            ...comp,
            path: buildPath(compPts, smoothCurve),
            alignedValues,
            compPts,
        };
    }).filter(Boolean);

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

    // Get comparison values at selected index
    const getComparisonValueAtIndex = (comp: ComparisonSeries, index: number): number | null => {
        const date = data[index]?.date;
        if (!date) return null;
        const point = comp.history.find(h => h.date === date);
        if (!point) return null;
        if (viewMode === 'percent') {
            const first = comp.history[0]?.price;
            if (!first || first === 0) return null;
            return ((point.price - first) / first) * 100;
        }
        return point.price;
    };

    const formatDateDisplay = (rawDate?: string): string => {
        if (!rawDate) return '';
        const parsed = new Date(rawDate);
        if (Number.isNaN(parsed.getTime())) return rawDate;
        return parsed.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    };

    const formatValueDisplay = (value: number): string => {
        if (viewMode === 'percent') return `${value.toFixed(2)}%`;
        const valueLabel = formatYLabel(value);
        return currency ? `${valueLabel} ${currency}` : valueLabel;
    };

    const selectedPrimaryDelta = selectedPoint ? (() => {
        const idx = selectedPoint.index;
        if (idx <= 0) return null;
        const previous = data[idx - 1]?.value;
        const current = data[idx]?.value;
        if (previous === undefined || current === undefined) return null;
        const change = current - previous;
        const changePct = previous !== 0 ? (change / previous) * 100 : null;
        return { change, changePct };
    })() : null;

    // Selection info bar data
    const selectionInfo = selectedPoint ? (() => {
        const idx = selectedPoint.index;
        const prevIdx = idx > 0 ? idx - 1 : null;
        const currentVal = data[idx].value;
        const prevVal = prevIdx !== null ? data[prevIdx].value : null;
        const change = prevVal !== null ? currentVal - prevVal : null;
        const changePct = prevVal !== null && prevVal !== 0 ? (change! / prevVal) * 100 : null;

        const primary = {
            name: primaryName || 'Primary',
            color: `rgb(${activeLineColor})`,
            date: data[idx].date,
            value: currentVal,
            change,
            changePct,
        };

        const compValues = comparisons.map(comp => {
            const val = getComparisonValueAtIndex(comp, idx);
            const prevCompVal = prevIdx !== null ? getComparisonValueAtIndex(comp, prevIdx) : null;
            const compChange = val !== null && prevCompVal !== null ? val - prevCompVal : null;
            const compChangePct = prevCompVal !== null && prevCompVal !== 0 && compChange !== null ? (compChange / prevCompVal) * 100 : null;
            return {
                name: comp.name,
                color: comp.color,
                value: val,
                change: compChange,
                changePct: compChangePct,
            };
        });

        return { primary, comparisons: compValues };
    })() : null;

    return (
        <View style={{ width }}>
            <View style={{ width, height: chartHeight }}>
                <Svg width={width} height={chartHeight}>
                    <Defs>
                        <LinearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1">
                            <Stop offset="0" stopColor={`rgb(${activeFillColor})`} stopOpacity={String(activeFillOpacity)} />
                            <Stop offset="1" stopColor={`rgb(${activeFillColor})`} stopOpacity="0.02" />
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
                                        stroke={activeGridColor}
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

                    {/* Primary line */}
                    <Path
                        d={linePath}
                        fill="none"
                        stroke={`rgb(${activeLineColor})`}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />

                    {/* Comparison lines */}
                    {comparisonPaths.map((comp) => comp && (
                        <Path
                            key={comp.id}
                            d={comp.path}
                            fill="none"
                            stroke={comp.color}
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            opacity={0.85}
                        />
                    ))}

                    {/* Data point dots */}
                    {showDots && pts.map((pt, i) => {
                        const isSelected = selectedPoint?.index === i;
                        return (
                            <Circle
                                key={i}
                                cx={pt.x} cy={pt.y}
                                r={isSelected ? 6 : 3}
                                fill={`rgb(${activeLineColor})`}
                                stroke={isSelected ? 'white' : 'transparent'}
                                strokeWidth={2}
                                opacity={selectedPoint && !isSelected ? 0.35 : 1}
                            />
                        );
                    })}

                    {/* Selected point dot when dots are hidden */}
                    {!showDots && selectedPoint && (
                        <Circle
                            cx={pts[selectedPoint.index].x}
                            cy={pts[selectedPoint.index].y}
                            r={6}
                            fill={`rgb(${activeLineColor})`}
                            stroke="white"
                            strokeWidth={2}
                        />
                    )}

                    {/* Selected vertical line */}
                    {selectedPoint && (
                        <Line
                            x1={pts[selectedPoint.index].x} y1={PAD.top}
                            x2={pts[selectedPoint.index].x} y2={chartBottom}
                            stroke="rgba(148,163,184,0.4)"
                            strokeWidth={1}
                            strokeDasharray="3,3"
                        />
                    )}

                    {/* Legend row for comparisons */}
                    {hasComparisons && (
                        <>
                            {/* Primary legend */}
                            <Circle cx={PAD.left + 6} cy={height + 10} r={4} fill={`rgb(${activeLineColor})`} />
                            <SvgText x={PAD.left + 14} y={height + 14} fontSize={9} fill="rgba(100,116,139,0.8)">
                                {primaryName || 'Primary'}
                            </SvgText>
                            {/* Comparison legends */}
                            {comparisons.map((comp, i) => {
                                const offsetX = PAD.left + 14 + (primaryName || 'Primary').length * 5.5 + 16 + i * 100;
                                return (
                                    <React.Fragment key={comp.id}>
                                        <Circle cx={offsetX} cy={height + 10} r={4} fill={comp.color} />
                                        <SvgText x={offsetX + 8} y={height + 14} fontSize={9} fill="rgba(100,116,139,0.8)">
                                            {comp.name.length > 12 ? comp.name.substring(0, 12) + '...' : comp.name}
                                        </SvgText>
                                    </React.Fragment>
                                );
                            })}
                        </>
                    )}
                </Svg>

                {/* Touch overlay */}
                <Pressable style={[StyleSheet.absoluteFillObject, { left: PAD.left, top: 0, bottom: hasComparisons ? 30 : 0 }]} onPress={handlePress} />

                {/* Tooltip */}
                {selectedPoint && !selectionInfo && (
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
                            {formatValueDisplay(selectedPoint.value)}
                        </Text>
                        {selectedPrimaryDelta && (
                            <Text
                                style={{
                                    color: selectedPrimaryDelta.change >= 0 ? '#34d399' : '#f87171',
                                    fontSize: 10,
                                    marginTop: 1,
                                }}
                            >
                                {selectedPrimaryDelta.change >= 0 ? '+' : ''}
                                {viewMode === 'percent'
                                    ? `${selectedPrimaryDelta.change.toFixed(2)}pp`
                                    : `${formatYLabel(selectedPrimaryDelta.change)}${currency ? ` ${currency}` : ''}`}
                                {selectedPrimaryDelta.changePct !== null && ` (${selectedPrimaryDelta.changePct >= 0 ? '+' : ''}${selectedPrimaryDelta.changePct.toFixed(1)}%)`}
                            </Text>
                        )}
                        <Text style={{ color: 'rgba(203,213,225,0.9)', fontSize: 10, marginTop: 1 }}>
                            {formatDateDisplay(selectedPoint.date)}
                        </Text>
                    </View>
                )}
            </View>

            {/* Selection info bar */}
            {selectionInfo ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                    <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 16, alignItems: 'center' }}>
                        {/* Primary series info */}
                        <InfoChip
                            color={selectionInfo.primary.color}
                            name={selectionInfo.primary.name}
                            date={selectionInfo.primary.date}
                            value={selectionInfo.primary.value}
                            change={selectionInfo.primary.change}
                            changePct={selectionInfo.primary.changePct}
                            viewMode={viewMode}
                        />
                        {/* Comparison series info */}
                        {selectionInfo.comparisons.map((comp, i) => (
                            <InfoChip
                                key={i}
                                color={comp.color}
                                name={comp.name}
                                value={comp.value}
                                change={comp.change}
                                changePct={comp.changePct}
                                viewMode={viewMode}
                            />
                        ))}
                    </View>
                </ScrollView>
            ) : (
                <View style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
                    <Text style={{ fontSize: 11, color: 'rgba(148,163,184,0.7)', textAlign: 'center' }}>
                        Tap chart to inspect a point
                    </Text>
                </View>
            )}
        </View>
    );
}

function InfoChip({ color, name, date, value, change, changePct, viewMode }: {
    color: string;
    name: string;
    date?: string;
    value: number | null;
    change: number | null;
    changePct: number | null;
    viewMode: string;
}) {
    if (value === null) return null;

    const isPositive = (change ?? 0) >= 0;
    const changeColor = isPositive ? '#10b981' : '#ef4444';

    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
            <View>
                <Text style={{ fontSize: 10, color: 'rgba(148,163,184,0.9)' }} numberOfLines={1}>
                    {name}{date ? ` \u2022 ${date}` : ''}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#1e293b' }}>
                        {viewMode === 'percent' ? `${value.toFixed(2)}%` : formatYLabel(value)}
                    </Text>
                    {change !== null && (
                        <Text style={{ fontSize: 10, color: changeColor, fontWeight: '600' }}>
                            {isPositive ? '+' : ''}{viewMode === 'percent' ? `${change.toFixed(2)}pp` : formatYLabel(change)}
                            {changePct !== null && ` (${isPositive ? '+' : ''}${changePct.toFixed(1)}%)`}
                        </Text>
                    )}
                </View>
            </View>
        </View>
    );
}
