/**
 * BenchmarkWatcher - Index Page Component (merged/improved)
 * - Shows/hides view containers (#grid-view / #compact-view)
 * - Updates button states (#view-grid / #view-compact) with data-active + aria-pressed
 * 
 * NOTE: Do not access localStorage directly.
 * Use BW.Settings exclusively.
 * 
 * COUPLING NOTE: view-mode is written by SettingsModal and consumed here on page load.
 * GridView is intentionally stateless regarding view mode (separation of concerns).
 */

window.BW = window.BW || {};

BW.Index = {
    normalizeViewMode: function (value) {
        return value === 'grid' || value === 'compact' ? value : null;
    },

    // Initialize view mode
    init: function () {
        // R2: Auto-detect device class and view mode on first visit
        if (window.BW && BW.Responsive) {
            BW.Responsive.autoApply();
        }

        const serverView = this.normalizeViewMode(document.getElementById('index-page-state')?.dataset?.activeView);
        const storedView = this.normalizeViewMode(BW.Settings.getViewMode());
        const params = new URLSearchParams(window.location.search);
        const explicitView = this.normalizeViewMode(params.get('view'));

        // If server and client preference diverge without explicit view param,
        // reload once with preferred view so the server renders the right markup.
        if (
            window.location.pathname === '/' &&
            !explicitView &&
            !!serverView &&
            !!storedView &&
            serverView !== storedView
        ) {
            const redirectUrl = new URL(window.location.href);
            redirectUrl.searchParams.set('view', storedView);
            window.location.replace(redirectUrl.toString());
            return;
        }

        const viewMode = explicitView || serverView || storedView || 'grid';
        BW.Settings.setViewMode(viewMode);

        // View containers (show/hide the active view)
        const gridContainer = document.getElementById('grid-view');
        const compactContainer = document.getElementById('compact-view');
        const indicator = document.getElementById('view-indicator');

        // Show correct container, hide the other
        if (viewMode === 'compact') {
            if (gridContainer) gridContainer.classList.add('hidden');
            if (compactContainer) compactContainer.classList.remove('hidden');
            if (indicator) indicator.textContent = 'Display: Compact';
        } else {
            if (gridContainer) gridContainer.classList.remove('hidden');
            if (compactContainer) compactContainer.classList.add('hidden');
            if (indicator) indicator.textContent = 'Display: Standard Grid';
        }

        // View toggle buttons (in settings modal)
        const gridBtn = document.getElementById('view-grid');
        const compactBtn = document.getElementById('view-compact');

        // Apply accessible state attributes so CSS can style active state
        if (gridBtn) {
            if (viewMode === 'grid') {
                gridBtn.setAttribute('data-active', 'true');
                gridBtn.setAttribute('aria-pressed', 'true');
            } else {
                gridBtn.removeAttribute('data-active');
                gridBtn.setAttribute('aria-pressed', 'false');
            }
        }
        if (compactBtn) {
            if (viewMode === 'compact') {
                compactBtn.setAttribute('data-active', 'true');
                compactBtn.setAttribute('aria-pressed', 'true');
            } else {
                compactBtn.removeAttribute('data-active');
                compactBtn.setAttribute('aria-pressed', 'false');
            }
        }

        // Attach click handlers defensively (only if not already bound via onclick)
        if (gridBtn && !gridBtn.hasAttribute('data-click-bound') && !gridBtn.hasAttribute('onclick')) {
            gridBtn.addEventListener('click', () => {
                BW.Settings.setViewMode('grid');
                if (window.location.pathname === '/') window.location.reload();
            });
            gridBtn.setAttribute('data-click-bound', 'true');
        }
        if (compactBtn && !compactBtn.hasAttribute('data-click-bound') && !compactBtn.hasAttribute('onclick')) {
            compactBtn.addEventListener('click', () => {
                BW.Settings.setViewMode('compact');
                if (window.location.pathname === '/') window.location.reload();
            });
            compactBtn.setAttribute('data-click-bound', 'true');
        }
    }
};

// Auto-initialize on DOM ready
if (!window.__bwIndexDomReadyBound) {
    window.__bwIndexDomReadyBound = true;
    const runIndexInit = function () {
        BW.Index.init();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runIndexInit);
    } else {
        runIndexInit();
    }
}
