import { fetchCommodities } from '../api/commodities';

declare var global: any;

// Setup mock fetch
global.fetch = jest.fn();

const mockData = [
    { id: 'gold', name: 'Gold', category: 'Precious', price: 2000, change_percent: 2.5, volatility_30d: 0.05 },
    { id: 'oil', name: 'Brent Crude', category: 'Energy', price: 80, change_percent: -1.0, volatility_30d: 0.15 },
    { id: 'corn', name: 'Corn', category: 'Agriculture', price: 400, change_percent: 0.5, volatility_30d: 0.08 }
];

describe('api/commodities', () => {
    beforeEach(() => {
        (global.fetch as jest.Mock).mockClear();
    });

    it('fetches data successfully from the correct URL', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({ data: mockData })
        });

        const commodities = await fetchCommodities('energy', 'name', 'asc', '1M');

        // Check URL construction
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const url = (global.fetch as jest.Mock).mock.calls[0][0];
        expect(url).toContain('category=energy');
        expect(url).toContain('range=1M');

        expect(commodities).toHaveLength(3);
        // It sorts by name asc
        expect(commodities[0].id).toBe('oil'); // Brent Crude
        expect(commodities[1].id).toBe('corn'); // Corn
        expect(commodities[2].id).toBe('gold'); // Gold
    });

    it('sorts correctly by highest price', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({ data: mockData }) // API returns mock array
        });

        const commodities = await fetchCommodities('', 'price', 'desc', '1M');

        expect(commodities[0].id).toBe('gold'); // 2000
        expect(commodities[1].id).toBe('corn'); // 400
        expect(commodities[2].id).toBe('oil'); // 80
    });

    it('sorts correctly by highest % gain', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({ data: mockData })
        });

        const commodities = await fetchCommodities('', 'change_percent', 'desc', '1M');

        expect(commodities[0].id).toBe('gold'); // +2.5%
        expect(commodities[1].id).toBe('corn'); // +0.5%
        expect(commodities[2].id).toBe('oil'); // -1.0%
    });

    it('throws error on failed HTTP response', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            status: 404
        });

        await expect(fetchCommodities()).rejects.toThrow('HTTP error! status: 404');
    });
});
