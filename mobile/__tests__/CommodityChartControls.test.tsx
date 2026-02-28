import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import CommodityChartControls from '../components/features/CommodityChartControls';

describe('CommodityChartControls', () => {
    it('exposes accessible actions and triggers callbacks', () => {
        const setSelectedRange = jest.fn();
        const setViewMode = jest.fn();
        const onExport = jest.fn();
        const onOpenSettings = jest.fn();
        const onOpenCompare = jest.fn();

        const { getByLabelText } = render(
            <CommodityChartControls
                loading={false}
                error={null}
                chartData={[{ value: 1, date: '2026-01-01', label: '01-01' }]}
                selectedRange="1M"
                setSelectedRange={setSelectedRange}
                viewMode="price"
                setViewMode={setViewMode}
                onExport={onExport}
                onOpenSettings={onOpenSettings}
                onOpenCompare={onOpenCompare}
            />
        );

        fireEvent.press(getByLabelText('Set time range to 3M'));
        expect(setSelectedRange).toHaveBeenCalledWith('3M');

        fireEvent.press(getByLabelText('Set chart view mode to percent change'));
        expect(setViewMode).toHaveBeenCalledWith('percent');

        fireEvent.press(getByLabelText('Open compare commodities panel'));
        expect(onOpenCompare).toHaveBeenCalledTimes(1);

        fireEvent.press(getByLabelText('Open chart settings'));
        expect(onOpenSettings).toHaveBeenCalledTimes(1);

        fireEvent.press(getByLabelText('Open export and share options'));
        fireEvent.press(getByLabelText('Copy chart data as CSV to clipboard'));
        expect(onExport).toHaveBeenCalledWith('csv');
    });
});
