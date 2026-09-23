/**
 * Schema-neutral contracts for the future shared builder core.
 *
 * These types deliberately contain no Payload form paths, Template fields,
 * Site Template concepts, or rendering implementation. The current
 * TemplateBuilder does not consume them yet, so introducing this boundary
 * cannot alter its production behavior.
 */

export type BuilderNodeID = string

export type BuilderParentKind = 'root' | 'container' | 'row' | 'column' | 'stack'

export type BuilderLibraryItem = {
  category: string
  description: string
  kind: string
  keywords?: string[]
  label: string
  value: string
}

export type BuilderTreeAdapter<TNode> = {
  children(node: TNode): readonly TNode[]
  id(node: TNode): BuilderNodeID
  insert(nodes: readonly TNode[], parentID: BuilderNodeID | 'root', node: TNode): TNode[]
  move(nodes: readonly TNode[], nodeID: BuilderNodeID, parentID: BuilderNodeID | 'root'): TNode[]
  remove(nodes: readonly TNode[], nodeID: BuilderNodeID): TNode[]
  replace(nodes: readonly TNode[], nodeID: BuilderNodeID, node: TNode): TNode[]
}

export type BuilderValidationIssue = {
  message: string
  path: string
}

export type BuilderDocumentAdapter<TDocument, TNode> = {
  getNodes(document: TDocument): readonly TNode[]
  setNodes(document: TDocument, nodes: readonly TNode[]): TDocument
  validate(document: TDocument): readonly BuilderValidationIssue[]
}

export type BuilderElementAdapter<TNode, TEditorContext = unknown> = {
  canInsert(item: BuilderLibraryItem, parent: BuilderParentKind, context: TEditorContext): boolean
  create(item: BuilderLibraryItem, context: TEditorContext): TNode
  label(node: TNode): string
}

export type BuilderCoreConfiguration<TDocument, TNode, TEditorContext = unknown> = {
  document: BuilderDocumentAdapter<TDocument, TNode>
  elements: BuilderElementAdapter<TNode, TEditorContext>
  library: readonly BuilderLibraryItem[]
  tree: BuilderTreeAdapter<TNode>
}

export type BuilderViewport = 'desktop' | 'tablet' | 'mobile'

export type BuilderPreviewSize = {
  height: number
  viewport: BuilderViewport
  width: number
}
