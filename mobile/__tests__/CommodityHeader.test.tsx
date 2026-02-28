import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import CommodityHeader from '../components/features/CommodityHeader';

describe('CommodityHeader', () => {
    const commodity = {
        id: 'brent_oil',
        name: 'Brent Crude Oil',
        category: 'Energy',
        price: 71.66,
        currency: 'USD',
        unit: 'barrel',
        date: '2026-01-01',
    };

    it('renders current change context and switches period via controls', () => {
        const onChangePeriod = jest.fn();
        const handleCopyPrice = jest.fn();

        const { getByText } = render(
            <CommodityHeader
                commodity={commodity}
                isUp={true}
                changeColor="text-emerald-500"
                badgeColor="bg-emerald-500"
                handleCopyPrice={handleCopyPrice}
                selectedChangePeriod="1"
                onChangePeriod={onChangePeriod}
                changePercent={1.36}
                changeAbs={0.96}
                changeContextLabel="vs prev month · As of 2026-01-01"
            />
        );

        expect(getByText('Brent Crude Oil')).toBeTruthy();
        expect(getByText('+1.36%')).toBeTruthy();
        expect(getByText(/vs prev month/i)).toBeTruthy();

        fireEvent.press(getByText('~30 obs'));
        expect(onChangePeriod).toHaveBeenCalledWith('30');

        fireEvent.press(getByText('~1 year'));
        expect(onChangePeriod).toHaveBeenCalledWith('365');
    });
});
