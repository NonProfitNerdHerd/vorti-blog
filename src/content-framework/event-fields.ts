import type { TypeField } from '@design-system/payload-design-core'
export const eventFields: TypeField[] = [
  { id: 'schedule', label: 'Event schedule', kind: 'eventSchedule', required: true, public: true },
  { id: 'location', label: 'Venue', kind: 'text', public: true },
  { id: 'organizer', label: 'Organizer', kind: 'text', public: true },
  { id: 'latitude', label: 'Latitude', kind: 'number', public: true },
  { id: 'longitude', label: 'Longitude', kind: 'number', public: true },
  { id: 'eventLink', label: 'External event link', kind: 'url', public: true },
]
