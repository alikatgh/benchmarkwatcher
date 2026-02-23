export interface ApiResponse<T> {
    data: T;
    meta?: any;
    error?: string;
}

export interface ApiError {
    message: string;
    code?: number;
}
