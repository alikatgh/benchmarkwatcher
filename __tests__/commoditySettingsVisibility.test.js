/**
 * @jest-environment jsdom
 */

function applyCrosshairPanelVisibility(settings) {
    const crosshairFields = {
        'crosshair-date': settings.showCrosshairDate,
        'crosshair-price': settings.showCrosshairPrice,
        'crosshair-change': settings.showCrosshairChange,
    };

    Object.entries(crosshairFields).forEach(([id, show]) => {
        const el = document.getElementById(id);
        if (el && el.parentElement) {
            el.parentElement.style.display = show ? '' : 'none';
        }
    });

    const crosshairInfo = document.getElementById('crosshair-info');
    const showAnyCrosshairField = settings.showCrosshairDate || settings.showCrosshairPrice || settings.showCrosshairChange;
    if (crosshairInfo) {
        if (!showAnyCrosshairField) {
            crosshairInfo.classList.add('hidden');
        } else {
            crosshairInfo.classList.remove('hidden');
        }
    }
}

describe('Commodity crosshair panel visibility', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="crosshair-info" class="hidden">
                <div><span id="crosshair-date"></span></div>
                <div><span id="crosshair-price"></span></div>
                <div><span id="crosshair-change"></span></div>
            </div>
        `;
    });

    test('shows panel when at least one field is enabled', () => {
        applyCrosshairPanelVisibility({
            showCrosshairDate: true,
            showCrosshairPrice: false,
            showCrosshairChange: false,
        });

        expect(document.getElementById('crosshair-info').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('crosshair-date').parentElement.style.display).toBe('');
        expect(document.getElementById('crosshair-price').parentElement.style.display).toBe('none');
    });

    test('hides panel when all fields are disabled', () => {
        applyCrosshairPanelVisibility({
            showCrosshairDate: false,
            showCrosshairPrice: false,
            showCrosshairChange: false,
        });

        expect(document.getElementById('crosshair-info').classList.contains('hidden')).toBe(true);
    });

    test('re-shows panel after being hidden when a field is re-enabled', () => {
        applyCrosshairPanelVisibility({
            showCrosshairDate: false,
            showCrosshairPrice: false,
            showCrosshairChange: false,
        });
        expect(document.getElementById('crosshair-info').classList.contains('hidden')).toBe(true);

        applyCrosshairPanelVisibility({
            showCrosshairDate: false,
            showCrosshairPrice: true,
            showCrosshairChange: false,
        });
        expect(document.getElementById('crosshair-info').classList.contains('hidden')).toBe(false);
    });
});
