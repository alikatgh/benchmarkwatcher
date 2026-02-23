import { Platform } from 'react-native';

// In React Native:
// iOS Simulator can access localhost directly.
// Android Emulator requires 10.0.2.2 to access the host machine's localhost.
export const API_BASE_URL = Platform.OS === 'android'
    ? 'http://10.0.2.2:5002'
    : 'http://localhost:5002';

import { Commodity } from '../types/commodity';

export async function fetchCommodities(category = 'all', sort = 'priority', order = 'asc', range = '1W'): Promise<Commodity[]> {
    const url = `${API_BASE_URL}/api/commodities?category=${category}&sort=${sort}&order=${order}&range=${range}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const json = await response.json();
        const data: Commodity[] = json.data || json; // Handle both {data: []} and [] formats

        // Client-side Advanced Sorting
        data.sort((a, b) => {
            let valA: any = a.name;
            let valB: any = b.name;

            if (sort === 'change_percent') {
                valA = a.change_percent ?? 0;
                valB = b.change_percent ?? 0;
            } else if (sort === 'name') {
                valA = a.name.toLowerCase();
                valB = b.name.toLowerCase();
            } else if (sort === 'price') {
                valA = a.price ?? 0;
                valB = b.price ?? 0;
            } else if (sort === 'volatility') {
                valA = a.derived_stats?.volatility_30d ?? 0;
                valB = b.derived_stats?.volatility_30d ?? 0;
            } else {
                // Default 'priority' fallback to Name
                valA = a.name.toLowerCase();
                valB = b.name.toLowerCase();
            }

            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });

        return data;
    } catch (error) {
        console.error("Error fetching commodities:", error);
        throw error;
    }
}

export async function fetchCommodityDetail(id: string): Promise<Commodity> {
    const url = `${API_BASE_URL}/api/commodity/${encodeURIComponent(id)}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        return result.data; // Flask backend returns { data: Commodity }
    } catch (error) {
        console.error(`Error fetching commodity details for ${id}:`, error);
        throw error;
    }
}
