import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import CompactCommodityRow from '../components/CompactCommodityRow';
import { SettingsContext } from '../context/SettingsContext';
import { Commodity } from '../types/commodity';
import { createMockSettingsContext } from '../testUtils/settingsContextMock';

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

    let mockContext = { ...createMockSettingsContext(), density: 'compact' as const };

    const renderRow = (contextOverrides = {}) => {
        const contextValue = { ...mockContext, ...contextOverrides };
        return render(
            <SettingsContext.Provider value={contextValue}>
                <CompactCommodityRow commodity={mockCommodity} onPress={mockOnPress} />
            </SettingsContext.Provider>
        );
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockContext = { ...createMockSettingsContext(), density: 'compact' as const };
        mockContext.getMarketColors = jest.fn().mockReturnValue({
            textColor: 'text-rose-500',
            bgColor: 'bg-rose-500/10'
        });
    });

    it('renders correctly and handles press', () => {
        const { getByText } = renderRow();

        expect(getByText('Silver')).toBeTruthy();
        expect(getByText('24.50')).toBeTruthy();
        expect(getByText('Metals')).toBeTruthy();

        fireEvent.press(getByText('Silver'));
        expect(mockOnPress).toHaveBeenCalledWith(mockCommodity);
    });

    it('hides columns when their display setting is false', () => {
        const { queryByText } = renderRow({
            showUnit: false,
            showChangePercent: false
        });

        expect(queryByText('USD / oz')).toBeNull(); // Unit hidden
        expect(queryByText('-2.00%')).toBeNull(); // % Change hidden
        expect(queryByText('-0.5')).toBeTruthy(); // Abs change still visible
    });
});
