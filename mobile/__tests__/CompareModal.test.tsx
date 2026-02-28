import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import CompareModal from '../components/features/CompareModal';
import { SettingsContext } from '../context/SettingsContext';
import { fetchCommodities } from '../api/commodities';
import { createMockSettingsContext } from '../testUtils/settingsContextMock';

jest.mock('../api/commodities', () => ({
    fetchCommodities: jest.fn(),
}));

const mockedFetchCommodities = fetchCommodities as jest.MockedFunction<typeof fetchCommodities>;

describe('CompareModal accessibility interactions', () => {
    const goldCommodity = {
        id: 'gold',
        name: 'Gold',
        category: 'Precious',
        price: 1850,
        currency: 'USD',
        unit: 'oz',
        date: '2026-01-01',
        change: 10,
        change_percent: 0.5,
    } as any;

    const silverCommodity = {
        id: 'silver',
        name: 'Silver',
        category: 'Precious',
        price: 24,
        currency: 'USD',
        unit: 'oz',
        date: '2026-01-01',
        change: 0.2,
        change_percent: 0.8,
    } as any;

    const platinumCommodity = {
        id: 'platinum',
        name: 'Platinum',
        category: 'Precious',
        price: 950,
        currency: 'USD',
        unit: 'oz',
        date: '2026-01-01',
        change: 0.1,
        change_percent: 0.2,
    } as any;

    const fullComparisons = [
        { id: 'gold', name: 'Gold', color: '#e11d48', history: [] },
        { id: 'copper', name: 'Copper', color: '#8b5cf6', history: [] },
        { id: 'corn', name: 'Corn', color: '#f59e0b', history: [] },
        { id: 'wheat', name: 'Wheat', color: '#06b6d4', history: [] },
    ];

    let mockContext = createMockSettingsContext();

    beforeEach(() => {
        jest.clearAllMocks();
        mockContext = createMockSettingsContext();
        mockedFetchCommodities.mockResolvedValue([goldCommodity]);
    });

    it('supports removing selected comparison via accessibility-labeled tag', async () => {
        const onRemoveComparison = jest.fn();

        const { getAllByLabelText } = render(
            <SettingsContext.Provider value={mockContext}>
                <CompareModal
                    visible={true}
                    onClose={jest.fn()}
                    currentCommodityId="brent_oil"
                    comparisons={[{ id: 'gold', name: 'Gold', color: '#e11d48', history: [] }]}
                    onToggleCommodity={jest.fn()}
                    onRemoveComparison={onRemoveComparison}
                    onClearAll={jest.fn()}
                />
            </SettingsContext.Provider>
        );

        await waitFor(() => expect(mockedFetchCommodities).toHaveBeenCalled());

        fireEvent.press(getAllByLabelText('Remove Gold from comparison')[0]);
        expect(onRemoveComparison).toHaveBeenCalledWith('gold');
    });

    it('resets search input when modal is reopened', async () => {
        const onClose = jest.fn();
        const onToggleCommodity = jest.fn();
        const onRemoveComparison = jest.fn();
        const onClearAll = jest.fn();

        const { getByLabelText, getByDisplayValue, queryByDisplayValue, rerender } = render(
            <SettingsContext.Provider value={mockContext}>
                <CompareModal
                    visible={true}
                    onClose={onClose}
                    currentCommodityId="brent_oil"
                    comparisons={[]}
                    onToggleCommodity={onToggleCommodity}
                    onRemoveComparison={onRemoveComparison}
                    onClearAll={onClearAll}
                />
            </SettingsContext.Provider>
        );

        await waitFor(() => expect(mockedFetchCommodities).toHaveBeenCalledTimes(1));

        fireEvent.changeText(getByLabelText('Search commodities'), 'gol');
        expect(getByDisplayValue('gol')).toBeTruthy();

        rerender(
            <SettingsContext.Provider value={mockContext}>
                <CompareModal
                    visible={false}
                    onClose={onClose}
                    currentCommodityId="brent_oil"
                    comparisons={[]}
                    onToggleCommodity={onToggleCommodity}
                    onRemoveComparison={onRemoveComparison}
                    onClearAll={onClearAll}
                />
            </SettingsContext.Provider>
        );

        rerender(
            <SettingsContext.Provider value={mockContext}>
                <CompareModal
                    visible={true}
                    onClose={onClose}
                    currentCommodityId="brent_oil"
                    comparisons={[]}
                    onToggleCommodity={onToggleCommodity}
                    onRemoveComparison={onRemoveComparison}
                    onClearAll={onClearAll}
                />
            </SettingsContext.Provider>
        );

        await waitFor(() => expect(mockedFetchCommodities).toHaveBeenCalledTimes(2));
        expect(queryByDisplayValue('gol')).toBeNull();
    });

    it('retries loading commodities after initial failure', async () => {
        mockedFetchCommodities
            .mockRejectedValueOnce(new Error('network'))
            .mockResolvedValueOnce([goldCommodity]);

        const { getByLabelText, findByText, queryByText } = render(
            <SettingsContext.Provider value={mockContext}>
                <CompareModal
                    visible={true}
                    onClose={jest.fn()}
                    currentCommodityId="brent_oil"
                    comparisons={[]}
                    onToggleCommodity={jest.fn()}
                    onRemoveComparison={jest.fn()}
                    onClearAll={jest.fn()}
                />
            </SettingsContext.Provider>
        );

        expect(await findByText('Unable to load commodity list. Please try again.')).toBeTruthy();

        fireEvent.press(getByLabelText('Retry loading commodities'));

        await waitFor(() => expect(mockedFetchCommodities).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(queryByText('Unable to load commodity list. Please try again.')).toBeNull());
    });

    it('disables adding non-selected commodities when max comparisons reached', async () => {
        mockedFetchCommodities.mockResolvedValueOnce([goldCommodity, silverCommodity]);

        const onToggleCommodity = jest.fn();

        const { getByLabelText } = render(
            <SettingsContext.Provider value={mockContext}>
                <CompareModal
                    visible={true}
                    onClose={jest.fn()}
                    currentCommodityId="brent_oil"
                    comparisons={fullComparisons}
                    onToggleCommodity={onToggleCommodity}
                    onRemoveComparison={jest.fn()}
                    onClearAll={jest.fn()}
                />
            </SettingsContext.Provider>
        );

        await waitFor(() => expect(mockedFetchCommodities).toHaveBeenCalled());

        const addSilverControl = getByLabelText('Add Silver to comparison');
        expect(addSilverControl.props.accessibilityState?.disabled).toBe(true);

        fireEvent.press(addSilverControl);
        expect(onToggleCommodity).not.toHaveBeenCalled();
    });

    it('allows toggling a selected commodity even when max comparisons reached', async () => {
        mockedFetchCommodities.mockResolvedValueOnce([goldCommodity]);

        const onToggleCommodity = jest.fn();

        const { getAllByLabelText } = render(
            <SettingsContext.Provider value={mockContext}>
                <CompareModal
                    visible={true}
                    onClose={jest.fn()}
                    currentCommodityId="brent_oil"
                    comparisons={fullComparisons}
                    onToggleCommodity={onToggleCommodity}
                    onRemoveComparison={jest.fn()}
                    onClearAll={jest.fn()}
                />
            </SettingsContext.Provider>
        );

        await waitFor(() => expect(mockedFetchCommodities).toHaveBeenCalled());

        const removeGoldControl = getAllByLabelText('Remove Gold from comparison').at(-1)!;

        fireEvent.press(removeGoldControl);
        expect(onToggleCommodity).toHaveBeenCalledWith(expect.objectContaining({ id: 'gold' }));
    });

    it('invokes clear-all callback and supports adding again after parent reset', async () => {
        mockedFetchCommodities.mockResolvedValueOnce([goldCommodity, silverCommodity]);

        const onToggleCommodity = jest.fn();
        const onClearAll = jest.fn();

        const { getByLabelText, rerender } = render(
            <SettingsContext.Provider value={mockContext}>
                <CompareModal
                    visible={true}
                    onClose={jest.fn()}
                    currentCommodityId="brent_oil"
                    comparisons={fullComparisons}
                    onToggleCommodity={onToggleCommodity}
                    onRemoveComparison={jest.fn()}
                    onClearAll={onClearAll}
                />
            </SettingsContext.Provider>
        );

        await waitFor(() => expect(mockedFetchCommodities).toHaveBeenCalled());

        fireEvent.press(getByLabelText('Clear all selected comparisons'));
        expect(onClearAll).toHaveBeenCalledTimes(1);

        rerender(
            <SettingsContext.Provider value={mockContext}>
                <CompareModal
                    visible={true}
                    onClose={jest.fn()}
                    currentCommodityId="brent_oil"
                    comparisons={[]}
                    onToggleCommodity={onToggleCommodity}
                    onRemoveComparison={jest.fn()}
                    onClearAll={onClearAll}
                />
            </SettingsContext.Provider>
        );

        const addSilverControl = getByLabelText('Add Silver to comparison');
        expect(addSilverControl.props.accessibilityState?.disabled).toBe(false);

        fireEvent.press(addSilverControl);
        expect(onToggleCommodity).toHaveBeenCalledWith(expect.objectContaining({ id: 'silver' }));
    });

    it('keeps non-selected filtered results disabled at max comparison limit', async () => {
        mockedFetchCommodities.mockResolvedValueOnce([goldCommodity, silverCommodity, platinumCommodity]);

        const onToggleCommodity = jest.fn();

        const { getByLabelText } = render(
            <SettingsContext.Provider value={mockContext}>
                <CompareModal
                    visible={true}
                    onClose={jest.fn()}
                    currentCommodityId="brent_oil"
                    comparisons={fullComparisons}
                    onToggleCommodity={onToggleCommodity}
                    onRemoveComparison={jest.fn()}
                    onClearAll={jest.fn()}
                />
            </SettingsContext.Provider>
        );

        await waitFor(() => expect(mockedFetchCommodities).toHaveBeenCalled());

        fireEvent.changeText(getByLabelText('Search commodities'), 'sil');

        const addSilverControl = getByLabelText('Add Silver to comparison');
        expect(addSilverControl.props.accessibilityState?.disabled).toBe(true);

        fireEvent.press(addSilverControl);
        expect(onToggleCommodity).not.toHaveBeenCalled();
    });

    it('keeps selected filtered item removable while non-selected filtered item stays disabled at max limit', async () => {
        mockedFetchCommodities.mockResolvedValueOnce([goldCommodity, silverCommodity]);

        const onToggleCommodity = jest.fn();

        const { getByLabelText, getAllByLabelText } = render(
            <SettingsContext.Provider value={mockContext}>
                <CompareModal
                    visible={true}
                    onClose={jest.fn()}
                    currentCommodityId="brent_oil"
                    comparisons={fullComparisons}
                    onToggleCommodity={onToggleCommodity}
                    onRemoveComparison={jest.fn()}
                    onClearAll={jest.fn()}
                />
            </SettingsContext.Provider>
        );

        await waitFor(() => expect(mockedFetchCommodities).toHaveBeenCalled());

        fireEvent.changeText(getByLabelText('Search commodities'), 'g');
        const removeGoldControl = getAllByLabelText('Remove Gold from comparison').at(-1)!;
        fireEvent.press(removeGoldControl);
        expect(onToggleCommodity).toHaveBeenCalledWith(expect.objectContaining({ id: 'gold' }));

        fireEvent.changeText(getByLabelText('Search commodities'), 'sil');
        const addSilverControl = getByLabelText('Add Silver to comparison');
        expect(addSilverControl.props.accessibilityState?.disabled).toBe(true);

        fireEvent.press(addSilverControl);
        expect(onToggleCommodity).toHaveBeenCalledTimes(1);
    });
});
