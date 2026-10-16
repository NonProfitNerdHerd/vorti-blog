import { type Condition, type FormDefinition, type FormField, type FormValue, type RuleEffect } from './model';
/** IDs for choices are scoped to their owning field, not globally unique. */
export declare function cloneFields(source: FormField[]): {
    fields: FormField[];
    ids: Map<string, string>;
    condition: (value: Condition) => Condition;
    effect: (value: RuleEffect) => RuleEffect;
    remapValue: (id: string, value: FormValue) => FormValue;
};
/** Duplicate in place. Copy local field behavior, not actions or global step routing. */
export declare function duplicateFormField(definition: FormDefinition, id: string): {
    definition: FormDefinition;
    selected: string;
};
