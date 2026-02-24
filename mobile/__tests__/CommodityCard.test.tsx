import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import CommodityCard from '../components/CommodityCard';
import { SettingsContext } from '../context/SettingsContext';
import { Commodity } from '../types/commodity';

describe('CommodityCard', () => {
    const mockCommodity: Commodity = {
        id: 'gold',
        name: 'Gold',
        category: 'Precious',
        price: 1850.50,
        change: 12.5,
        change_percent: 0.68,
        currency: 'USD',
        unit: 'oz',
        date: '2023-10-25'
    };

    const mockOnPress = jest.fn();

    const mockContext = {
        showCategory: true,
        showChangePercent: true,
        showChangeAbs: true,
        showDate: true,
        showUnit: true,
        fontScale: 'medium' as const,
        density: 'cozy' as const,
        getMarketColors: jest.fn().mockReturnValue({
            textColor: 'text-emerald-500',
            bgColor: 'bg-emerald-500/10'
        }),
        isDarkMode: false,
        setIsDarkMode: jest.fn(),
        themeFlavor: 'standard' as const,
        setThemeFlavor: jest.fn(),
        marketTheme: 'western' as const,
        setMarketTheme: jest.fn(),
        syncEnabled: false,
        setSyncEnabled: jest.fn(),
        forceSync: jest.fn(),
        syncTrigger: 0,
        setShowCategory: jest.fn(),
        setShowChangePercent: jest.fn(),
        setShowChangeAbs: jest.fn(),
        setShowDate: jest.fn(),
        setShowUnit: jest.fn(),
        setFontScale: jest.fn(),
        setDensity: jest.fn(),
        chartSettings: {
            chartTheme: 'default' as const,
            chartLineColor: '59, 130, 246',
            chartFillColor: '59, 130, 246',
            chartFillOpacity: 0.3,
            chartFillEnabled: false,
            chartGridVisible: true,
            chartGridColor: 'rgba(148,163,184,0.25)',
            chartAnimationEnabled: true,
            chartLineTension: 0.4,
            chartSmoothCurve: true,
            chartAutoFitBounds: true,
        },
        updateChartSettings: jest.fn(),
        resetChartSettings: jest.fn()
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders basic commodity information', () => {
        const { getByText } = render(
            <SettingsContext.Provider value={mockContext}>
                <CommodityCard commodity={mockCommodity} onPress={mockOnPress} />
            </SettingsContext.Provider>
        );

        expect(getByText('Gold')).toBeTruthy();
        expect(getByText('1,850.50')).toBeTruthy();
        expect(getByText(/Precious/)).toBeTruthy();
        expect(getByText(/\+12\.5/)).toBeTruthy(); // Absolute change
        expect(getByText(/\+0\.68%/)).toBeTruthy(); // % change
        expect(getByText('2023-10-25')).toBeTruthy();
        expect(getByText(/USD/)).toBeTruthy();
    });

    it('triggers onPress with correct commodity when pressed', () => {
        const { getByText } = render(
            <SettingsContext.Provider value={mockContext}>
                <CommodityCard commodity={mockCommodity} onPress={mockOnPress} />
            </SettingsContext.Provider>
        );

        fireEvent.press(getByText('Gold'));
        expect(mockOnPress).toHaveBeenCalledWith(mockCommodity);
        expect(mockOnPress).toHaveBeenCalledTimes(1);
    });

    it('hides fields when disabled in SettingsContext', () => {
        const hiddenContext = {
            ...mockContext,
            showCategory: false,
            showChangeAbs: false,
            showDate: false
        };

        const { queryByText } = render(
            <SettingsContext.Provider value={hiddenContext}>
                <CommodityCard commodity={mockCommodity} onPress={mockOnPress} />
            </SettingsContext.Provider>
        );

        expect(queryByText('Precious')).toBeNull(); // Category hidden
        expect(queryByText('+12.5')).toBeNull();    // Abs change hidden
        expect(queryByText('2023-10-25')).toBeNull(); // Date hidden
    });
});
