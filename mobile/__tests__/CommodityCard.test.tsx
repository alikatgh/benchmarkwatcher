import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import CommodityCard from '../components/CommodityCard';
import { Commodity } from '../types/commodity';
import { createMockSettingsContext } from '../testUtils/settingsContextMock';
import { renderWithSettings } from '../testUtils/renderWithSettings';

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

    let mockContext = createMockSettingsContext();

    const renderCard = (contextOverrides = {}) => {
        return renderWithSettings(
            <CommodityCard commodity={mockCommodity} onPress={mockOnPress} />,
            { ...mockContext, ...contextOverrides }
        );
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockContext = createMockSettingsContext();
    });

    it('renders basic commodity information', () => {
        const { getByText } = renderCard();

        expect(getByText('Gold')).toBeTruthy();
        expect(getByText('1,850.50')).toBeTruthy();
        expect(getByText(/Precious/)).toBeTruthy();
        expect(getByText(/\+12\.5/)).toBeTruthy(); // Absolute change
        expect(getByText(/\+0\.68%/)).toBeTruthy(); // % change
        expect(getByText('2023-10-25')).toBeTruthy();
        expect(getByText(/USD/)).toBeTruthy();
    });

    it('triggers onPress with correct commodity when pressed', () => {
        const { getByText } = renderCard();

        fireEvent.press(getByText('Gold'));
        expect(mockOnPress).toHaveBeenCalledWith(mockCommodity);
        expect(mockOnPress).toHaveBeenCalledTimes(1);
    });

    it('hides fields when disabled in SettingsContext', () => {
        const { queryByText } = renderCard({
            showCategory: false,
            showChangeAbs: false,
            showDate: false
        });

        expect(queryByText('Precious')).toBeNull(); // Category hidden
        expect(queryByText('+12.5')).toBeNull();    // Abs change hidden
        expect(queryByText('2023-10-25')).toBeNull(); // Date hidden
    });
});
