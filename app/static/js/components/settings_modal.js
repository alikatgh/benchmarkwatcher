/**
 * BenchmarkWatcher - Settings Modal Component
 * Handles theme switching, view mode, and settings modal interactions
 */

window.BW = window.BW || {};

BW.SettingsModal = {
    previouslyFocused: null,

    // Stable handler reference for proper removeEventListener
    _boundHandleKeydown: function (e) { BW.SettingsModal.handleKeydown(e); },

    // Toggle modal visibility with full accessibility support
    toggle: function () {
        const modal = document.getElementById('settings-modal');
        if (!modal) return;

        const content = modal.querySelector('div');
        const mainContent = document.getElementById('main-content') || document.querySelector('main');
        const triggerBtn = document.getElementById('settings-button');
        const isClosed = modal.classList.contains('opacity-0');

        if (isClosed) {
            // Opening - save current focus
            this.previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            modal.classList.remove('opacity-0', 'pointer-events-none');
            modal.classList.add('opacity-100', 'pointer-events-auto');
            if (content) {
                content.classList.remove('scale-95');
                content.classList.add('scale-100');
            }
            // Modal is now visible to assistive tech
            modal.removeAttribute('aria-hidden');
            // Lock body scroll
            document.body.style.overflow = 'hidden';
            // Hide main content from assistive tech while modal is open
            if (mainContent) {
                try { mainContent.setAttribute('aria-hidden', 'true'); } catch (e) { /* ignore */ }
            }
            // Update trigger button aria-expanded
            if (triggerBtn) {
                try { triggerBtn.setAttribute('aria-expanded', 'true'); } catch (e) { /* ignore */ }
            }

            // Focus first focusable element (comprehensive selector)
            setTimeout(() => {
                const selector = 'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable]';
                const focusable = Array.from(modal.querySelectorAll(selector)).filter(el => el.offsetParent !== null);
                if (focusable.length) {
                    focusable[0].focus();
                } else {
                    // fallback: focus modal itself
                    modal.setAttribute('tabindex', '-1');
                    modal.focus();
                }
            }, 100);

            // Add escape/tab listener (stable reference)
            document.addEventListener('keydown', this._boundHandleKeydown);
        } else {
            // Closing - restore focus
            modal.classList.remove('opacity-100', 'pointer-events-auto');
            modal.classList.add('opacity-0', 'pointer-events-none');
            if (content) {
                content.classList.remove('scale-100');
                content.classList.add('scale-95');
            }
            // Modal is now hidden from assistive tech
            modal.setAttribute('aria-hidden', 'true');
            // Restore body scroll
            document.body.style.overflow = '';
            // Restore main content visibility to assistive tech
            if (mainContent) {
                try { mainContent.removeAttribute('aria-hidden'); } catch (e) { /* ignore */ }
            }
            // Update trigger button aria-expanded
            if (triggerBtn) {
                try { triggerBtn.setAttribute('aria-expanded', 'false'); } catch (e) { /* ignore */ }
            }

            // Remove escape key listener
            document.removeEventListener('keydown', this._boundHandleKeydown);

            // Return focus to trigger element (safe)
            try {
                if (this.previouslyFocused && typeof this.previouslyFocused.focus === 'function') {
                    this.previouslyFocused.focus();
                }
            } catch (e) {
                // element may have been removed — ignore
            }
        }
    },

    // Handle keyboard events (Escape to close, Tab trap) - improved and guarded
    handleKeydown: function (e) {
        const modal = document.getElementById('settings-modal');
        if (!modal || modal.classList.contains('opacity-0')) return;

        // Escape key closes modal
        if (e.key === 'Escape') {
            e.preventDefault();
            BW.SettingsModal.toggle();
            return;
        }

        // Tab key - trap focus within modal (comprehensive selector, guarded)
        if (e.key === 'Tab') {
            const selector = 'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable]';
            const focusableEls = Array.from(modal.querySelectorAll(selector)).filter(el => el.offsetParent !== null);
            if (focusableEls.length === 0) {
                // nothing focusable inside — prevent leaving modal
                e.preventDefault();
                modal.setAttribute('tabindex', '-1');
                modal.focus();
                return;
            }
            const firstEl = focusableEls[0];
            const lastEl = focusableEls[focusableEls.length - 1];

            if (e.shiftKey && document.activeElement === firstEl) {
                e.preventDefault();
                lastEl.focus();
            } else if (!e.shiftKey && document.activeElement === lastEl) {
                e.preventDefault();
                firstEl.focus();
            }
        }
    },

    // Set theme
    setTheme: function (mode) {
        try {
            localStorage.setItem('theme', mode);
        } catch (e) { /* localStorage unavailable */ }
        this.applyTheme();
        this.updateUI();
    },

    // Set view mode
    setView: function (mode) {
        try {
            localStorage.setItem('view-mode', mode);
        } catch (e) { /* localStorage unavailable */ }
        this.updateUI();
        if (window.location.pathname === '/') {
            window.location.reload();
        } else {
            this.toggle();
        }
    },

    // Apply theme to document
    applyTheme: function () {
        let theme = 'light';
        try {
            theme = localStorage.getItem('theme') || 'light';
        } catch (e) { /* localStorage unavailable */ }
        document.documentElement.setAttribute('data-theme', theme);

        // Add dark class for Tailwind dark: utilities
        if (theme === 'dark' || theme === 'mono-dark' || theme === 'bloomberg') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    },

    // Update settings UI to reflect current state (attribute-based active styling)
    updateUI: function () {
        // Use BW.Settings exclusively - no direct localStorage access
        const theme = BW.Settings.getTheme();
        const view = BW.Settings.getViewMode();
        const market = BW.Settings.getMarketTheme();

        // Update Theme Buttons (attribute-based active state - CSS handles styling)
        ['light', 'dark', 'mono-light', 'mono-dark', 'bloomberg', 'ft'].forEach(m => {
            const btn = document.getElementById(`theme-${m}`);
            if (btn) {
                if (m === theme) {
                    btn.setAttribute('data-active', 'true');
                    btn.setAttribute('aria-pressed', 'true');
                } else {
                    btn.removeAttribute('data-active');
                    btn.setAttribute('aria-pressed', 'false');
                }
            }
        });

        // Update Market Theme Buttons (attribute-based active state)
        ['western', 'asian', 'monochrome'].forEach(m => {
            const btn = document.getElementById(`market-${m}`);
            if (btn) {
                if (m === market) {
                    btn.setAttribute('data-active', 'true');
                    btn.setAttribute('aria-pressed', 'true');
                } else {
                    btn.removeAttribute('data-active');
                    btn.setAttribute('aria-pressed', 'false');
                }
            }
        });

        // Update View Buttons (attribute-based active state + aria-label for clarity)
        ['grid', 'compact'].forEach(v => {
            const btn = document.getElementById(`view-${v}`);
            if (btn) {
                const isActive = v === view;
                if (isActive) {
                    btn.setAttribute('data-active', 'true');
                    btn.setAttribute('aria-pressed', 'true');
                } else {
                    btn.removeAttribute('data-active');
                    btn.setAttribute('aria-pressed', 'false');
                }
                // Descriptive label for screen readers
                btn.setAttribute('aria-label', v === 'grid' ? 'Standard grid view' : 'Compact table view');
            }
        });
    },

    // Initialize on page load
    init: function () {
        this.applyTheme();
        this.updateUI();
    }
};

// Global function aliases for onclick handlers
function toggleSettings() { BW.SettingsModal.toggle(); }
function setTheme(m) { BW.SettingsModal.setTheme(m); }
function setView(m) { BW.SettingsModal.setView(m); }

// Auto-initialize on DOM ready
document.addEventListener('DOMContentLoaded', function () {
    // Only init if settings modal exists on page
    if (document.getElementById('settings-modal')) {
        BW.SettingsModal.init();
    }
});
