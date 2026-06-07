import { Commodity } from '../types/commodity';
import { sortCommodities } from '../utils/sortUtils';
import { apiClient } from './client';

/**
 * Validate that a commodity object has required fields.
 * Returns true if valid, false if malformed.
 */
function isValidCommodity(item: unknown): item is Commodity {
    if (!item || typeof item !== 'object') return false;
    const obj = item as Record<string, unknown>;
    return (
        typeof obj.id === 'string' &&
        typeof obj.name === 'string' &&
        typeof obj.price === 'number' &&
        typeof obj.category === 'string'
    );
}

function normalizeCategorySlug(category: string): string {
    const normalized = String(category || '').trim().toLowerCase();
    const aliases: Record<string, string> = {
        all: '',
        indices: 'index',
        indexes: 'index',
        index: 'index',
        agriculture: 'agricultural',
        agricultural: 'agricultural',
        metals: 'metal',
        metal: 'metal',
    };
    return aliases[normalized] ?? normalized;
}

export async function fetchCommodities(category = 'all', sort = 'priority', order = 'asc', range = '1W', since?: string): Promise<Commodity[]> {
    const normalizedCategory = normalizeCategorySlug(category);
    const params = [
        ['sort', sort],
        ['order', order],
        ['range', range],
        ['include_history', '0'],
    ];
    if (normalizedCategory) {
        params.unshift(['category', normalizedCategory]);
    }

    let endpoint = `/api/commodities?${params
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&')}`;
    if (since) endpoint += `&since=${encodeURIComponent(since)}`;

    try {
        const data = await apiClient<Commodity[]>(endpoint);

        // apiClient already unwraps { data: [...] } envelopes
        if (!Array.isArray(data)) {
            console.error("API returned non-array response for commodities");
            return [];
        }

        // Filter out malformed entries to prevent downstream crashes
        const validCommodities = data.filter(isValidCommodity);
        if (validCommodities.length < data.length) {
            console.error(`Filtered ${data.length - validCommodities.length} malformed commodity entries`);
        }

        return sortCommodities(validCommodities, sort, order);
    } catch (error) {
        console.error("Error fetching commodities:", error);
        throw error;
    }
}

export async function fetchCommodityDetail(id: string): Promise<Commodity> {
    if (!id || typeof id !== 'string') {
        throw new Error('Invalid commodity ID');
    }

    const endpoint = `/api/commodity/${encodeURIComponent(id)}`;

    try {
        const data = await apiClient<Commodity>(endpoint);

        if (!isValidCommodity(data)) {
            throw new Error(`Invalid commodity data received for ${id}`);
        }

        return data;
    } catch (error) {
        console.error(`Error fetching commodity details for ${id}:`, error);
        throw error;
    }
}
