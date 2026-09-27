(function () {
    'use strict';
    const dock = document.querySelector('.studio-chat');
    const toggle = document.getElementById('studio-chat-toggle');
    const body = document.getElementById('studio-chat-body');
    if (dock && toggle && body) {
        const storageKey = 'bw-workbook-chat-minimized:' + dock.dataset.chatUser;
        const setMinimized = minimized => {
            body.hidden = minimized;
            dock.classList.toggle('is-minimized', minimized);
            document.querySelector('.workspace')?.classList.toggle('chat-minimized', minimized);
            toggle.setAttribute('aria-expanded', String(!minimized));
            toggle.setAttribute('aria-label', minimized ? 'Open AI chat' : 'Minimize AI chat');
            toggle.textContent = minimized ? 'Open' : 'Minimize';
        };
        const restore = () => {
            try { setMinimized(localStorage.getItem(storageKey) === 'true'); }
            catch (_) { setMinimized(false); }
        };
        restore();
        window.addEventListener('pageshow', restore);
        toggle.addEventListener('click', () => {
            const minimized = !body.hidden;
            setMinimized(minimized);
            try { localStorage.setItem(storageKey, String(minimized)); } catch (_) { /* Storage can be unavailable. */ }
            if (!minimized) body.querySelector('#question')?.focus();
        });
        // On a narrow screen, choosing a source/workbook/settings link is an
        // explicit request to see the page behind this full-screen panel.
        dock.addEventListener('click', event => {
            if (event.target.closest('a') && window.matchMedia('(max-width: 1000px)').matches && !body.hidden) toggle.click();
        });
    }
    const chat = document.querySelector('.studio-chat-form');
    const messages = document.querySelector('.studio-chat-messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
    if (chat) {
        const question = chat.querySelector('#question');
        const send = chat.querySelector('[type=submit]');
        const status = chat.querySelector('.studio-chat-status');
        (dock || chat).querySelectorAll('[data-chat-question]').forEach(example => {
            example.addEventListener('click', () => {
                question.value = example.dataset.chatQuestion;
                question.focus();
            });
        });
        chat.addEventListener('submit', event => {
            if (send.disabled) { event.preventDefault(); return; }
            send.disabled = true;
            status.textContent = 'Waiting for your provider… Your answer will appear in this chat.';
            status.hidden = false;
        });
        window.addEventListener('pageshow', () => {
            send.disabled = false;
            status.hidden = true;
        });
    }
    const explanation = document.getElementById('studio-explanation');
    const explanationModel = document.getElementById('studio-explanation-model');
    const provider = document.getElementById('provider-model');
    const providerSummary = document.getElementById('studio-chat-provider-summary');
    const updateProviderSummary = () => {
        const label = provider?.selectedOptions[0]?.textContent || 'Provider options';
        if (providerSummary) providerSummary.textContent = label + (explanation?.querySelector('input').checked ? ' + explanation' : '');
    };
    provider?.addEventListener('change', updateProviderSummary);
    updateProviderSummary();
    if (explanation && explanationModel) {
        const updateExplanation = () => {
            const enabled = explanation.querySelector('input').checked;
            explanationModel.hidden = !enabled;
            explanationModel.querySelector('select').disabled = !enabled;
            const disclosure = document.querySelector('.studio-consent-explanation');
            if (disclosure) disclosure.hidden = !enabled;
            updateProviderSummary();
        };
        explanation.querySelector('input').addEventListener('change', updateExplanation);
        window.addEventListener('pageshow', updateExplanation);
        updateExplanation();
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
