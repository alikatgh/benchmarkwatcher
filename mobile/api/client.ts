import { Platform } from 'react-native';

// Environment Targeting: Prefer EXPO_PUBLIC_API_URL (used for production)
// In React Native:
// iOS Simulator can access localhost directly.
// Android Emulator requires 10.0.2.2 to access the host machine's localhost.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || (Platform.OS === 'android'
    ? 'http://10.0.2.2:5002'
    : 'http://localhost:5002');

export async function apiClient<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    try {
        const response = await fetch(url, { ...options, headers });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json = await response.json();

        // Handle common backend envelope { data: ... } vs raw arrays
        if (json && typeof json === 'object' && 'data' in json) {
            return json.data as T;
        }

        return json as T;
    } catch (error) {
        console.error(`API Client Error (${endpoint}):`, error);
        throw error;
    }
}
