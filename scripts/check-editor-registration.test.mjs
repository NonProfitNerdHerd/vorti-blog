import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  requiredEditorComponents,
  validateEditorRegistration,
  assertEditorRegistration,
} from './check-editor-registration.mjs'

const fixture = (keys) =>
  keys.map((key, index) => `import { Component${index} } from 'example'`).join('\n') +
  '\nexport const importMap = {' +
  keys.map((key, index) => `${JSON.stringify(key)}: Component${index}`).join(',\n') +
  '}'
test('rejects the production regression with a missing workspace entry', () => {
  assert.throws(
    () =>
      validateEditorRegistration(
        fixture(requiredEditorComponents.filter((key) => !key.endsWith('#ContentWorkspace'))),
      ),
    /ContentWorkspace/,
  )
})
test('rejects a key mentioned only in config or a comment', () => {
  assert.throws(
    () =>
      validateEditorRegistration(
        '// @design-system/payload-design-core/admin#ContentWorkspace\nexport const importMap = {}',
      ),
    /registration is incomplete/,
  )
})
test('requires the component alias to be imported', () => {
  assert.throws(
    () =>
      validateEditorRegistration(
        fixture(requiredEditorComponents).replace("import { Component0 } from 'example'", ''),
      ),
    /ContentWorkspace/,
  )
})
test('accepts complete registration and validates the checked-in map', () => {
  assert.equal(
    validateEditorRegistration(fixture(requiredEditorComponents)),
    requiredEditorComponents.length,
  )
  assert.equal(assertEditorRegistration(), requiredEditorComponents.length)
})
