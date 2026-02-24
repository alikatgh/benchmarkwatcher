import React from 'react';
import { View, ViewStyle } from 'react-native';
import { Svg, Path, Circle, Rect } from 'react-native-svg';

export type IconName =
    | 'copy'
    | 'download'
    | 'zoomIn'
    | 'zoomOut'
    | 'search'
    | 'grid'
    | 'list'
    | 'settings'
    | 'back'
    | 'compare'
    | 'close'
    | 'camera'
    | 'check';

interface IconProps {
    name: IconName;
    size?: number;
    color?: string;
    className?: string;
    style?: ViewStyle;
}

export default function Icon({ name, size = 24, color = 'currentColor', className = '', style }: IconProps) {
    const renderPath = () => {
        switch (name) {
            case 'copy':
                return (
                    <>
                        <Path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                        <Path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z" />
                    </>
                );
            case 'download':
                return <Path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />;
            case 'zoomIn':
                return (
                    <>
                        <Path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m-3-3h6" />
                    </>
                );
            case 'zoomOut':
                return (
                    <>
                        <Path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM7 10h6" />
                    </>
                );
            case 'search':
                return (
                    <>
                        <Circle cx="11" cy="11" r="8" />
                        <Path d="M21 21l-4.3-4.3" />
                    </>
                );
            case 'grid':
                return (
                    <>
                        <Rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <Path d="M3 9h18M9 21V9" />
                    </>
                );
            case 'list':
                return <Path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />;
            case 'settings':
                return (
                    <>
                        <Path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                        <Circle cx="12" cy="12" r="3" />
                    </>
                );
            case 'back':
                return <Path d="M19 12H5M12 19l-7-7 7-7" />;
            case 'compare':
                return (
                    <>
                        <Path d="M18 20V10M12 20V4M6 20v-6" />
                    </>
                );
            case 'close':
                return <Path d="M18 6L6 18M6 6l12 12" />;
            case 'camera':
                return (
                    <>
                        <Path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                        <Circle cx="12" cy="13" r="4" />
                    </>
                );
            case 'check':
                return <Path d="M20 6L9 17l-5-5" />;
            default:
                return null;
        }
    };

    return (
        <View style={style} className={className}>
            <Svg
                width={size}
                height={size}
                viewBox="0 0 24 24"
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                {renderPath()}
            </Svg>
        </View>
    );
}
