import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import CompactCommodityRow from '../components/CompactCommodityRow';
import { SettingsContext } from '../context/SettingsContext';
import { Commodity } from '../types/commodity';

describe('CompactCommodityRow', () => {
    const mockCommodity: Commodity = {
        id: 'silver',
        name: 'Silver',
        category: 'Metals',
        price: 24.50,
        change: -0.5,
        change_percent: -2.0,
        currency: 'USD',
        unit: 'oz',
        date: '2023-11-20'
    };

    const mockOnPress = jest.fn();

    const mockContext = {
        showCategory: true,
        showChangePercent: true,
        showChangeAbs: true,
        showDate: true,
        showUnit: true,
        fontScale: 'medium' as const,
        density: 'compact' as const,
        getMarketColors: jest.fn().mockReturnValue({
            textColor: 'text-rose-500',
            bgColor: 'bg-rose-500/10'
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
        setDensity: jest.fn()
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders correctly and handles press', () => {
        const { getByText } = render(
            <SettingsContext.Provider value={mockContext}>
                <CompactCommodityRow commodity={mockCommodity} onPress={mockOnPress} />
            </SettingsContext.Provider>
        );

        expect(getByText('Silver')).toBeTruthy();
        expect(getByText('24.50')).toBeTruthy();
        expect(getByText('Metals')).toBeTruthy();

        fireEvent.press(getByText('Silver'));
        expect(mockOnPress).toHaveBeenCalledWith(mockCommodity);
    });

    it('hides columns when their display setting is false', () => {
        const hiddenContext = {
            ...mockContext,
            showUnit: false,
            showChangePercent: false
        };

        const { queryByText } = render(
            <SettingsContext.Provider value={hiddenContext}>
                <CompactCommodityRow commodity={mockCommodity} onPress={mockOnPress} />
            </SettingsContext.Provider>
        );

        expect(queryByText('USD / oz')).toBeNull(); // Unit hidden
        expect(queryByText('-2.00%')).toBeNull(); // % Change hidden
        expect(queryByText('-0.5')).toBeTruthy(); // Abs change still visible
    });
});
