import { Commodity } from '../types/commodity';
import { sortCommodities } from '../utils/sortUtils';
import { apiClient } from './client';

export async function fetchCommodities(category = 'all', sort = 'priority', order = 'asc', range = '1W', since?: string): Promise<Commodity[]> {
    let endpoint = `/api/commodities?category=${category}&sort=${sort}&order=${order}&range=${range}&include_history=0`;
    if (since) endpoint += `&since=${encodeURIComponent(since)}`;

    try {
        const data = await apiClient<Commodity[]>(endpoint);

        // apiClient already unwraps { data: [...] } envelopes
        const commoditiesArray: Commodity[] = Array.isArray(data) ? data : [];

        return sortCommodities(commoditiesArray, sort, order);
    } catch (error) {
        console.error("Error fetching commodities:", error);
        throw error;
    }
}

export async function fetchCommodityDetail(id: string): Promise<Commodity> {
    const endpoint = `/api/commodity/${encodeURIComponent(id)}`;

    try {
        // apiClient unwraps { data: Commodity } if it exists
        return await apiClient<Commodity>(endpoint);
    } catch (error) {
        console.error(`Error fetching commodity details for ${id}:`, error);
        throw error;
    }
}
