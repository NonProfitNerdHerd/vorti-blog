import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const admin = '@design-system/payload-design-core/admin#'
export const requiredEditorComponents = [
  ...[
    'ContentWorkspace',
    'TemplateBuilder',
    'SiteTemplateBuilder',
    'EditorTitleSlot',
    'EditorHistorySlot',
    'EditorPreviewSlot',
  ].map((name) => admin + name),
  './content-framework/TypeValues#TypeValues',
  './content-framework/PostTypeWizard#PostTypeWizard',
  './content-framework/FieldsEditor#FieldsEditor',
  './content-framework/TypeIcon#TypeIcon',
  './content-framework/ViewBuilder#ViewBuilder',
  './review/TaskDocument#TaskDocument',
  './components/SiteDesignNav#SiteDesignNav',
  './forms/FormWorkspace#FormWorkspace',
  './forms/FormTitle#FormTitle',
  './forms/FormEditorTabs#FormEditorTabs',
  './forms/FormReports#AnalyticsPanel',
  './forms/FormReports#ResultsPanel',
  './forms/ResourceEditor#ResourceEditor',
  './forms/EntryDetails#EntryDetails',
  './forms/FormExportStatus#FormExportStatus',
  './forms/LocalDeliveryMessage#LocalDeliveryMessage',
]

/** Read syntax only: do not import React/Payload client modules into the build guard. */
export function validateEditorRegistration(source, required = requiredEditorComponents) {
  const file = ts.createSourceFile(
    'importMap.js',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  const imported = new Set()
  const registered = new Map()
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      if (clause?.name) imported.add(clause.name.text)
      const bindings = clause?.namedBindings
      if (bindings && ts.isNamedImports(bindings))
        bindings.elements.forEach((item) => imported.add(item.name.text))
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          declaration.name.getText(file) !== 'importMap' ||
          !declaration.initializer ||
          !ts.isObjectLiteralExpression(declaration.initializer)
        )
          continue
        for (const property of declaration.initializer.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            ts.isStringLiteral(property.name) &&
            ts.isIdentifier(property.initializer)
          )
            registered.set(property.name.text, property.initializer.text)
        }
      }
    }
  }
  const missing = required.filter(
    (key) => !registered.has(key) || !imported.has(registered.get(key)),
  )
  if (missing.length)
    throw new Error(
      `Admin editor registration is incomplete: ${missing.join(', ')}. Run pnpm generate:importmap before building. Do not deploy this artifact.`,
    )
  return required.length
}

export function assertEditorRegistration() {
  const path = fileURLToPath(new URL('../src/app/(payload)/admin/importMap.js', import.meta.url))
  return validateEditorRegistration(readFileSync(path, 'utf8'))
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  console.log(`Verified ${assertEditorRegistration()} required admin editor registrations.`)
