import React from 'react';
import { TouchableOpacity, StyleProp, ViewStyle, Text } from 'react-native';
import Icon, { IconName } from './Icon';

interface IconButtonProps {
    icon: IconName;
    onPress: () => void;
    size?: number;
    color?: string; // Hex color for the icon stroke, defaults to currentColor via external class styling mapping 
    variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
    className?: string; // Optional parent container classes
    iconClassName?: string; // Optional classes passed to the Icon directly (e.g. text-blue-500)
    style?: StyleProp<ViewStyle>;
    label?: string; // Optional text label next to icon
    ariaLabel?: string;
}

export default function IconButton({
    icon,
    onPress,
    size = 20,
    color = 'currentColor',
    variant = 'secondary',
    className = '',
    iconClassName = '',
    style,
    label,
    ariaLabel
}: IconButtonProps) {
    let baseContainerClass = 'flex-row items-center justify-center p-2 rounded-full';
    let labelClass = 'text-xs font-medium ml-1.5';

    switch (variant) {
        case 'primary':
            baseContainerClass = 'flex-row items-center justify-center px-4 py-2.5 rounded-xl bg-blue-500';
            labelClass = 'text-sm font-bold text-white ml-2';
            break;
        case 'secondary':
            baseContainerClass = 'flex-row items-center justify-center p-3 rounded-full bg-slate-100 dark:bg-slate-800';
            break;
        case 'outline':
            baseContainerClass = 'flex-row items-center justify-center px-3 py-1.5 rounded-lg border bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700';
            break;
        case 'ghost':
            baseContainerClass = 'flex-row items-center justify-center p-2';
            break;
    }

    return (
        <TouchableOpacity
            onPress={onPress}
            className={`${baseContainerClass} ${className}`}
            style={style}
            accessibilityRole="button"
            accessibilityLabel={ariaLabel || label || icon}
        >
            <Icon name={icon} size={size} color={color} className={iconClassName} />
            {label && (
                <Text className={labelClass}>{label}</Text>
            )}
        </TouchableOpacity>
    );
}
