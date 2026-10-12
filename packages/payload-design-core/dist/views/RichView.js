import { jsx as _jsx } from "react/jsx-runtime";
import { DynamicView } from './DynamicView.js';
export const savedViewConverters = ({ defaultConverters }) => ({
    ...defaultConverters,
    blocks: {
        savedViewEmbed: ({ node }) => {
            const fields = node.fields;
            const ref = fields.viewID;
            const id = ref && typeof ref === 'object' ? ('id' in ref ? ref.id : undefined) : ref;
            return (_jsx(DynamicView, { viewID: typeof id === 'string' || typeof id === 'number' ? id : undefined }));
        },
    },
});
