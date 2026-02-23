import React from 'react';
import { View, Text, ViewStyle } from 'react-native';

interface BadgeProps {
    label: string;
    variant?: 'default' | 'success' | 'danger' | 'warning' | 'info';
    className?: string;
    textClassName?: string;
    style?: ViewStyle;
}

export default function Badge({
    label,
    variant = 'default',
    className = '',
    textClassName = '',
    style
}: BadgeProps) {
    let baseClassName = 'py-1 px-2.5 rounded-full';
    let baseTextClassName = 'text-xs font-bold text-white';

    switch (variant) {
        case 'success':
            baseClassName += ' bg-emerald-500';
            break;
        case 'danger':
            baseClassName += ' bg-rose-500';
            break;
        case 'warning':
            baseClassName += ' bg-amber-500';
            break;
        case 'info':
            baseClassName += ' bg-blue-500';
            break;
        case 'default':
        default:
            baseClassName += ' bg-slate-500';
            break;
    }

    return (
        <View className={`${baseClassName} ${className}`} style={style}>
            <Text className={`${baseTextClassName} ${textClassName}`}>{label}</Text>
        </View>
    );
}
