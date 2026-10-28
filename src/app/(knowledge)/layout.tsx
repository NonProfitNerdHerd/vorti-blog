import type { ReactNode } from 'react'
import '../../knowledge/knowledge.css'
import '../../knowledge/wiki.css'
export const dynamic='force-dynamic'
export const metadata={robots:{index:false,follow:false}}
export default function Layout({children}:{children:ReactNode}) {return <html lang="en"><body>{children}</body></html>}
