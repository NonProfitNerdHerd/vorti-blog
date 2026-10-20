import type { Template } from '../types';
/** The drawer mounts the existing template edit view, including TemplateBuilder. */
export declare function PostTemplateChooser({ templates, onChoose, onCancel, onCreated, error, loading, onRetry }: {
    templates: Template[];
    onChoose: (id: string) => void;
    onCancel: () => void;
    onCreated: (template: Template) => void;
    error?: string;
    loading?: boolean;
    onRetry: () => void;
}): import("react").ReactPortal | null;
