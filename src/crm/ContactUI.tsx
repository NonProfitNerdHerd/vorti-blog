import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

type ContactButtonVariant = 'primary' | 'secondary' | 'quiet' | 'edit'
type ContactButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ContactButtonVariant
}

export function ContactButton({ variant = 'secondary', className = '', children, ...props }: ContactButtonProps) {
  return <button className={`vc-contact-button vc-contact-button--${variant} tw:inline-flex tw:items-center tw:justify-center tw:gap-1.5 ${className}`} {...props}>{children}</button>
}

export function ContactIcon({ name }: { name: 'edit' | 'chevron-down' }) {
  return <svg aria-hidden="true" focusable="false" className="tw:size-3.5 tw:shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {name === 'edit' ? <><path d="m12.8 3.8 3.4 3.4M3.5 16.5l3.6-.7 9-9a1.5 1.5 0 0 0-2.1-2.1l-9 9-.7 3.8Z" /></> : <path d="m5 7.5 5 5 5-5" />}
  </svg>
}

export function ContactEditAction({ children, ...props }: Omit<ContactButtonProps, 'variant'>) {
  return <ContactButton variant="edit" {...props}><ContactIcon name="edit" />{children}</ContactButton>
}

export function ContactTab({ selected, children, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-selected'> & { selected: boolean }) {
  return <button role="tab" aria-selected={selected} className="vc-contact-tab" {...props}>{children}</button>
}

export function ContactSectionHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="vc-crm-inline-heading tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1">{children}{action}</div>
}

export function ContactFacts({ children, className = '' }: HTMLAttributes<HTMLDListElement>) {
  return <dl className={`vc-crm-facts tw:grid tw:grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] tw:gap-x-6 tw:gap-y-2 ${className}`}>{children}</dl>
}

export function ContactStatus({ children, tone = 'success' }: { children: ReactNode; tone?: 'success' | 'error' }) {
  return <p className={`vc-contact-status vc-contact-status--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</p>
}
