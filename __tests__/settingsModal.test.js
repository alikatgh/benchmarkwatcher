/**
 * @jest-environment jsdom
 */

/**
 * __tests__/settingsModal.test.js
 * 
 * Tests for settings modal accessibility and focus management
 */

// ============================================================
// Mock implementations for testing
// ============================================================

// Track modal state
let modalOpen = false;
let previousFocus = null;

// Simulate modal toggle logic
function toggleModal() {
    const modal = document.getElementById('settings-modal');
    const mainContent = document.getElementById('main-content');
    if (!modal) return;

    modalOpen = !modalOpen;

    if (modalOpen) {
        previousFocus = document.activeElement;
        modal.removeAttribute('aria-hidden');
        modal.classList.remove('opacity-0');
        modal.classList.add('opacity-100');
        document.body.style.overflow = 'hidden';
        if (mainContent) mainContent.setAttribute('aria-hidden', 'true');
    } else {
        modal.setAttribute('aria-hidden', 'true');
        modal.classList.remove('opacity-100');
        modal.classList.add('opacity-0');
        document.body.style.overflow = '';
        if (mainContent) mainContent.removeAttribute('aria-hidden');
        if (previousFocus && typeof previousFocus.focus === 'function') {
            previousFocus.focus();
        }
    }
}

// Reset state
function resetModalState() {
    modalOpen = false;
    previousFocus = null;
}

// ============================================================
// Tests
// ============================================================

describe('Settings modal accessibility', () => {
    beforeEach(() => {
        resetModalState();
        document.body.innerHTML = `
            <button id="open-settings">Open Settings</button>
            <main id="main-content">
                <h1>Main content</h1>
            </main>
            <div id="settings-modal" 
                 aria-hidden="true" 
                 aria-modal="true"
                 role="dialog"
                 class="opacity-0 pointer-events-none">
                <button id="first-focusable">First</button>
                <button id="last-focusable">Last</button>
            </div>
        `;
        document.body.style.overflow = '';
    });

    test('modal starts with aria-hidden=true', () => {
        const modal = document.getElementById('settings-modal');
        expect(modal.getAttribute('aria-hidden')).toBe('true');
    });

    test('opening removes aria-hidden from modal', () => {
        toggleModal();
        const modal = document.getElementById('settings-modal');
        expect(modal.hasAttribute('aria-hidden')).toBe(false);
    });

    test('opening sets aria-hidden on main content', () => {
        toggleModal();
        const main = document.getElementById('main-content');
        expect(main.getAttribute('aria-hidden')).toBe('true');
    });

    test('opening locks body scroll', () => {
        toggleModal();
        expect(document.body.style.overflow).toBe('hidden');
    });

    test('closing sets aria-hidden=true on modal', () => {
        toggleModal(); // open
        toggleModal(); // close
        const modal = document.getElementById('settings-modal');
        expect(modal.getAttribute('aria-hidden')).toBe('true');
    });

    test('closing restores body scroll', () => {
        toggleModal(); // open
        toggleModal(); // close
        expect(document.body.style.overflow).toBe('');
    });

    test('closing removes aria-hidden from main content', () => {
        toggleModal(); // open
        toggleModal(); // close
        const main = document.getElementById('main-content');
        expect(main.hasAttribute('aria-hidden')).toBe(false);
    });

    test('focus is restored after closing', () => {
        const triggerBtn = document.getElementById('open-settings');
        triggerBtn.focus();

        toggleModal(); // open (saves focus)
        document.getElementById('first-focusable').focus();

        toggleModal(); // close (should restore focus)

        expect(document.activeElement).toBe(triggerBtn);
    });

    test('modal has role=dialog', () => {
        const modal = document.getElementById('settings-modal');
        expect(modal.getAttribute('role')).toBe('dialog');
    });

    test('modal has aria-modal=true', () => {
        const modal = document.getElementById('settings-modal');
        expect(modal.getAttribute('aria-modal')).toBe('true');
    });
});

describe('View button toggle state', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <button id="view-grid">Grid</button>
            <button id="view-compact">Compact</button>
        `;
    });

    function updateViewButtons(activeView) {
        ['grid', 'compact'].forEach(v => {
            const btn = document.getElementById(`view-${v}`);
            if (!btn) return;
            const isActive = v === activeView;
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            btn.setAttribute('aria-label', v === 'grid' ? 'Standard grid view' : 'Compact table view');
            if (isActive) {
                btn.setAttribute('data-active', 'true');
            } else {
                btn.removeAttribute('data-active');
            }
        });
    }

    test('active view has aria-pressed=true', () => {
        updateViewButtons('grid');
        expect(document.getElementById('view-grid').getAttribute('aria-pressed')).toBe('true');
        expect(document.getElementById('view-compact').getAttribute('aria-pressed')).toBe('false');
    });

    test('active view has data-active attribute', () => {
        updateViewButtons('compact');
        expect(document.getElementById('view-compact').hasAttribute('data-active')).toBe(true);
        expect(document.getElementById('view-grid').hasAttribute('data-active')).toBe(false);
    });

    test('buttons have descriptive aria-labels', () => {
        updateViewButtons('grid');
        expect(document.getElementById('view-grid').getAttribute('aria-label')).toBe('Standard grid view');
        expect(document.getElementById('view-compact').getAttribute('aria-label')).toBe('Compact table view');
    });
});
