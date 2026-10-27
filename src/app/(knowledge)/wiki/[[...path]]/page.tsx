import { KnowledgePage } from '@/knowledge/Page'
export default function Page(props:Omit<Parameters<typeof KnowledgePage>[0],'kind'>) {return <KnowledgePage {...props} kind="wiki"/>}
