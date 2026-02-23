import { Commodity } from '../types/commodity';
import { sortCommodities } from '../utils/sortUtils';
import { apiClient } from './client';

export async function fetchCommodities(category = 'all', sort = 'priority', order = 'asc', range = '1W'): Promise<Commodity[]> {
    const endpoint = `/api/commodities?category=${category}&sort=${sort}&order=${order}&range=${range}`;

    try {
        const data = await apiClient<Commodity[] | any>(endpoint);

        // Handle variations where data might not be unwrapped yet based on type definitions
        const commoditiesArray: Commodity[] = Array.isArray(data) ? data : (data.data || []);

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
