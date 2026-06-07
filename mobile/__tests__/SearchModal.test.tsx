import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import SearchModal from '../components/features/SearchModal';
import { renderWithSettings } from '../testUtils/renderWithSettings';

describe('SearchModal', () => {
    const commodity = {
        id: 'gold',
        name: 'Gold',
        category: 'Precious',
        price: 2000,
        change: 10,
        change_percent: 0.5,
        currency: 'USD',
        unit: 'oz',
        date: '2026-01-01',
    };

    it('clears the query when closing from the back button', () => {
        const onClose = jest.fn();
        const setSearchQuery = jest.fn();

        const { getByLabelText } = renderWithSettings(
            <SearchModal
                visible
                onClose={onClose}
                data={[commodity]}
                navigation={{ navigate: jest.fn() }}
                searchQuery="gold"
                setSearchQuery={setSearchQuery}
            />
        );

        fireEvent.press(getByLabelText('back'));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(setSearchQuery).toHaveBeenCalledWith('');
    });

    it('clears the query before navigating to a selected commodity', () => {
        const onClose = jest.fn();
        const setSearchQuery = jest.fn();
        const navigation = { navigate: jest.fn() };

        const { getByLabelText } = renderWithSettings(
            <SearchModal
                visible
                onClose={onClose}
                data={[commodity]}
                navigation={navigation}
                searchQuery="gold"
                setSearchQuery={setSearchQuery}
            />
        );

        fireEvent.press(getByLabelText('Gold, 2000 USD, up 0.5%'));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(setSearchQuery).toHaveBeenCalledWith('');
        expect(navigation.navigate).toHaveBeenCalledWith('CommodityDetail', { commodity });
    });
});
