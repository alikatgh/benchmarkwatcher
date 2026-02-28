import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import CompactCommodityRow from '../components/CompactCommodityRow';
import { Commodity } from '../types/commodity';
import { createMockSettingsContext } from '../testUtils/settingsContextMock';
import { renderWithSettings } from '../testUtils/renderWithSettings';

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

    const renderSubject = (contextOverrides = {}) => {
        return renderWithSettings(
            <CompactCommodityRow commodity={mockCommodity} onPress={mockOnPress} />,
            { ...mockContext, ...contextOverrides }
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
        const { getByText } = renderSubject();

        expect(getByText('Silver')).toBeTruthy();
        expect(getByText('24.50')).toBeTruthy();
        expect(getByText('Metals')).toBeTruthy();

        fireEvent.press(getByText('Silver'));
        expect(mockOnPress).toHaveBeenCalledWith(mockCommodity);
    });

    it('hides columns when their display setting is false', () => {
        const { queryByText } = renderSubject({
            showUnit: false,
            showChangePercent: false
        });

        expect(queryByText('USD / oz')).toBeNull(); // Unit hidden
        expect(queryByText('-2.00%')).toBeNull(); // % Change hidden
        expect(queryByText('-0.5')).toBeTruthy(); // Abs change still visible
    });
});
