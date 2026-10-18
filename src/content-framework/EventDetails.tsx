'use client'
import { useSiteFormat, formatSiteDate, formatSiteTime, eventInstant } from '@design-system/payload-design-core/content'
import type { EventSchedule, TypeField } from '@design-system/payload-design-core/content'
export function EventDetails({ post }: { post: unknown }) {
  const siteFormat = useSiteFormat()
  const doc = post as {
    postType?: { capability?: string; fieldDefinitions?: TypeField[] }
    postTypeValues?: Record<string, unknown>
  }
  if (doc.postType?.capability !== 'event') return null
  const field = doc.postType.fieldDefinitions?.find((f) => f.kind === 'eventSchedule' && f.public),
    values = doc.postTypeValues || {},
    schedule = field && (values[field.id] as EventSchedule | undefined)
  if (!schedule) return null
  const display = (value: string) => {
    if (schedule.allDay) return formatSiteDate(value.slice(0, 10), siteFormat)
    const instant = new Date(eventInstant(value, schedule.timezone))
    return `${formatSiteDate(instant, siteFormat, schedule.timezone)} ${formatSiteTime(instant, siteFormat, schedule.timezone)}`
  }
  return (
    <section aria-label="Event information" className="event-details">
      <h2>Event information</h2>
      <dl>
        <dt>Starts</dt>
        <dd>{display(schedule.start)}</dd>
        <dt>Ends</dt>
        <dd>
          {display(schedule.end)}
          {schedule.allDay ? ' (all day; end date exclusive)' : ''}
        </dd>
        <dt>Timezone</dt>
        <dd>{schedule.timezone}</dd>
        {schedule.frequency && schedule.frequency !== 'none' && (
          <>
            <dt>Repeats</dt>
            <dd>
              Every {schedule.interval || 1} {schedule.frequency} period
              {schedule.until ? `, until ${formatSiteDate(schedule.until.slice(0, 10), siteFormat)}` : ''}
            </dd>
          </>
        )}
        {['location', 'organizer'].map((key) =>
          values[key] && doc.postType?.fieldDefinitions?.some((f) => f.id === key && f.public) ? (
            <div key={key}>
              <dt>{key === 'location' ? 'Location' : 'Organizer'}</dt>
              <dd>{String(values[key])}</dd>
            </div>
          ) : null,
        )}
      </dl>
      {typeof values.eventLink === 'string' &&
        /^https?:\/\//i.test(values.eventLink) &&
        doc.postType.fieldDefinitions?.some(
          (field) => field.id === 'eventLink' && field.public,
        ) && (
          <p>
            <a href={values.eventLink} rel="noopener noreferrer">
              Event website
            </a>
          </p>
        )}
    </section>
  )
}
