# Page/Post Template editing

Site Design contains Site Templates, Menus, Site Settings, Block Creator, Page/Post Templates, and Post Types, in that order. Payload still filters navigation by permissions and owns active links, mobile navigation and saved collapse preferences. Collection URLs and references are unchanged.

Ordinary Template blocks come from the same registered catalog as Posts and Pages. Insertion immediately adds and selects a block. Hero and other multi-layout blocks show their inline variation chooser; Skip selects the default. Layout variations remain available in the Layout inspector. Header/Footer editors use the same insertion path. Text blocks use the shared inline editor and document undo history. Rich Text blocks use the host application?s existing Lexical content editor; focused plain-text blocks can switch to formatting without adding a schema field.

A single Template field entry opens a field-type selector. Use it when declaring editable content slots or binding legacy fields to document values. Their existing field configuration remains under Template controls. Existing field/layout nodes are edited in their original storage format; this change does not convert saved Templates.

Hero is a shared composite block with six variations. Hero Board is a Designed Block backed by published Block Creator designs. Its visual picker shows structural previews derived from design primitives, supports keyboard navigation, and is available in the Layout inspector after insertion. New Designed Blocks start with the first published design sorted by name then ID; there is currently no registered default-design setting in the block registration contract. Skip retains that initial design. Changing the design keeps the node ID, fields and slot mappings. A block without published designs cannot be inserted and links to Block Creator.

No database migration, content reset, collection slug change, or dependency update is required.

Templates now use Payload's native Save Draft, Publish changes, and document actions. Server validation requires a name and at least one Use With collection, generates the initial slug, and synchronizes the design publication status with the native document status. Saving a draft retains the published revision. Existing archive dependency checks remain active. New documents follow Payload's creation lifecycle; Versions/API tabs become available according to native document state.

Tasks and Block/document tabs share header and inspector styling across all editors. Forms and Form Submissions appear in their own Forms navigation group. No new Template preview route is introduced.

In Site Template Header/Footer editing, use the Site Template inspector tab for the region's existing width, positioning, and visibility settings; Block contains the selected block's controls. Title fields wait for Payload save/publish processing to finish before accepting another edit. Loading Template fields does not mark the form dirty or repeatedly refetch the document.
