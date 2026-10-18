'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* eslint-disable @next/next/no-img-element -- Media URLs are already resolved by the host application. */
import { useSiteFormat } from '../SiteFormatContext.js';
import { formatSiteDate } from '../site-format.js';
import { useEffect, useState } from 'react';
import { safeURL } from '../content/model.js';
const emptyProps = {};
export default function Listing({ node, editing }) {
    const siteFormat = useSiteFormat();
    const props = node.props ?? emptyProps;
    const [result, setResult] = useState({
        results: Array.isArray(props.results) ? props.results : [],
        page: Number(props.page ?? 1),
        totalPages: Number(props.totalPages ?? 1),
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const query = new URLSearchParams(Object.fromEntries(Object.entries(props)
        .filter(([key]) => ['collection', 'limit', 'sort', 'ids', 'categories'].includes(key))
        .map(([key, value]) => [key, String(value)]))).toString();
    useEffect(() => {
        if (!editing)
            return;
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            setLoading(true);
            setError('');
            try {
                const response = await fetch(`/api/block-listing?${query}&draft=true`, {
                    signal: controller.signal,
                    credentials: 'same-origin',
                });
                if (!response.ok)
                    throw new Error('Unable to load the listing preview.');
                setResult((await response.json()));
            }
            catch (error) {
                if (!controller.signal.aborted)
                    setError(error.message);
            }
            finally {
                if (!controller.signal.aborted)
                    setLoading(false);
            }
        }, 200);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [editing, query]);
    useEffect(() => {
        const element = document.getElementById(`listing-${node.id}`);
        if (!element)
            return;
        let controller;
        const load = async (event) => {
            const detail = event.detail;
            const next = result.page + detail.direction;
            if (next < 1 || next > result.totalPages)
                return;
            controller?.abort();
            controller = new AbortController();
            setLoading(true);
            setError('');
            try {
                const params = new URLSearchParams(Object.fromEntries(Object.entries(props)
                    .filter(([key]) => ['collection', 'limit', 'sort', 'ids', 'categories', 'draft'].includes(key))
                    .map(([key, value]) => [key, String(value)])));
                params.set('page', String(next));
                if (editing)
                    params.set('draft', 'true');
                const response = await fetch(`/api/block-listing?${params}`, { signal: controller.signal });
                if (!response.ok)
                    throw new Error('Unable to load content. Please try again.');
                const data = (await response.json());
                setResult({
                    ...data,
                    results: detail.append ? [...result.results, ...data.results] : data.results,
                });
            }
            catch (error) {
                if (error.name !== 'AbortError')
                    setError(error.message);
            }
            finally {
                setLoading(false);
            }
        };
        element.addEventListener('listing-page', load);
        return () => {
            controller?.abort();
            element.removeEventListener('listing-page', load);
        };
    }, [node.id, props, result, editing]);
    return (_jsxs("section", { id: `listing-${node.id}`, "aria-label": "Content listing", "aria-busy": loading, "data-listing-page": result.page, "data-listing-pages": result.totalPages, children: [_jsx("div", { style: {
                    display: 'grid',
                    gridTemplateColumns: props.presentation === 'list' || node.variation?.id === 'list'
                        ? '1fr'
                        : 'repeat(auto-fit,minmax(220px,1fr))',
                    gap: '1rem',
                }, children: result.results.map((item, index) => (_jsxs("article", { className: "listing-item", children: [props.showImage !== false && item.image && (_jsx("img", { className: "listing-image", src: safeURL(item.image), alt: "", style: { maxWidth: '100%' } })), props.showTitle !== false && _jsx("h3", { className: "listing-title", children: item.title }), props.showExcerpt !== false && _jsx("p", { className: "listing-excerpt", children: item.excerpt }), props.showDate !== false && item.publishedAt && (_jsx("time", { className: "listing-meta", dateTime: item.publishedAt, children: formatSiteDate(item.publishedAt, siteFormat) })), props.showTaxonomy !== false && _jsx("p", { className: "listing-meta", children: item.taxonomy }), props.showLink !== false && (_jsx("a", { className: "listing-link", href: safeURL(item.url), onClick: editing ? (event) => event.preventDefault() : undefined, children: "Read more" }))] }, `${item.url}-${index}`))) }), _jsx("p", { role: "status", children: loading
                    ? 'Loading content…'
                    : !result.results.length
                        ? editing
                            ? 'No matching content. Choose documents or adjust the listing filters.'
                            : 'No matching content.'
                        : `Page ${result.page} of ${result.totalPages}` }), error && _jsx("p", { role: "alert", children: error })] }));
}
export function ListingNavigation({ node }) {
    const [status, setStatus] = useState('');
    const move = (direction) => {
        const listing = document.getElementById(`listing-${node.props?.listingID}`);
        if (!listing) {
            setStatus('The linked listing is unavailable.');
            return;
        }
        const page = Number(listing.dataset.listingPage), pages = Number(listing.dataset.listingPages);
        if (page + direction < 1 || page + direction > pages) {
            setStatus(direction > 0 ? 'No more content.' : 'Already at the first page.');
            return;
        }
        listing.dispatchEvent(new CustomEvent('listing-page', { detail: { direction, append: node.kind === 'loadMore' } }));
        setStatus('');
    };
    return (_jsxs("nav", { "aria-label": "Listing pagination", children: [node.kind === 'pagination' && (_jsx("button", { type: "button", onClick: () => move(-1), children: "Previous" })), _jsx("button", { type: "button", onClick: () => move(1), children: node.kind === 'loadMore' ? String(node.props?.label ?? 'Load more') : 'Next' }), _jsx("span", { role: "status", children: status })] }));
}
