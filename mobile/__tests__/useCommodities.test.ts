import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useCommodities } from '../hooks/useCommodities';
import { fetchCommodities } from '../api/commodities';

jest.mock('../api/commodities');
const mockFetch = fetchCommodities as jest.MockedFunction<typeof fetchCommodities>;

const defaultParams = {
    syncEnabled: false,
    syncTrigger: 0,
    selectedCategory: 'all',
    selectedRange: '1M',
    sortMethod: 'name',
    sortOrder: 'asc',
};

type UseCommoditiesParams = typeof defaultParams;

const mockCommodities = [
    { id: 'gold', name: 'Gold', category: 'Precious', price: 2000, change: 10, change_percent: 0.5, currency: 'USD', unit: 'oz', date: '2024-01-15' },
    { id: 'oil', name: 'Oil', category: 'Energy', price: 80, change: -1, change_percent: -1.2, currency: 'USD', unit: 'bbl', date: '2024-01-15' },
];

beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

describe('useCommodities', () => {
    it('starts with loading=true and empty data', () => {
        mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
        const { result } = renderHook(() => useCommodities(defaultParams));
        expect(result.current.loading).toBe(true);
        expect(result.current.data).toEqual([]);
        expect(result.current.error).toBeNull();
    });

    it('sets data and clears loading after successful fetch', async () => {
        mockFetch.mockResolvedValue(mockCommodities as any);
        const { result } = renderHook(() => useCommodities(defaultParams));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.data).toEqual(mockCommodities);
        expect(result.current.error).toBeNull();
        expect(result.current.lastFetchTime).not.toBeNull();
    });

    it('sets error and resets loading when fetch fails', async () => {
        mockFetch.mockRejectedValue(new Error('Network error'));
        const { result } = renderHook(() => useCommodities(defaultParams));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.error).toBe('Network error');
        expect(result.current.data).toEqual([]);
        expect(result.current.loading).toBe(false);
    });

    it('resets refreshing to false even when refresh fetch fails', async () => {
        // Initial load succeeds
        mockFetch.mockResolvedValueOnce(mockCommodities as any);
        const { result } = renderHook(() => useCommodities(defaultParams));
        await waitFor(() => expect(result.current.loading).toBe(false));

        // Refresh fails
        mockFetch.mockRejectedValueOnce(new Error('Timeout'));
        act(() => { result.current.handleRefresh(); });

        expect(result.current.refreshing).toBe(true);

        await waitFor(() => expect(result.current.refreshing).toBe(false));

        expect(result.current.error).toBe('Timeout');
        // Data is preserved from initial load
        expect(result.current.data).toEqual(mockCommodities);
    });

    it('handleRefresh sets refreshing then resets after success', async () => {
        mockFetch.mockResolvedValue(mockCommodities as any);
        const { result } = renderHook(() => useCommodities(defaultParams));
        await waitFor(() => expect(result.current.loading).toBe(false));

        const updated = [...mockCommodities, { id: 'silver', name: 'Silver', category: 'Precious', price: 25, change: 0.5, change_percent: 2, currency: 'USD', unit: 'oz', date: '2024-01-16' }];
        mockFetch.mockResolvedValueOnce(updated as any);

        act(() => { result.current.handleRefresh(); });
        expect(result.current.refreshing).toBe(true);

        await waitFor(() => expect(result.current.refreshing).toBe(false));
        expect(result.current.error).toBeNull();
    });

    it('loading stays false during refresh (does not show full-screen loader)', async () => {
        mockFetch.mockResolvedValue(mockCommodities as any);
        const { result } = renderHook(() => useCommodities(defaultParams));
        await waitFor(() => expect(result.current.loading).toBe(false));

        mockFetch.mockReturnValueOnce(new Promise(() => {})); // stall refresh
        act(() => { result.current.handleRefresh(); });

        expect(result.current.loading).toBe(false); // full-page spinner should NOT appear
        expect(result.current.refreshing).toBe(true); // pull-to-refresh indicator active
    });

    it('passes category param to fetchCommodities (skips "all")', async () => {
        mockFetch.mockResolvedValue([]);
        renderHook(() => useCommodities({ ...defaultParams, selectedCategory: 'energy' }));

        await waitFor(() => expect(mockFetch).toHaveBeenCalled());
        expect(mockFetch).toHaveBeenCalledWith('energy', 'name', 'asc', '1M', undefined);
    });

    it('passes empty string for category "all"', async () => {
        mockFetch.mockResolvedValue([]);
        renderHook(() => useCommodities(defaultParams)); // selectedCategory = 'all'

        await waitFor(() => expect(mockFetch).toHaveBeenCalled());
        expect(mockFetch).toHaveBeenCalledWith('', 'name', 'asc', '1M', undefined);
    });

    it('re-fetches when filter params change', async () => {
        mockFetch.mockResolvedValue(mockCommodities as any);
        const { rerender } = renderHook(
            (props: UseCommoditiesParams) => useCommodities(props),
            { initialProps: defaultParams }
        );
        await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

        mockFetch.mockResolvedValue([]);
        rerender({ ...defaultParams, selectedCategory: 'metals' });

        await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
        expect(mockFetch).toHaveBeenLastCalledWith('metals', 'name', 'asc', '1M', undefined);
    });

    it('force sync trigger (syncTrigger > 0) fires a refresh', async () => {
        mockFetch.mockResolvedValue(mockCommodities as any);
        const { rerender, result } = renderHook(
            (props: UseCommoditiesParams) => useCommodities(props),
            { initialProps: defaultParams }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        mockFetch.mockResolvedValueOnce(mockCommodities as any);
        rerender({ ...defaultParams, syncTrigger: 1 });

        await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(result.current.refreshing).toBe(false));
    });

    it('sends since param on incremental refresh', async () => {
        mockFetch.mockResolvedValue(mockCommodities as any);
        const { result } = renderHook(() => useCommodities(defaultParams));
        await waitFor(() => expect(result.current.loading).toBe(false));

        mockFetch.mockResolvedValueOnce([]);
        act(() => { result.current.handleRefresh(); });

        await waitFor(() => expect(result.current.refreshing).toBe(false));

        // Second call (the refresh) should include `since` = latest date from first fetch
        const calls = mockFetch.mock.calls;
        expect(calls.length).toBe(2);
        expect(calls[1][4]).toBe('2024-01-15'); // `since` = max date from mockCommodities
    });
});
