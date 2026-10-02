export function walkTemplate(nodes, visit, parent = null) {
    for (const node of nodes) {
        visit(node, parent);
        if (node.type === 'layout') {
            walkTemplate(node.children ?? [], visit, node.id);
            for (const column of node.columns ?? [])
                walkTemplate(column.children, visit, column.id);
        }
        if (node.type === 'block')
            for (const field of node.fields)
                visit(field, node.id);
    }
}
export function templateFields(nodes) {
    const fields = [];
    walkTemplate(nodes, (node) => { if (node.type === 'field')
        fields.push(node); });
    return fields;
}
export function findTemplateNode(nodes, id) {
    let match = null;
    walkTemplate(nodes, (node) => { if (node.id === id)
        match = node; });
    return match;
}
export function updateTemplateNode(nodes, id, update) {
    return nodes.map((node) => {
        if (node.id === id)
            return update(node);
        if (node.type !== 'layout')
            return node;
        return { ...node,
            children: node.children ? updateTemplateNode(node.children, id, update) : undefined,
            columns: node.columns?.map((column) => ({ ...column, children: updateTemplateNode(column.children, id, update) })),
        };
    });
}
export function removeTemplateNode(nodes, id) {
    return nodes.filter((node) => node.id !== id).map((node) => node.type === 'layout' ? {
        ...node, children: node.children ? removeTemplateNode(node.children, id) : undefined,
        columns: node.columns?.map((column) => ({ ...column, children: removeTemplateNode(column.children, id) })),
    } : node);
}
export function moveTemplateNode(nodes, id, direction) {
    const index = nodes.findIndex((node) => node.id === id);
    if (index >= 0) {
        const target = index + direction;
        if (target < 0 || target >= nodes.length)
            return nodes;
        const next = [...nodes];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
    }
    return nodes.map((node) => node.type === 'layout' ? {
        ...node, children: node.children ? moveTemplateNode(node.children, id, direction) : undefined,
        columns: node.columns?.map((column) => ({ ...column, children: moveTemplateNode(column.children, id, direction) })),
    } : node);
}
export function collectFieldIDs(nodes) { return templateFields(nodes).map((field) => field.id); }
export function extractTemplateNode(nodes, id) {
    let extracted = null;
    const next = nodes.flatMap((node) => {
        if (node.id === id) {
            extracted = node;
            return [];
        }
        if (node.type !== 'layout')
            return [node];
        const childResult = extractTemplateNode(node.children ?? [], id);
        if (childResult.extracted)
            extracted = childResult.extracted;
        const columns = node.columns?.map((column) => {
            const result = extractTemplateNode(column.children, id);
            if (result.extracted)
                extracted = result.extracted;
            return { ...column, children: result.nodes };
        });
        return [{ ...node, children: childResult.nodes, columns }];
    });
    return { nodes: next, extracted };
}
export function insertTemplateNode(nodes, containerID, nodeToInsert, beforeID) {
    const insert = (items) => { const next = [...items]; const at = beforeID ? next.findIndex(item => item.id === beforeID) : -1; next.splice(at < 0 ? next.length : at, 0, nodeToInsert); return next; };
    if (containerID === 'root')
        return insert(nodes);
    return nodes.map((node) => {
        if (node.type !== 'layout')
            return node;
        if (node.id === containerID && !['columns', 'spacer', 'divider'].includes(node.layout))
            return { ...node, children: insert(node.children ?? []) };
        return { ...node,
            children: insertTemplateNode(node.children ?? [], containerID, nodeToInsert, beforeID),
            columns: node.columns?.map((column) => column.id === containerID ? { ...column, children: insert(column.children) } : { ...column, children: insertTemplateNode(column.children, containerID, nodeToInsert, beforeID) }),
        };
    });
}
export function moveTemplateNodeTo(nodes, id, containerID, beforeID) {
    if (id === beforeID)
        return nodes;
    const containers = (items) => items.flatMap(node => node.type === 'layout' ? [...(!['columns', 'spacer', 'divider'].includes(node.layout) ? [node.id] : []), ...containers(node.children ?? []), ...(node.columns ?? []).flatMap(column => [column.id, ...containers(column.children)])] : []);
    const source = findTemplateNode(nodes, id);
    if (!source || (containerID !== 'root' && !containers(nodes).includes(containerID)) || containerID === id || containers([source]).includes(containerID))
        return nodes;
    const result = extractTemplateNode(nodes, id);
    return result.extracted ? insertTemplateNode(result.nodes, containerID, result.extracted, beforeID) : nodes;
}
