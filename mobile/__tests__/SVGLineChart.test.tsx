import React from 'react';
import { render } from '@testing-library/react-native';
import SVGLineChart from '../components/features/SVGLineChart';

describe('SVGLineChart selected point details', () => {
    it('shows formatted date, currency value, and price delta in the selection bar', () => {
        const { getByText } = render(
            <SVGLineChart
                data={[
                    { value: 100, date: '2026-01-01', label: '01-01' },
                    { value: 120, date: '2026-01-02', label: '01-02' },
                ]}
                width={320}
                height={220}
                color="16, 185, 129"
                selectedPoint={{ index: 1, value: 120, x: 180, y: 80, date: '2026-01-02' }}
                viewMode="price"
                primaryName="Gold"
                currency="USD"
            />
        );

        expect(getByText(/Gold.*2026/)).toBeTruthy();
        expect(getByText('120 USD')).toBeTruthy();
        expect(getByText('+20.0 USD (+20.0%)')).toBeTruthy();
    });

    it('uses percentage points without percent-of-percent math in percent mode', () => {
        const { getByText, getAllByText, queryByText } = render(
            <SVGLineChart
                data={[
                    { value: 0, date: '2026-01-01', label: '01-01' },
                    { value: 2, date: '2026-01-02', label: '01-02' },
                    { value: 3, date: '2026-01-03', label: '01-03' },
                ]}
                width={320}
                height={220}
                color="16, 185, 129"
                selectedPoint={{ index: 2, value: 3, x: 220, y: 70, date: '2026-01-03' }}
                viewMode="percent"
                primaryName="Gold"
                currency="USD"
            />
        );

        expect(getByText('3.00%')).toBeTruthy();
        expect(getByText('+1.00pp')).toBeTruthy();
        expect(queryByText(/\(\+50.0%\)/)).toBeNull();
    });

    it('bases comparison percent values on the first visible aligned point', () => {
        const { getByText, getAllByText, queryByText } = render(
            <SVGLineChart
                data={[
                    { value: 0, date: '2026-01-02', label: '01-02' },
                    { value: 10, date: '2026-01-03', label: '01-03' },
                ]}
                width={320}
                height={220}
                color="16, 185, 129"
                selectedPoint={{ index: 1, value: 10, x: 220, y: 70, date: '2026-01-03' }}
                viewMode="percent"
                primaryName="Gold"
                comparisons={[
                    {
                        id: 'silver',
                        name: 'Silver',
                        color: '#8b5cf6',
                        history: [
                            { date: '2026-01-01', price: 100 },
                            { date: '2026-01-02', price: 200 },
                            { date: '2026-01-03', price: 220 },
                        ],
                    },
                ]}
            />
        );

        expect(getByText('Silver')).toBeTruthy();
        expect(getAllByText('10.00%').length).toBeGreaterThan(0);
        expect(queryByText('120.00%')).toBeNull();
    });
});
