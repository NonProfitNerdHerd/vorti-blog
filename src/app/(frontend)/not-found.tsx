import Link from 'next/link'

export default function NotFound() {
  return <div className="container empty-state"><h1>Page not found</h1><p>The content you requested is unavailable.</p><Link href="/">Return home</Link></div>
}
