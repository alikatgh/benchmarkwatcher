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
    const canvas = document.getElementById('studio-analysis-canvas');
    const steps = canvas?.querySelector('.studio-analysis-steps');
    const pageContent = document.getElementById('studio-page-content');
    const originalURL = location.href;
    const workspaceMode = document.querySelector('.workspace')?.dataset.workspaceMode;
    let latestAnalysisURL = null;
    const showCanvas = () => {
        if (!canvas) return;
        canvas.hidden = false;
        if (pageContent) pageContent.hidden = true;
        if (latestAnalysisURL && ['model', 'analysis'].includes(workspaceMode)) {
            history.replaceState(history.state, '', latestAnalysisURL);
        }
    };
    const revealAnalysis = id => {
        const step = Array.from(steps?.querySelectorAll('.studio-analysis-step') || []).find(el => el.dataset.analysisId === id);
        if (!step) return false;
        latestAnalysisURL = step.dataset.analysisUrl;
        showCanvas();
        steps.querySelectorAll('.studio-analysis-step[open]').forEach(el => { if (el !== step) el.open = false; });
        step.open = true;
        step.scrollIntoView({ block: 'start' });
        return true;
    };
    canvas?.querySelector('[data-workspace-controls]')?.addEventListener('click', event => {
        event.preventDefault();
        canvas.hidden = true;
        pageContent.hidden = false;
        history.replaceState(history.state, '', originalURL);
        pageContent.scrollIntoView({ block: 'start' });
    });
    dock?.querySelector('[data-show-analysis]')?.addEventListener('click', () => {
        showCanvas();
        if (window.matchMedia('(max-width: 1000px)').matches && !body.hidden) toggle.click();
        const last = steps?.lastElementChild;
        if (last) {
            if (last.tagName === 'DETAILS') revealAnalysis(last.dataset.analysisId);
            else last.scrollIntoView({ block: 'start' });
        }
    });
    dock?.addEventListener('click', event => {
        const link = event.target.closest('[data-analysis-link]');
        if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && revealAnalysis(link.dataset.analysisLink)) event.preventDefault();
    });
    if (messages) {
        const lastAnswer = messages.querySelector('.studio-chat-answer:last-of-type');
        messages.scrollTop = Math.max(0, (lastAnswer?.previousElementSibling?.offsetTop || 0) - 16);
    }
    if (chat && messages) {
        const question = chat.querySelector('#question');
        const send = chat.querySelector('[type=submit]');
        const status = chat.querySelector('.studio-chat-status');
        const context = chat.querySelector('[name=context_analysis_id]');
        const consent = chat.querySelector('[name=consent]');
        const dialog = chat.querySelector('.studio-consent-dialog');
        let permissions = JSON.parse(chat.dataset.permissions || '[]');
        let pending = false;
        const resize = () => {
            question.style.height = 'auto';
            question.style.height = Math.min(144, Math.max(64, question.scrollHeight)) + 'px';
        };
        question.addEventListener('input', resize);
        const follow = answer => {
            if (answer && context) {
                context.value = answer.dataset.analysisId;
                chat.querySelector('.studio-chat-context-hint').textContent = 'Following ' + answer.dataset.metric;
                chat.querySelector('.studio-new-topic').hidden = false;
            }
        };
        chat.querySelector('.studio-new-topic')?.addEventListener('click', () => {
            context.value = '';
            chat.querySelector('.studio-chat-context-hint').textContent = 'New topic · Name a workbook metric';
            chat.querySelector('.studio-new-topic').hidden = true;
            question.focus();
        });
        (dock || chat).addEventListener('click', async event => {
            const example = event.target.closest('[data-chat-question]');
            if (example && !pending) {
                question.value = example.dataset.chatQuestion;
                follow(example.closest('.studio-chat-answer'));
                resize();
                question.focus();
            }
            const copy = event.target.closest('.studio-copy-answer');
            if (copy) {
                try {
                    const answer = copy.closest('.studio-chat-answer');
                    const text = [answer.querySelector('h3')?.textContent, answer.querySelector('.studio-answer-values')?.innerText,
                        answer.querySelector('.explanation')?.innerText, answer.querySelector('.studio-answer-change')?.textContent,
                        answer.querySelector('.studio-chat-result')?.href].filter(Boolean).join('\n\n');
                    await navigator.clipboard.writeText(text);
                    status.textContent = 'Answer copied.';
                } catch (_) { status.textContent = 'Could not copy. Select the answer text to copy it.'; }
                status.hidden = false;
            }
        });
        if (dialog && typeof dialog.showModal === 'function') {
            consent.required = false;
            chat.querySelector('.studio-chat-consent-fallback').hidden = true;
            dialog.querySelector('[data-consent-cancel]').addEventListener('click', () => dialog.close());
            dialog.querySelector('[data-consent-send]').addEventListener('click', () => {
                consent.checked = true;
                dialog.close();
                chat.requestSubmit();
            });
        }
        question.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !pending) {
                event.preventDefault();
                chat.requestSubmit();
            }
        });
        chat.addEventListener('submit', async event => {
            event.preventDefault();
            if (pending || !chat.reportValidity()) return;
            const provider = chat.querySelector('[name=provider_model]');
            const explains = chat.querySelector('[name=explain]')?.checked;
            const explanationModel = explains ? chat.querySelector('[name=explanation_model]').value : '';
            const scope = [chat.dataset.workbook, provider.value, explanationModel].join('|');
            if (!consent.checked && !permissions.includes(scope)) {
                const label = provider.selectedOptions[0].textContent;
                dialog.querySelector('.studio-sharing-description').textContent =
                    'Send your question, workbook row and period labels, and previous metric selection to ' + label + '.' +
                    (explains ? ' Also send selected cell values and calculated results to DeepSeek (' + explanationModel + ') for a written explanation.' : ' Cell values stay in BenchmarkWatcher.');
                dialog.querySelector('[name=remember_consent]').checked = false;
                dialog.showModal();
                return;
            }
            const payload = new FormData(chat);
            pending = true;
            const controls = Array.from(chat.querySelectorAll('input, textarea, select, button')).filter(el => !el.disabled);
            controls.forEach(el => { el.disabled = true; });
            chat.querySelector('.studio-chat-options')?.removeAttribute('open');
            messages.querySelectorAll('.studio-chat-welcome, .studio-chat-example, .studio-chat-failed').forEach(el => el.remove());
            const turn = document.createElement('div');
            const user = document.createElement('article');
            user.className = 'studio-chat-message studio-chat-question';
            user.setAttribute('aria-label', 'Your message');
            const text = document.createElement('p');
            text.textContent = question.value;
            user.append(text);
            const waiting = document.createElement('p');
            waiting.className = 'studio-chat-pending';
            waiting.textContent = explains ? 'Selecting workbook data and preparing the explanation…' : 'Selecting and calculating workbook data…';
            turn.append(user, waiting);
            messages.append(turn);
            let pendingAnalysis = null;
            if (steps) {
                showCanvas();
                steps.querySelectorAll('.studio-analysis-failed').forEach(el => el.remove());
                steps.querySelectorAll('.studio-analysis-step[open]').forEach(el => { el.open = false; });
                pendingAnalysis = document.createElement('article');
                pendingAnalysis.className = 'studio-analysis-pending';
                const heading = document.createElement('h2');
                heading.textContent = question.value;
                const progress = document.createElement('p');
                progress.textContent = 'Working on this question… The result will appear here.';
                pendingAnalysis.append(heading, progress);
                steps.append(pendingAnalysis);
                canvas.setAttribute('aria-busy', 'true');
                dock.querySelector('[data-show-analysis]').hidden = false;
                pendingAnalysis.scrollIntoView({ block: 'start' });
            }
            messages.setAttribute('aria-busy', 'true');
            messages.scrollTop = messages.scrollHeight;
            status.textContent = 'Waiting for your provider. You can keep reading the workbook.';
            status.hidden = false;
            try {
                const response = await fetch(chat.getAttribute('action'), { method: 'POST', body: payload,
                    headers: { Accept: 'application/json' }, credentials: 'same-origin' });
                if (!response.headers.get('content-type')?.includes('application/json')) {
                    throw new Error(response.status === 429 ? 'Too many requests. Wait a minute before sending again.' :
                        response.redirected || response.status === 400 ? 'Your session or form expired. Reload the page and sign in if needed. Your draft is still below.' :
                        'The server response was interrupted. Check your saved answers before retrying; this request may have completed.');
                }
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'The request failed. Your draft is still below.');
                if (!data.html || !data.id || !data.analysis_html) throw new Error('The reply could not be displayed. Check your saved answers before retrying.');
                // Only escaped, server-rendered markup from this authenticated origin.
                turn.innerHTML = data.html;
                if (pendingAnalysis) {
                    const rendered = document.createElement('template');
                    rendered.innerHTML = data.analysis_html;
                    pendingAnalysis.replaceWith(rendered.content);
                    window.BW?.VisualExplorer?.workbooks();
                    latestAnalysisURL = data.url;
                    revealAnalysis(data.id);
                    canvas.querySelector('.studio-canvas-status').textContent = 'Analysis updated with your latest answer.';
                }
                permissions = data.permissions || [];
                const answer = turn.querySelector('.studio-chat-answer');
                follow(answer);
                question.value = '';
                resize();
                messages.scrollTop = Math.max(0, turn.offsetTop - 16);
                status.textContent = 'Answer saved.';
            } catch (error) {
                turn.classList.add('studio-chat-failed');
                waiting.className = 'studio-chat-error';
                waiting.setAttribute('role', 'alert');
                waiting.textContent = error instanceof TypeError ?
                    'Connection interrupted. Check your saved answers before retrying; this request may have completed. Your draft is still below.' : error.message;
                const library = document.createElement('a');
                library.href = '/workspace/';
                library.textContent = 'Check saved answers';
                waiting.append(document.createElement('br'), library);
                if (pendingAnalysis) {
                    pendingAnalysis.classList.add('studio-analysis-failed');
                    pendingAnalysis.querySelector('p').textContent = 'This result is unavailable. Review the message in chat; your earlier analyses are still saved below their questions.';
                }
                status.textContent = 'Your draft has been kept. Review the message above before retrying.';
                messages.scrollTop = messages.scrollHeight;
            } finally {
                pending = false;
                consent.checked = false;
                controls.forEach(el => { el.disabled = false; });
                messages.setAttribute('aria-busy', 'false');
                canvas?.setAttribute('aria-busy', 'false');
                question.focus({ preventScroll: true });
            }
        });
        window.addEventListener('beforeunload', event => {
            if (pending) { event.preventDefault(); event.returnValue = ''; }
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
