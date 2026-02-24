import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Environment Targeting: Prefer EXPO_PUBLIC_API_URL (used for production)
// In React Native dev:
// iOS Simulator can access localhost directly.
// Android Emulator requires 10.0.2.2 to access the host machine's localhost.
// Physical devices on LAN use the host computer's local IP via expo hostUri.
// NOTE: 10.0.2.2 is emulator-only — only applied inside __DEV__ guard.
let host = 'localhost';
if (__DEV__) {
    if (Constants.expoConfig?.hostUri) {
        host = Constants.expoConfig.hostUri.split(':')[0];
    } else if (Platform.OS === 'android') {
        // Android emulator: 10.0.2.2 maps to host machine's localhost
        host = '10.0.2.2';
    }
}

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || `http://${host}:5002`;

const REQUEST_TIMEOUT_MS = 10000; // 10 seconds
const MAX_RETRIES = 2;

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

export async function apiClient<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetchWithTimeout(url, { ...options, headers }, REQUEST_TIMEOUT_MS);

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
            lastError = error;
            const isAbort = error instanceof Error && error.name === 'AbortError';
            const isNetworkError = error instanceof TypeError;
            // Only retry on timeout or network errors, not HTTP errors (4xx/5xx)
            if (attempt < MAX_RETRIES && (isAbort || isNetworkError)) {
                const backoff = 500 * (attempt + 1);
                await new Promise(resolve => setTimeout(resolve, backoff));
                continue;
            }
            break;
        }
    }

    console.error(`API Client Error (${endpoint}):`, lastError);
    throw lastError;
}
