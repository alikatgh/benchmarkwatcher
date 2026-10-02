import React from 'react';
import { scaleLinear } from 'd3-scale';
import { line } from 'd3-shape';
import Svg, { Path, Circle } from 'react-native-svg';
import { View } from 'react-native';

interface Props {
    data: number[];
    width?: number;
    height?: number;
    color: string;
}

export default function MiniSparkline({ data, width = 64, height = 24, color }: Props) {
    if (!data || data.length < 2) return <View style={{ width, height }} />;

    const values = data.filter(Number.isFinite);
    if (!values.length) return <View style={{width, height}} />;
    const min = Math.min(...values), max = Math.max(...values), padding = min === max ? Math.max(Math.abs(min) * .05, 1) : 0;
    const dotR = 1.5;
    const x = scaleLinear().domain([0, data.length - 1]).range([2, width - 4]);
    const y = scaleLinear().domain([min - padding, max + padding]).range([height - 2, 2]);
    const pts = data.map((value, i) => ({x: x(i), y: y(value)}));
    const d = line<{x: number; y: number}>().defined(p => Number.isFinite(p.y)).x(p => p.x).y(p => p.y)(pts) || '';

    const last = pts.filter(p => Number.isFinite(p.y)).at(-1)!;

    return (
        <View accessible={false} style={{ width, height }}>
            <Svg width={width} height={height} accessible={false}>
                <Path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                <Circle cx={last.x} cy={last.y} r={dotR} fill={color} />
            </Svg>
        </View>
    );
}
