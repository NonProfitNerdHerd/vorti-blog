'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { usePublicFetch, usePublicSitePath } from '../PublicSiteContext.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormRenderer } from './FormRenderer.js';
import { SavedDrafts } from './SavedDrafts.js';
import { SurveyResults } from './SurveyResults.js';
import { PaymentPanel } from './PaymentPanel.js';
/** Reusable public placement. Each instance owns its session and retry key. Answers are never put in browser storage. */
export function FormHost({ slug, embedded = false }) {
    return _jsx(FormInstance, { slug: slug, embedded: embedded }, slug);
}
function FormInstance({ slug, embedded }) {
    const publicFetch = usePublicFetch(), publicPath = usePublicSitePath();
    const [form, setForm] = useState(), [error, setError] = useState(''), [retry, setRetry] = useState(0);
    const [receipt, setReceipt] = useState(''), [receiptURL, setReceiptURL] = useState('');
    const [payment, setPayment] = useState('');
    const returnedPayment = useRef('');
    useEffect(() => () => { if (receiptURL)
        URL.revokeObjectURL(receiptURL); }, [receiptURL]);
    const retryKey = useRef('');
    const analyticsConsent = useRef(false);
    const consentChanged = useCallback((value) => { analyticsConsent.current = value; }, []);
    const holds = useRef({});
    const resumeToken = useRef(''), autosave = useRef(undefined);
    const pendingSave = useRef(Promise.resolve());
    const activeDraftID = useRef(undefined), revoking = useRef(false);
    const stopped = useRef(false);
    const [resumePath, setResumePath] = useState(''), [saveState, setSaveState] = useState('');
    const [resumeEmail, setResumeEmail] = useState(''), [emailBusy, setEmailBusy] = useState(false);
    useEffect(() => {
        const changed = () => {
            const token = new URLSearchParams(window.location.hash.slice(1)).get('payment');
            if (!token)
                return;
            returnedPayment.current = token;
            setPayment(token);
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        };
        window.addEventListener('hashchange', changed);
        return () => window.removeEventListener('hashchange', changed);
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        const params = new URLSearchParams(window.location.hash.slice(1)), token = params.get('resume');
        const paymentReturn = params.get('payment') || returnedPayment.current;
        if (paymentReturn) {
            returnedPayment.current = paymentReturn;
            setPayment(paymentReturn);
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
            return () => controller.abort();
        }
        if (token) {
            resumeToken.current = token;
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        const resumable = token || resumeToken.current;
        publicFetch(`/api/forms-runtime/${encodeURIComponent(slug)}${resumable ? '/resume' : ''}`, { signal: controller.signal, credentials: 'same-origin', ...(resumable ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resumable }) } : {}) }).then(async (response) => {
            const body = await response.json();
            if (!response.ok)
                throw new Error(body.message || 'Could not load this form.');
            if (controller.signal.aborted)
                return;
            activeDraftID.current = body.draftID;
            if (resumable && body.draftID) {
                resumeToken.current = body.resumeToken || resumable;
                setResumePath(new URL(publicPath(`/forms/${encodeURIComponent(slug)}#resume=${resumeToken.current}`), window.location.origin).href);
            }
            setForm(body);
            setReceipt('');
            setReceiptURL('');
            retryKey.current = crypto.randomUUID();
            holds.current = {};
            setError('');
        }).catch(error => { if (!controller.signal.aborted)
            setError(error.message); });
        return () => { controller.abort(); if (autosave.current)
            clearTimeout(autosave.current); };
    }, [slug, retry, publicFetch, publicPath]);
    const booking = useMemo(() => {
        if (!form)
            return undefined;
        async function request(field, operation) {
            const response = await publicFetch(`/api/forms-runtime/${encodeURIComponent(slug)}/booking`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Form-Session': form.session }, body: JSON.stringify({ revision: form.revision, field, ...operation }) });
            const result = await response.json();
            if (!response.ok)
                throw new Error(result.message || 'Could not update this reservation.');
            return result;
        }
        return {
            load: async (field, from, to) => (await request(field.id, { operation: 'list', from, to })).slots,
            reserve: async (field, path, slot) => {
                const selected = await request(field.id, { operation: 'hold', slot }), old = holds.current[path];
                holds.current[path] = { ...selected, field: field.id };
                // Keep the new reservation if releasing an earlier hold temporarily fails; the old hold expires.
                if (old)
                    await request(old.field, { operation: 'release', token: old.token }).catch(() => { });
                return selected;
            },
            release: async (_field, path) => { const old = holds.current[path]; if (old) {
                await request(old.field, { operation: 'release', token: old.token });
                delete holds.current[path];
            } },
            selected: path => holds.current[path],
        };
    }, [form, slug, publicFetch]);
    const analytics = useCallback((kind, metadata) => {
        if (!form || kind === 'accepted')
            return;
        void publicFetch('/api/forms-runtime/' + encodeURIComponent(slug) + '/analytics', {
            method: 'POST', credentials: 'same-origin', keepalive: true,
            headers: { 'Content-Type': 'application/json', 'X-Form-Session': form.session },
            body: JSON.stringify({ revision: form.revision, eventID: crypto.randomUUID(), kind, ...metadata }),
        }).catch(() => { });
    }, [form, slug]);
    const receiptControls = form && receipt && _jsxs("p", { children: [_jsx("button", { type: "button", onClick: async () => {
                    try {
                        const response = await publicFetch('/api/forms-runtime/' + encodeURIComponent(slug) + '/receipt', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Form-Session': form.session }, body: JSON.stringify({ revision: form.revision, receipt }) });
                        if (!response.ok)
                            throw new Error('The receipt could not be loaded. Please retry.');
                        setReceiptURL(URL.createObjectURL(await response.blob()));
                    }
                    catch (error) {
                        setSaveState(error.message);
                    }
                }, children: "Prepare printable receipt" }), receiptURL && _jsx("a", { href: receiptURL, target: "_blank", rel: "noopener noreferrer", children: "Open receipt / save as PDF" })] });
    if (error)
        return _jsxs("section", { "aria-label": "Form unavailable", children: [_jsx("p", { role: "alert", children: error }), _jsx("button", { type: "button", onClick: () => setRetry(n => n + 1), children: "Retry loading form" })] });
    if (payment)
        return _jsxs(_Fragment, { children: [_jsx(PaymentPanel, { token: payment }, payment), receiptControls, _jsx("p", { role: "status", children: saveState })] });
    if (!form)
        return _jsx("p", { role: "status", children: "Loading form\u2026" });
    const save = async (answers) => {
        const operation = pendingSave.current.catch(() => { }).then(async () => {
            if (stopped.current)
                return { message: 'This form has already been submitted.' };
            if (revoking.current)
                return { message: 'Wait for draft revocation to finish, then save your current answers.' };
            setSaveState('Saving progress…');
            const response = await publicFetch(`/api/forms-runtime/${encodeURIComponent(slug)}/progress`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Form-Session': form.session }, body: JSON.stringify({ revision: form.revision, answers, resumeToken: resumeToken.current || undefined }) });
            const body = await response.json();
            if (!response.ok) {
                setSaveState(body.message || 'Progress could not be saved.');
                throw new Error(body.message);
            }
            activeDraftID.current = body.draftID;
            resumeToken.current = body.resumeToken;
            setResumePath(new URL(publicPath(body.resumePath), window.location.origin).href);
            setSaveState('Progress saved.');
            return { message: body.message };
        });
        pendingSave.current = operation;
        return operation;
    };
    const revoke = async (id) => {
        revoking.current = true;
        if (autosave.current)
            clearTimeout(autosave.current);
        try {
            await pendingSave.current.catch(() => { });
            const response = await publicFetch(`/api/forms-runtime/${encodeURIComponent(slug)}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(id === undefined ? { token: resumeToken.current } : { id }) });
            const body = await response.json();
            if (!response.ok)
                throw new Error(body.message);
            if (id === undefined || id === activeDraftID.current) {
                activeDraftID.current = undefined;
                resumeToken.current = '';
                setResumePath('');
                setResumeEmail('');
                setSaveState('Saved draft revoked. Your current answers remain here; Save progress creates a new private draft.');
            }
            return body.message;
        }
        finally {
            revoking.current = false;
        }
    };
    return _jsxs("section", { children: [embedded ? _jsx("h2", { children: form.title }) : _jsx("h1", { children: form.title }), form.description && _jsx("p", { children: form.description }), _jsx(SavedDrafts, { slug: slug, refresh: resumePath, onRevoke: revoke, onResume: async (id) => {
                    if (!window.confirm('Resume this draft and replace the answers currently on this page?'))
                        return false;
                    if (autosave.current)
                        clearTimeout(autosave.current);
                    await pendingSave.current.catch(() => { });
                    const response = await publicFetch(`/api/forms-runtime/${encodeURIComponent(slug)}/resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
                    const body = await response.json();
                    if (!response.ok)
                        throw new Error(body.message);
                    activeDraftID.current = body.draftID;
                    resumeToken.current = body.resumeToken;
                    stopped.current = false;
                    setForm(body);
                    retryKey.current = crypto.randomUUID();
                    holds.current = {};
                    setReceipt('');
                    setReceiptURL('');
                    setResumePath(new URL(publicPath(`/forms/${encodeURIComponent(slug)}#resume=${body.resumeToken}`), window.location.origin).href);
                    setSaveState('Saved draft resumed.');
                    return true;
                } }), (!receipt || form.definition.graph?.enabled) && _jsx(FormRenderer, { definition: form.definition, initialAnswers: form.answers, booking: booking, onEvent: analytics, onAnalyticsConsent: consentChanged, onSave: save, onChange: answers => {
                    if (form.definition.access.autosaveProgress && !revoking.current) {
                        if (autosave.current)
                            clearTimeout(autosave.current);
                        autosave.current = setTimeout(() => { void save(answers).catch(() => { }); }, 2000);
                    }
                }, onUpload: (file, field, progress) => new Promise((resolve, reject) => {
                    const request = new XMLHttpRequest();
                    request.open('POST', publicPath(`/api/forms-runtime/${encodeURIComponent(slug)}/upload`));
                    request.setRequestHeader('Content-Type', file.type);
                    request.setRequestHeader('X-Form-Session', form.session);
                    request.setRequestHeader('X-Form-Revision', form.revision);
                    request.setRequestHeader('X-Form-Field', field.id);
                    request.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
                    request.upload.onprogress = event => { if (event.lengthComputable)
                        progress(Math.round(event.loaded / event.total * 100)); };
                    request.onerror = () => reject(new Error('Upload failed. Please retry.'));
                    request.onload = () => { try {
                        const body = JSON.parse(request.responseText);
                        if (request.status >= 400)
                            reject(new Error(body.message || 'Upload failed.'));
                        else
                            resolve(body);
                    }
                    catch {
                        reject(new Error('Invalid upload response.'));
                    } };
                    request.send(file);
                }), onSubmit: async (answers, navigation) => {
                    if (autosave.current)
                        clearTimeout(autosave.current);
                    await pendingSave.current.catch(() => { });
                    const response = await publicFetch(`/api/forms-runtime/${encodeURIComponent(slug)}/submit`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Form-Session': form.session }, body: JSON.stringify({ revision: form.revision, idempotencyKey: retryKey.current, answers, navigation, analyticsConsent: analyticsConsent.current, bookings: Object.fromEntries(Object.entries(holds.current).map(([path, hold]) => [path, hold.token])), website: '' }) });
                    const body = await response.json();
                    if (!response.ok && !body.errors)
                        throw new Error(body.message || 'Could not submit. Please retry.');
                    if (body.receipt) {
                        stopped.current = true;
                        setReceipt(body.receipt);
                        setSaveState(body.message || 'Your response has been received.');
                    }
                    if (response.ok && body.payment?.token)
                        setPayment(body.payment.token);
                    return body;
                } }, `${form.revision}:${form.session}`), receiptControls, _jsx("p", { role: "status", children: saveState }), resumePath && _jsxs("div", { children: [_jsxs("label", { children: ["Private resume link \u2014 anyone with this link can access anonymous saved answers.", _jsx("input", { readOnly: true, value: resumePath, onFocus: e => e.target.select(), style: { width: '100%' } })] }), _jsx("button", { type: "button", onClick: async () => {
                            if (!window.confirm('Revoke this private resume link? Your current answers will remain on this page.'))
                                return;
                            try {
                                await revoke();
                            }
                            catch (error) {
                                setSaveState(error.message);
                            }
                        }, children: "Revoke private resume link" }), _jsxs("div", { children: [_jsxs("label", { children: ["Email this private link", _jsx("input", { type: "email", autoComplete: "email", value: resumeEmail, onChange: event => setResumeEmail(event.target.value) })] }), _jsx("button", { type: "button", disabled: emailBusy || !resumeEmail.trim(), onClick: async () => {
                                    setEmailBusy(true);
                                    try {
                                        await pendingSave.current.catch(() => { });
                                        const response = await publicFetch(`/api/forms-runtime/${encodeURIComponent(slug)}/progress-email`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Form-Session': form.session }, body: JSON.stringify({ revision: form.revision, token: resumeToken.current, email: resumeEmail }) });
                                        const body = await response.json();
                                        if (!response.ok)
                                            throw new Error(body.message);
                                        setSaveState(body.message);
                                    }
                                    catch (error) {
                                        setSaveState(error.message);
                                    }
                                    finally {
                                        setEmailBusy(false);
                                    }
                                }, children: emailBusy ? 'Queuing email…' : 'Email resume link' })] })] }), form.definition.access.publicResults && _jsxs("details", { children: [_jsx("summary", { children: "View survey results" }), _jsx(SurveyResults, { endpoint: publicPath(`/api/forms-surveys/${encodeURIComponent(slug)}?lookup=slug`) })] })] });
}
