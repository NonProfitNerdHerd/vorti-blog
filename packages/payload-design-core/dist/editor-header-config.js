/** Opt a collection into the shared header without replacing Payload's edit view. */
export function configureEditorHeader(collection) {
    const components = collection.admin?.components ?? {};
    collection.admin = {
        ...collection.admin,
        components: {
            ...components,
            Description: '@design-system/payload-design-core/admin#EditorTitleSlot',
            edit: {
                ...components.edit,
                beforeDocumentControls: [
                    '@design-system/payload-design-core/admin#EditorPreviewSlot',
                    ...(components.edit?.beforeDocumentControls ?? []),
                ],
            },
            views: {
                ...components.views,
                edit: {
                    ...components.views?.edit,
                    editorHistory: {
                        tab: {
                            Component: '@design-system/payload-design-core/admin#EditorHistorySlot',
                            order: -100,
                        },
                    },
                },
            },
        },
    };
}
