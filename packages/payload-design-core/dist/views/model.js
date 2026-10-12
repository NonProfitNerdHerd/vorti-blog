/** Assign consistent columns to connected groups of overlapping occurrences. */
export function occurrenceLanes(items) {
    const result = new Map();
    let group = [], ends = [], groupEnd = -Infinity;
    const flush = () => {
        for (const item of group)
            result.set(item.id, { lane: item.lane, lanes: ends.length });
        group = [];
        ends = [];
    };
    for (const item of [...items]
        .filter((item) => item.occurrence)
        .sort((a, b) => Date.parse(a.occurrence.start) - Date.parse(b.occurrence.start))) {
        const start = Date.parse(item.occurrence.start), end = Date.parse(item.occurrence.end);
        if (start >= groupEnd)
            flush();
        let lane = ends.findIndex((value) => value <= start);
        if (lane < 0)
            lane = ends.length;
        ends[lane] = end;
        groupEnd = Math.max(groupEnd, end);
        group.push({ id: item.id, lane });
    }
    flush();
    return result;
}
const capabilities = new Map();
export function registerContentCapability(capability) {
    if (!/^[a-z][a-z0-9-]*$/.test(capability.key) || capabilities.has(capability.key))
        throw new Error(`Invalid or duplicate capability ${capability.key}`);
    capabilities.set(capability.key, capability);
}
export const listContentCapabilities = () => [...capabilities.values()];
registerContentCapability({ key: 'content', label: 'Content' });
registerContentCapability({ key: 'event', label: 'Event', requiredKinds: ['eventSchedule'] });
const sources = new Map();
const views = new Map();
export function registerContentSource(source) {
    if (sources.has(source.key))
        throw new Error(`Duplicate source ${source.key}`);
    sources.set(source.key, source);
}
export function registerView(view) {
    if (views.has(view.key))
        throw new Error(`Duplicate view ${view.key}`);
    views.set(view.key, view);
}
export const listContentSources = () => [...sources.values()];
export const listViews = () => [...views.values()];
export const getView = (key) => views.get(key);
registerContentSource({
    key: 'posts',
    label: 'Posts',
    fields: ['postType', 'categories', 'tags', 'author', 'featured'],
    capabilities: ['content', 'event'],
});
registerContentSource({ key: 'pages', label: 'Pages', fields: [], capabilities: ['content'] });
for (const [prefix, count, name, thumbnail] of [
    ['grid', 7, 'Post Grid', 'grid'],
    ['list', 4, 'Post List', 'list'],
    ['slider', 2, 'Post Slider', 'slider'],
    ['module', 2, 'Post Module', 'split'],
])
    for (let i = 1; i <= count; i++)
        registerView({ key: `${prefix}-${i}`, label: `${name} ${i}`, family: 'posts', thumbnail });
for (const key of ['taxonomy', 'search', 'ticker'])
    registerView({
        key,
        label: key === 'ticker' ? 'News Ticker' : key === 'search' ? 'Search / Filter' : 'Taxonomy',
        family: 'posts',
        thumbnail: 'list',
    });
for (const [key, label, thumbnail] of [
    ['month', 'Month Calendar', 'calendar'],
    ['week', 'Week Calendar', 'calendar'],
    ['day', 'Day Calendar', 'calendar'],
    ['year', 'Year Calendar', 'calendar'],
    ['calendar', 'Switchable Calendar', 'calendar'],
    ['list', 'Event List', 'list'],
    ['agenda', 'Agenda', 'list'],
    ['grid', 'Event Grid', 'grid'],
    ['tiles', 'Event Tiles', 'grid'],
    ['masonry', 'Event Masonry', 'grid'],
    ['timetable', 'Timetable', 'calendar'],
    ['map', 'Event Map', 'map'],
    ['slider', 'Event Slider', 'slider'],
    ['carousel', 'Event Carousel', 'slider'],
    ['cover', 'Event Cover', 'split'],
    ['countdown', 'Event Countdown', 'split'],
    ['widget', 'Upcoming Events', 'list'],
    ['single', 'Single Event', 'split'],
])
    registerView({ key: `event-${key}`, label, family: 'events', capability: 'event', thumbnail });
export const defaultView = {
    version: 1,
    query: { source: 'posts', limit: 9, sort: '-publishedAt' },
    layout: 'grid-1',
    columns: 3,
    gap: 20,
    image: true,
    excerpt: true,
    taxonomy: true,
    date: true,
    pagination: 'numbers',
    search: true,
    filters: true,
};
export function documentURL(post) {
    const type = post.postType && typeof post.postType === 'object'
        ? post.postType
        : null;
    return `/${encodeURIComponent(type?.prefix || 'posts')}/${encodeURIComponent(post.slug || '__preview__')}`;
}
