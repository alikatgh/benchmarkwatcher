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
    // Initialize view mode
    init: function () {
        const viewMode = BW.Settings.getViewMode();

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
document.addEventListener('DOMContentLoaded', function () {
    BW.Index.init();
});
