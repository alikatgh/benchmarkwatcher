export interface ChangelogRelease {
    version: string;
    date: string;
    title: string;
    tag: string;
    tagColor: string;
    description: string;
    sections: {
        header: string;
        points: string[];
    }[];
}

export const changelogData: ChangelogRelease[] = [
    {
        version: "v1.2.1",
        date: "February 28, 2026",
        title: "Detail Change-Period Controls & Stability Updates",
        tag: "UPDATE",
        tagColor: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
        description: "Improved commodity detail insights with selectable return windows, persisted preferences, and targeted test stability fixes.",
        sections: [
            {
                header: "Added",
                points: [
                    "Commodity detail change-period selector: Prev obs, ~30 obs, ~1 year",
                    "Context label showing selected comparison window and as-of date",
                    "Persisted detail change-period preference via AsyncStorage",
                    "New mobile test coverage for detail header period switching"
                ]
            },
            {
                header: "Improved",
                points: [
                    "Period-aware change calculations now use derived stats when available",
                    "Absolute change display remains anchored to base observation direction",
                    "Commodity typing expanded for derived stats and frequency metadata",
                    "Web test harness stability improved by stubbing shared escapeHtml utility"
                ]
            }
        ]
    },
    {
        version: "v1.2.0",
        date: "February 23, 2026",
        title: "USDA Source Expansion & Mobile-First UI",
        tag: "NEW",
        tagColor: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
        description: "Massive expansion from 26 to 72 tracked commodities, plus a complete mobile-first UI overhaul.",
        sections: [
            {
                header: "Data Pipeline",
                points: [
                    "Added USDA NASS as a third data source (alongside FRED and EIA)",
                    "New Livestock category: Cattle, Hogs, Milk, Chicken, Eggs, Turkeys, Wool, Lamb",
                    "Expanded agricultural coverage: Oats, Barley, Sorghum, and US Farm Prices",
                    "Refactored monolithic fetch script into modular package (scripts/fetchers/)",
                    "Shared utilities: SmartDateParser, safe_get, merge_history, compute_metrics",
                    "Total commodities: 72 across 5 sources"
                ]
            },
            {
                header: "Mobile-First UI",
                points: [
                    "Scroll-hide category nav (Google Console style) — hides on scroll down, reappears on scroll up",
                    "Added Livestock and Indices links to category navigation",
                    "Horizontally scrollable range buttons and chart controls on mobile",
                    "Price hero section stacks vertically on mobile with responsive font sizes",
                    "Responsive chart height (280px → 350px → 400px by breakpoint)",
                    "Crosshair info and chart actions stack on narrow screens"
                ]
            }
        ]
    },
    {
        version: "v1.1.0",
        date: "January 11, 2026",
        title: "Telegram & Discord Bots",
        tag: "UPDATE",
        tagColor: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
        description: "Get commodity prices directly in your messaging apps! We've launched official bots for both Telegram and Discord.",
        sections: [
            {
                header: "Bot Commands",
                points: [
                    "/price brent — Get a commodity price",
                    "/prices energy — All prices in a category",
                    "/top — Top gainers and losers",
                    "/list — All available commodities"
                ]
            }
        ]
    },
    {
        version: "v1.0.0",
        date: "January 2026",
        title: "Initial Release",
        tag: "LAUNCH",
        tagColor: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
        description: "BenchmarkWatcher launches with daily commodity benchmark tracking.",
        sections: [
            {
                header: "Features",
                points: [
                    "30+ commodities across energy, precious metals, industrial metals, and agriculture",
                    "Daily end-of-day prices from EIA, FRED, and World Bank",
                    "Historical charts and price change tracking",
                    "Multiple themes: Light, Dark, Bloomberg, FT, and Monochrome",
                    "Responsive design for desktop and mobile",
                    "Open source on GitHub"
                ]
            }
        ]
    }
];
