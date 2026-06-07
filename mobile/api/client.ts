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

const configuredBaseUrl = process.env.EXPO_PUBLIC_API_URL;

if (!__DEV__ && (!configuredBaseUrl || !configuredBaseUrl.startsWith('https://'))) {
    throw new Error('EXPO_PUBLIC_API_URL must be set to an https:// URL for production builds.');
}

export const API_BASE_URL = configuredBaseUrl || `http://${host}:5002`;

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
                const statusText = response.statusText || 'Unknown error';
                if (response.status >= 500) {
                    throw new Error(`Server error (${response.status}): ${statusText}`);
                } else if (response.status === 404) {
                    throw new Error('Resource not found');
                } else if (response.status === 403) {
                    throw new Error('Access denied');
                } else if (response.status === 429) {
                    throw new Error('Too many requests. Please wait and try again.');
                }
                throw new Error(`HTTP error (${response.status}): ${statusText}`);
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
    // Ensure we throw a proper Error object
    if (lastError instanceof Error) {
        throw lastError;
    }
    throw new Error(lastError ? String(lastError) : `Request to ${endpoint} failed`);
}
