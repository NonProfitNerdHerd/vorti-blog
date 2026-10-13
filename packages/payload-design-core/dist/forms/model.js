export const defaultTheme = {
    font: 'inherit', primary: '#2563eb', background: '#ffffff', text: '#171717', border: '#a3a3a3',
    error: '#b91c1c', radius: 6, spacing: 16, size: 'regular', labelPosition: 'above',
    progress: 'bar', buttonLabel: 'Submit',
};
export const emptyDefinition = () => ({
    version: 1, mode: 'standard', locale: 'en', direction: 'ltr', fields: [], rules: [], actions: [],
    theme: { ...defaultTheme }, confirmation: 'Thank you. Your response has been received.',
    access: { authenticated: false, origins: [], embedOrigins: [], turnstile: false,
        saveProgress: true, autosaveProgress: false, draftDays: 30, analytics: false,
        analyticsConsent: true, publicResults: false, retentionDays: 365, ratePerMinute: 10 },
});
export function flattenFields(fields) {
    return fields.flatMap(field => [field, ...flattenFields(field.children || [])]);
}
export function makeID(prefix = 'field') { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }
export const isEmpty = (value) => value === undefined || value === null || value === '' ||
    (Array.isArray(value) && value.length === 0);
export function answerFields(fields, answers, prefix = '') {
    return fields.flatMap(field => {
        const path = `${prefix}${field.id}`, value = answers[field.id];
        return [{ field, value, path }, ...(field.kind === 'repeater' && Array.isArray(value)
                ? value.flatMap((row, index) => row && typeof row === 'object' && !Array.isArray(row) ? answerFields(field.children || [], row, `${path}.${index}.`) : [])
                : field.kind !== 'repeater' ? answerFields(field.children || [], answers, prefix) : [])];
    });
}
export function attachmentReferences(fields, answers) {
    return answerFields(fields, answers).filter(item => item.field.kind === 'upload').map(item => ({ field: item.field, path: item.path, references: Array.isArray(item.value) ? item.value.filter((value) => typeof value === 'string') : [] }));
}
