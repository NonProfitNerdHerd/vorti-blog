'use client';
import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { UploadInput, useConfig } from '@payloadcms/ui';
export function BackgroundMediaPicker({ value, change, }) {
    const { config } = useConfig();
    const [error, setError] = useState('');
    const request = useRef(0);
    useEffect(() => () => {
        request.current++;
    }, []);
    return (_jsxs(_Fragment, { children: [_jsx(UploadInput, { api: config.routes.api, serverURL: config.serverURL, relationTo: "media", path: "block-background-media", label: "Background image", allowCreate: true, showError: false, value: value?.mediaID, onChange: async (selected) => {
                    const current = ++request.current;
                    if (!selected) {
                        change({ mediaID: undefined, imageURL: '' });
                        return;
                    }
                    const id = typeof selected === 'object' && 'id' in selected ? selected.id : selected;
                    try {
                        const response = await fetch(`${config.serverURL ?? ''}${config.routes.api}/media/${encodeURIComponent(String(id))}`, { credentials: 'same-origin' });
                        if (!response.ok)
                            throw new Error('Unable to load the selected image.');
                        const media = (await response.json());
                        if (current !== request.current)
                            return;
                        if (!media.url)
                            throw new Error('The selected media has no image URL.');
                        change({ mediaID: id, imageURL: media.url });
                        setError('');
                    }
                    catch (error) {
                        if (current !== request.current)
                            return;
                        setError(error instanceof Error ? error.message : 'Unable to load image.');
                    }
                } }), error && _jsx("p", { role: "alert", children: error })] }));
}
