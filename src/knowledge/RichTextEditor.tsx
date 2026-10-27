'use client'
import { LexicalComposer } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposer'
import { RichTextPlugin } from '@payloadcms/richtext-lexical/lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@payloadcms/richtext-lexical/lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@payloadcms/richtext-lexical/lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@payloadcms/richtext-lexical/lexical/react/LexicalOnChangePlugin'
import { LexicalErrorBoundary } from '@payloadcms/richtext-lexical/lexical/react/LexicalErrorBoundary'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import {
  HeadingNode,
  QuoteNode,
  $createHeadingNode,
} from '@payloadcms/richtext-lexical/lexical/rich-text'
import {
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  FORMAT_TEXT_COMMAND,
} from '@payloadcms/richtext-lexical/lexical'
import { $setBlocksType } from '@payloadcms/richtext-lexical/lexical/selection'
import { LinkNode } from '@payloadcms/richtext-lexical/lexical/link'
import {
  ListNode,
  ListItemNode,
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
} from '@payloadcms/richtext-lexical/lexical/list'
import { ListPlugin } from '@payloadcms/richtext-lexical/lexical/react/LexicalListPlugin'

function Toolbar() {
  const [editor] = useLexicalComposerContext()
  return (
    <div role="toolbar" aria-label="Text formatting">
      {(['bold', 'italic', 'underline', 'strikethrough'] as const).map((format) => (
        <button
          key={format}
          type="button"
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)}
        >
          {format}
        </button>
      ))}
      <button
        type="button"
        onClick={() =>
          editor.update(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection))
              $setBlocksType(selection, () => $createHeadingNode('h2'))
          })
        }
      >
        Heading
      </button>
      <button
        type="button"
        onClick={() =>
          editor.update(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection))
              $setBlocksType(selection, () => $createParagraphNode())
          })
        }
      >
        Paragraph
      </button>
      <button
        type="button"
        onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
      >
        Bullet list
      </button>
      <button
        type="button"
        onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}
      >
        Numbered list
      </button>
    </div>
  )
}
export function KnowledgeRichTextEditor({
  value,
  onChange,
}: {
  value: unknown
  onChange: (value: unknown) => void
}) {
  return (
    <LexicalComposer
      initialConfig={{
        namespace: 'knowledge-editor',
        nodes: [HeadingNode, QuoteNode, LinkNode, ListNode, ListItemNode],
        editorState: JSON.stringify(value),
        onError: (error) => {
          throw error
        },
      }}
    >
      <Toolbar />
      <RichTextPlugin
        contentEditable={
          <ContentEditable aria-label="Page content" className="knowledge-rich-editor" />
        }
        placeholder={<span>Write your page…</span>}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <ListPlugin />
      <OnChangePlugin ignoreSelectionChange onChange={(state) => onChange(state.toJSON())} />
    </LexicalComposer>
  )
}
