// Any setup scripts you might need go here

// Load .env files
import 'dotenv/config'

// jsdom does not implement native modal methods used by CRM editors.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
}
