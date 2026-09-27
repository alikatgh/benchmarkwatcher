(function () {
    'use strict';
    const chat = document.querySelector('.studio-chat-form');
    if (chat) {
        const question = chat.querySelector('#question');
        const send = chat.querySelector('[type=submit]');
        const status = chat.querySelector('.studio-chat-status');
        chat.querySelectorAll('[data-chat-question]').forEach(example => {
            example.addEventListener('click', () => {
                question.value = example.dataset.chatQuestion;
                question.focus();
            });
        });
        chat.addEventListener('submit', event => {
            if (send.disabled) { event.preventDefault(); return; }
            send.disabled = true;
            status.textContent = 'Sending to your provider… Your saved answer will open when ready.';
            status.hidden = false;
        });
        window.addEventListener('pageshow', () => {
            send.disabled = false;
            status.hidden = true;
        });
    }
    const provider = document.getElementById('provider-model');
    const explanation = document.getElementById('studio-explanation');
    if (provider && explanation) {
        const updateProvider = () => {
            const enabled = provider.value.startsWith('deepseek:');
            explanation.hidden = !enabled;
            explanation.querySelector('input').disabled = !enabled;
        };
        provider.addEventListener('change', updateProvider);
        updateProvider();
    }
    const operation = document.getElementById('operation');
    if (!operation || !document.querySelector('.manual-form')) return;
    const update = () => {
        const compare = operation.value === 'change', one = operation.value === 'value';
        document.getElementById('studio-periods').hidden = !compare && !one;
        document.getElementById('studio-from-field').hidden = !compare;
        document.getElementById('start').disabled = !compare;
        const start = document.getElementById('start'), end = document.getElementById('end');
        end.disabled = !compare && !one;
        const frequency = start.selectedOptions[0]?.dataset.frequency;
        for (const option of end.options) option.disabled = compare && (option.value === start.value || option.dataset.frequency !== frequency);
        if (compare && end.selectedOptions[0]?.disabled) {
            const available = Array.from(end.options).filter(option => !option.disabled);
            end.value = available.at(-1)?.value || '';
        }
        end.required = compare || one;
        end.setCustomValidity(compare && !end.value ? 'This workbook has no second period of the same frequency to compare.' : '');
        document.getElementById('studio-calculation-help').textContent = compare
            ? 'Compare two quarters or two annual periods. Includes the difference and relative change where available.'
            : one ? 'Return the saved value for the selected reporting period.' : 'Include every available reporting period in this saved workbook.';
    };
    operation.addEventListener('change', update);
    document.getElementById('start').addEventListener('change', update);
    window.addEventListener('pageshow', update);
    update();
})();
