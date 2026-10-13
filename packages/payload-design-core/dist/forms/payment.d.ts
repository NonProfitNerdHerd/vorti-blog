import type { Answers, FormDefinition } from './model';
/** Explicit supported currencies; adapters may extend this registry with tested minor-unit rules. */
export declare const paymentCurrencies: Record<string, number>;
export interface PaymentQuote {
    provider: 'stripe' | 'simulator';
    amount: number;
    currency: string;
}
export interface PaymentView extends PaymentQuote {
    status: 'pending' | 'paid' | 'failed' | 'canceled' | 'refunded';
    simulated: boolean;
    configured: boolean;
    refundedAmount: number;
    title: string;
    message?: string;
    checkoutURL?: string;
    confirmation?: string;
    continueURL?: string;
}
/** Call only with server-evaluated answers. Monetary storage uses integer minor units. */
export declare function paymentQuote(definition: FormDefinition, answers: Answers): PaymentQuote | undefined;
