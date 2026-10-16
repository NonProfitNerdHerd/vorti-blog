import { jsx as _jsx } from "react/jsx-runtime";
import { TextCursorInput, UserRound, MapPin, Mail, Phone, Link, Hash, CircleDollarSign, SlidersHorizontal, Star, Gauge, ChevronDown, Search, CircleDot, ListChecks, Images, ListOrdered, SquareCheck, ShieldCheck, FileCheck, Calendar, Clock, CalendarClock, CalendarRange, FileUp, EyeOff, Calculator, Table, Signature, CopyPlus, PanelsTopLeft, ClipboardCheck, Square } from 'lucide-react';
import { BlockGlyph } from '../blocks/BlockGlyph.js';
const shared = { textarea: 'paragraph', heading: 'heading', content: 'text', divider: 'divider', row: 'columns', column: 'column', section: 'group' };
const icons = { text: TextCursorInput, name: UserRound, address: MapPin, email: Mail, phone: Phone, url: Link, number: Hash, currency: CircleDollarSign, slider: SlidersHorizontal, rating: Star, nps: Gauge, select: ChevronDown, searchSelect: Search, radio: CircleDot, multiSelect: ListChecks, imageChoice: Images, ranking: ListOrdered, checkbox: SquareCheck, consent: ShieldCheck, terms: FileCheck, date: Calendar, time: Clock, datetime: CalendarClock, dateRange: CalendarRange, upload: FileUp, hidden: EyeOff, calculated: Calculator, likert: Table, signature: Signature, repeater: CopyPlus, step: PanelsTopLeft, review: ClipboardCheck };
export function FormPartIcon({ kind }) {
    const Icon = icons[kind] || Square;
    return _jsx("span", { className: "forms-part-icon", "aria-hidden": "true", "data-part-icon": kind, children: shared[kind] ? _jsx(BlockGlyph, { kind: shared[kind] }) : _jsx(Icon, { size: 18, strokeWidth: 1.75 }) });
}
