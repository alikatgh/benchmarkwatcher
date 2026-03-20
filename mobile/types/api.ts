export interface ApiMeta {
    count: number;
    range: string;
    category: string | null;
    since?: string | null;
    partial?: boolean;
    include_history?: boolean;
}

export interface ApiResponse<T> {
    data: T;
    meta?: ApiMeta;
    error?: string;
}

export interface ApiError {
    message: string;
    code?: number;
}
