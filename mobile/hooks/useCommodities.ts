import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import { fetchCommodities } from '../api/commodities';
import { Commodity } from '../types/commodity';

interface UseCommoditiesParams {
    syncEnabled: boolean;
    syncTrigger: number;
    selectedCategory: string;
    selectedRange: string;
    sortMethod: string;
    sortOrder: string;
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

    const loadData = useCallback(async (isRefresh = false) => {
        if (!isRefresh) setLoading(true);
        try {
            const apiCat = selectedCategory.toLowerCase() === 'all' ? '' : selectedCategory.toLowerCase();
            const result = await fetchCommodities(apiCat, sortMethod, sortOrder, selectedRange);
            setData(result);
            setLastFetchTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            setError(null);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch data');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [selectedCategory, sortMethod, sortOrder, selectedRange]);

    // Initial Load & Filter Changes
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
            }, 30000); // 30s as requested by sync requirements
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
