import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import { fetchCommodities } from '../api/commodities';
import { sortCommodities } from '../utils/sortUtils';
import { Commodity } from '../types/commodity';

interface UseCommoditiesParams {
    syncEnabled: boolean;
    syncTrigger: number;
    selectedCategory: string;
    selectedRange: string;
    sortMethod: string;
    sortOrder: string;
}

function getLatestDate(commodities: Commodity[]): string | undefined {
    const dates = commodities.map(c => c.date).filter(Boolean);
    if (dates.length === 0) return undefined;
    return dates.sort().at(-1);
}

export function useCommodities({
    syncEnabled,
    syncTrigger,
    selectedCategory,
    selectedRange,
    sortMethod,
    sortOrder
}: UseCommoditiesParams) {
    const [data, setData] = useState<Commodity[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastFetchTime, setLastFetchTime] = useState<string | null>(null);

    const appState = useRef(AppState.currentState);
    // Ref so loadData can read current data without stale closure
    const dataRef = useRef<Commodity[]>([]);
    useEffect(() => { dataRef.current = data; }, [data]);

    const loadData = useCallback(async (isRefresh = false) => {
        if (!isRefresh) setLoading(true);
        try {
            const apiCat = selectedCategory.toLowerCase() === 'all' ? '' : selectedCategory.toLowerCase();
            // On background/pull-to-refresh, only fetch commodities newer than what we have
            const since = isRefresh ? getLatestDate(dataRef.current) : undefined;
            const result = await fetchCommodities(apiCat, sortMethod, sortOrder, selectedRange, since);

            if (since && result.length > 0) {
                // Partial refresh: merge updated commodities into existing list
                setData(prev => {
                    const map = new Map(prev.map(c => [c.id, c]));
                    result.forEach(c => map.set(c.id, c));
                    return sortCommodities(Array.from(map.values()), sortMethod, sortOrder);
                });
            } else if (!since) {
                // Full fetch (initial load or first sync with empty cache)
                setData(result);
            }
            // If since was set but result is empty: no new data, keep existing unchanged

            setLastFetchTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            setError(null);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch data');
        } finally {
            // Only reset the full loading spinner when it was set (non-refresh path)
            if (!isRefresh) setLoading(false);
            setRefreshing(false);
        }
    }, [selectedCategory, sortMethod, sortOrder, selectedRange]);

    // Initial Load & Filter/Sort Changes
    useEffect(() => {
        loadData();
    }, [loadData]);

    // Force Refresh Trigger
    useEffect(() => {
        if (syncTrigger > 0) {
            setRefreshing(true);
            loadData(true);
        }
    }, [syncTrigger, loadData]);

    // Background Sync & AppState Active Sync
    useEffect(() => {
        let intervalId: ReturnType<typeof setInterval>;

        if (syncEnabled) {
            intervalId = setInterval(() => {
                loadData(true);
            }, 30000);
        }

        const subscription = AppState.addEventListener('change', nextAppState => {
            if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
                if (syncEnabled) loadData(true);
            }
            appState.current = nextAppState;
        });

        return () => {
            if (intervalId) clearInterval(intervalId);
            subscription.remove();
        };
    }, [syncEnabled, loadData]);

    const handleRefresh = useCallback(() => {
        setRefreshing(true);
        loadData(true);
    }, [loadData]);

    return {
        data,
        loading,
        refreshing,
        error,
        lastFetchTime,
        handleRefresh
    };
}
