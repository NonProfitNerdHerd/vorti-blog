import { Registry } from './registry.js';
export const formActions = new Registry();
const required = (keys) => (config) => keys.filter(key => typeof config[key] !== 'string' || !String(config[key]).trim()).map(key => `Configure ${key}.`);
formActions.register({ kind: 'email', label: 'Email notification', description: 'Notify administrators or send a confirmation. Unconfigured delivery is reported in the action queue; local development can capture mail for testing.', settings: [
        { key: 'to', label: 'Recipient', type: 'text', help: 'An email address or {{field_id}} for a validated email answer.', required: true },
        { key: 'subject', label: 'Subject', type: 'text', required: true }, { key: 'body', label: 'Message', type: 'textarea', help: 'Use {{field_id}} and {{summary}}. Values are escaped.' },
        { key: 'integration', label: 'Email provider', type: 'integration', help: 'Choose the site email provider. Leaving this empty captures mail only in local development.' },
    ], validate: required(['to', 'subject']) });
formActions.register({ kind: 'webhook', label: 'Webhook', description: 'Send an authenticated, signed event through an administrator-approved connection.', settings: [
        { key: 'integration', label: 'Webhook connection', type: 'integration', required: true },
        { key: 'fields', label: 'Included field IDs', type: 'text', help: 'Comma-separated field IDs. Leave empty to include all permitted answers.' },
    ], validate: required(['integration']) });
formActions.register({ kind: 'localWebhook', label: 'Local webhook capture', description: 'Development-only delivery to the local receiver; never an external delivery.', settings: [], validate: () => [] });
formActions.register({ kind: 'content', label: 'Create review content', description: 'Create a draft Post for editorial review. Submitted values cannot set roles, ownership, publication or permissions.', settings: [
        { key: 'titleField', label: 'Title answer', type: 'field', required: true }, { key: 'bodyField', label: 'Content answer', type: 'field', required: true },
        { key: 'postType', label: 'Post Type for draft content', type: 'postType', required: true, help: 'The Post stays a draft. The administrator who approves this form becomes its initial author.' },
    ], validate: required(['titleField', 'bodyField', 'postType']) });
formActions.register({ kind: 'contact', label: 'Create contact', description: 'Store a contact record linked to this submission.', settings: [
        { key: 'emailField', label: 'Email answer', type: 'field', required: true }, { key: 'nameField', label: 'Name answer', type: 'field' },
    ], validate: required(['emailField']) });
formActions.register({ kind: 'support', label: 'Create support request', description: 'Create a private request for staff review, linked to the original entry. Publishing this action requires integration permission.', settings: [
        { key: 'titleField', label: 'Request title', type: 'field', required: true }, { key: 'bodyField', label: 'Request details', type: 'field', required: true }, { key: 'emailField', label: 'Reply email', type: 'field' },
    ], validate: required(['titleField', 'bodyField']) });
