export interface HistoryPoint {
    date: string;
    price: number;
}

export interface Commodity {
    id: string;
    name: string;
    category: string;
    price: number;
    prev_price?: number;
    change: number;
    change_percent: number;
    currency: string;
    unit: string;
    date: string;
    prev_date?: string;
    history?: HistoryPoint[];
    source_name?: string;
    source_url?: string;
    source_type?: string;
    updated_at?: string;
    is_daily?: boolean;
    derived?: boolean;
    derived_stats?: {
        abs_change_1_obs?: number;
        pct_change_1_obs?: number;
        pct_change_30_obs?: number;
        pct_change_365_obs?: number;
        pct_30d?: number;
        pct_1y?: number;
        direction_30_obs?: string;
        volatility_30d?: number;
    };
}

export interface ComparisonSeries {
    id: string;
    name: string;
    color: string;
    history: HistoryPoint[];
}

export interface ApiResponse<T> {
    data: T;
    meta?: any;
}
