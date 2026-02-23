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
    derived_stats?: {
        pct_30d?: number;
        pct_1y?: number;
        trend?: string;
        volatility_30d?: number;
    };
}

export interface ApiResponse<T> {
    data: T;
    meta?: any;
}
