import React from 'react';
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

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const pad = 2;
    const dotR = 1.5;
    const drawW = width - pad * 2 - dotR;
    const drawH = height - pad * 2;

    const pts = data.map((v, i) => ({
        x: pad + (i / (data.length - 1)) * drawW,
        y: pad + drawH - ((v - min) / range) * drawH,
    }));

    // Build smooth Catmull-Rom path
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
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

    const last = pts[pts.length - 1];

    return (
        <View accessible={false} style={{ width, height }}>
            <Svg width={width} height={height} accessible={false}>
                <Path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                <Circle cx={last.x} cy={last.y} r={dotR} fill={color} />
            </Svg>
        </View>
    );
}
