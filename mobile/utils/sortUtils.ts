export function sortCommodities(data: any[], sortMethod: string, sortOrder: string): any[] {
    return [...data].sort((a, b) => {
        let valA: any = a.name;
        let valB: any = b.name;

        if (sortMethod === 'change_percent') {
            valA = a.change_percent ?? 0;
            valB = b.change_percent ?? 0;
        } else if (sortMethod === 'name') {
            valA = a.name.toLowerCase();
            valB = b.name.toLowerCase();
        } else if (sortMethod === 'price') {
            valA = a.price ?? 0;
            valB = b.price ?? 0;
        } else if (sortMethod === 'volatility') {
            valA = a.derived_stats?.volatility_30d ?? 0;
            valB = b.derived_stats?.volatility_30d ?? 0;
        } else {
            // Default 'priority' fallback to Name
            valA = a.name.toLowerCase();
            valB = b.name.toLowerCase();
        }

        if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
        return 0;
    });
}
