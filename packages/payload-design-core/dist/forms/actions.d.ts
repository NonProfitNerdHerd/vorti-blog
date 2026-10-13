import { Registry } from './registry';
import type { FormValue } from './model';
export interface ActionSetting {
    key: string;
    label: string;
    type: 'text' | 'textarea' | 'select' | 'field' | 'integration' | 'postType';
    options?: string[];
    help?: string;
    required?: boolean;
}
export interface ActionRegistration {
    kind: string;
    label: string;
    description: string;
    settings: ActionSetting[];
    validate: (config: Record<string, FormValue>) => string[];
}
export declare const formActions: Registry<ActionRegistration>;
