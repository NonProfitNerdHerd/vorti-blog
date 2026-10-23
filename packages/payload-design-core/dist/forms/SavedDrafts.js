'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { usePublicFetch } from '../PublicSiteContext.js';
export function SavedDrafts({ slug, refresh, onResume, onRevoke, }) {
    const publicFetch = usePublicFetch();
    const [drafts, setDrafts] = useState([]), [next, setNext] = useState(null);
    const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        publicFetch(`/api/forms-runtime/${encodeURIComponent(slug)}/drafts`, {
            signal: controller.signal,
        })
            .then(async (response) => {
            if (response.status === 401)
                return;
            if (!response.ok)
                throw new Error('Your account drafts could not be loaded.');
            const body = (await response.json());
            setDrafts(body.drafts);
            setNext(body.next);
        })
            .catch((error) => {
            if (!controller.signal.aborted)
                setMessage(error.message);
        });
        return () => controller.abort();
    }, [slug, refresh, publicFetch]);
    if (!drafts.length && !message)
        return null;
    return (_jsxs("section", { "aria-label": "Your saved drafts", children: [_jsx("h2", { children: "Your saved drafts" }), _jsx("p", { children: "Resume replaces the answers currently on this page. Account drafts require your sign-in; resuming here ends the previous editing session." }), _jsx("ul", { children: drafts.map((draft) => (_jsxs("li", { children: [_jsx("strong", { children: draft.label }), " \u2014 expires", ' ', new Date(draft.expiresAt).toLocaleDateString(), draft.retiredAt ? (_jsx("span", { children: " This revision is retired. Contact the form owner for recovery." })) : (_jsx("button", { type: "button", disabled: busy, onClick: async () => {
                                setBusy(true);
                                try {
                                    const resumed = await onResume(draft.id);
                                    setMessage(resumed
                                        ? 'Saved draft resumed.'
                                        : 'Resume canceled. Your current answers are unchanged.');
                                }
                                catch (error) {
                                    setMessage(error.message);
                                }
                                finally {
                                    setBusy(false);
                                }
                            }, children: "Resume saved draft" })), _jsx("button", { type: "button", disabled: busy, onClick: async () => {
                                if (!window.confirm(`Revoke “${draft.label}”? Its private resume link will stop working.`))
                                    return;
                                setBusy(true);
                                try {
                                    const message = await onRevoke(draft.id);
                                    setDrafts((items) => items.filter((item) => item.id !== draft.id));
                                    setMessage(message);
                                }
                                catch (error) {
                                    setMessage(error.message);
                                }
                                finally {
                                    setBusy(false);
                                }
                            }, children: "Revoke saved draft" })] }, draft.id))) }), next !== null && (_jsx("button", { type: "button", disabled: busy, onClick: async () => {
                    setBusy(true);
                    try {
                        const response = await publicFetch(`/api/forms-runtime/${encodeURIComponent(slug)}/drafts?after=${next}`);
                        const body = (await response.json());
                        if (!response.ok)
                            throw new Error(body.message);
                        setDrafts((items) => [...items, ...body.drafts]);
                        setNext(body.next);
                    }
                    catch (error) {
                        setMessage(error.message);
                    }
                    finally {
                        setBusy(false);
                    }
                }, children: "More saved drafts" })), _jsx("p", { role: "status", children: message })] }));
}
