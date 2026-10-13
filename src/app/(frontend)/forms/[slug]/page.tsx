import { FormHost } from '@/forms/FormHost'
import type { Metadata } from 'next'
export const metadata: Metadata = { referrer: 'no-referrer', robots: { index: false, follow: false } }
export default async function StandaloneForm({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <main style={{ maxWidth: 1100, margin: '24px auto', padding: '0 16px' }}><FormHost slug={slug} /></main>
}
