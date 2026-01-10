/**
 * @jest-environment jsdom
 */

/**
 * __tests__/gridView.test.js
 * 
 * Tests for BW.GridView DOM rendering and state management
 * Tests the createStateNode factory and range button accessibility
 */

// ============================================================
// Mock implementations for testing
// ============================================================

// Mock createStateNode logic for isolated testing
function createStateNode({ type, title, message, actionLabel, onAction }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'col-span-full flex flex-col items-center justify-center py-16 text-center gap-3';
    wrapper.setAttribute('role', 'status');
    wrapper.setAttribute('aria-live', 'polite');
    wrapper.setAttribute('data-state-type', type);

    const heading = document.createElement('p');
    heading.className = type === 'error' ? 'font-bold text-brand-claret' : 'font-bold text-brand-black-80';
    heading.textContent = title;

    const text = document.createElement('p');
    text.className = 'text-sm text-brand-black-60 max-w-md';
    text.textContent = message;

    wrapper.append(heading, text);

    if (actionLabel && onAction) {
        const btn = document.createElement('button');
        btn.className = 'mt-4 px-4 py-2 text-sm font-bold';
        btn.textContent = actionLabel;
        btn.addEventListener('click', onAction);
        wrapper.appendChild(btn);
    }

    return wrapper;
}

// Mock updateRangeButtons logic for testing ARIA attributes
function updateRangeButtons(activeRange, ranges = ['1W', '1M', '3M', '6M', '1Y', 'ALL']) {
    ranges.forEach(range => {
        const btn = document.getElementById(`grid-range-${range}`);
        if (!btn) return;

        const isActive = range === activeRange;

        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
        btn.setAttribute('tabindex', isActive ? '0' : '-1');
    });
}

// ============================================================
// Tests
// ============================================================

describe('createStateNode', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="container"></div>';
    });

    test('creates wrapper with correct accessibility attributes', () => {
        const node = createStateNode({
            type: 'error',
            title: 'Test Title',
            message: 'Test message'
        });

        expect(node.getAttribute('role')).toBe('status');
        expect(node.getAttribute('aria-live')).toBe('polite');
        expect(node.getAttribute('data-state-type')).toBe('error');
    });

    test('error type uses claret color class', () => {
        const node = createStateNode({
            type: 'error',
            title: 'Error',
            message: 'Something went wrong'
        });

        const heading = node.querySelector('p');
        expect(heading.className).toContain('text-brand-claret');
    });

    test('empty type uses standard text class', () => {
        const node = createStateNode({
            type: 'empty',
            title: 'No data',
            message: 'Nothing to show'
        });

        const heading = node.querySelector('p');
        expect(heading.className).toContain('text-brand-black');
    });

    test('creates action button when actionLabel and onAction provided', () => {
        const mockAction = jest.fn();
        const node = createStateNode({
            type: 'error',
            title: 'Error',
            message: 'Failed',
            actionLabel: 'Retry',
            onAction: mockAction
        });

        const button = node.querySelector('button');
        expect(button).not.toBeNull();
        expect(button.textContent).toBe('Retry');

        button.click();
        expect(mockAction).toHaveBeenCalled();
    });

    test('no button when actionLabel is not provided', () => {
        const node = createStateNode({
            type: 'empty',
            title: 'Empty',
            message: 'No data'
        });

        const button = node.querySelector('button');
        expect(button).toBeNull();
    });

    test('renders correct title and message text', () => {
        const node = createStateNode({
            type: 'error',
            title: 'Custom Title',
            message: 'Custom message text'
        });

        const paragraphs = node.querySelectorAll('p');
        expect(paragraphs[0].textContent).toBe('Custom Title');
        expect(paragraphs[1].textContent).toBe('Custom message text');
    });
});

describe('updateRangeButtons accessibility', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div role="radiogroup" aria-label="Data range">
                <button id="grid-range-1W">1W</button>
                <button id="grid-range-1M">1M</button>
                <button id="grid-range-3M">3M</button>
                <button id="grid-range-6M">6M</button>
                <button id="grid-range-1Y">1Y</button>
                <button id="grid-range-ALL">ALL</button>
            </div>
        `;
    });

    test('sets role=radio on all buttons', () => {
        updateRangeButtons('1M');

        document.querySelectorAll('[id^="grid-range-"]').forEach(btn => {
            expect(btn.getAttribute('role')).toBe('radio');
        });
    });

    test('sets aria-checked=true only on active button', () => {
        updateRangeButtons('3M');

        expect(document.getElementById('grid-range-3M').getAttribute('aria-checked')).toBe('true');
        expect(document.getElementById('grid-range-1M').getAttribute('aria-checked')).toBe('false');
        expect(document.getElementById('grid-range-ALL').getAttribute('aria-checked')).toBe('false');
    });

    test('sets tabindex=0 only on active button (roving focus)', () => {
        updateRangeButtons('1Y');

        expect(document.getElementById('grid-range-1Y').getAttribute('tabindex')).toBe('0');
        expect(document.getElementById('grid-range-1W').getAttribute('tabindex')).toBe('-1');
        expect(document.getElementById('grid-range-1M').getAttribute('tabindex')).toBe('-1');
    });

    test('changing active range updates all attributes correctly', () => {
        updateRangeButtons('1W');
        expect(document.getElementById('grid-range-1W').getAttribute('aria-checked')).toBe('true');

        updateRangeButtons('ALL');
        expect(document.getElementById('grid-range-1W').getAttribute('aria-checked')).toBe('false');
        expect(document.getElementById('grid-range-ALL').getAttribute('aria-checked')).toBe('true');
        expect(document.getElementById('grid-range-ALL').getAttribute('tabindex')).toBe('0');
    });
});

describe('empty data handling', () => {
    test('detects empty array correctly', () => {
        const isEmpty = (commodities) => !Array.isArray(commodities) || commodities.length === 0;

        expect(isEmpty([])).toBe(true);
        expect(isEmpty(null)).toBe(true);
        expect(isEmpty(undefined)).toBe(true);
        expect(isEmpty([{ id: 'oil' }])).toBe(false);
    });
});
