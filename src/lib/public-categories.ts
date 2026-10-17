import { cache } from 'react'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { readCategoriesEnabled } from './system-settings'

export const publicCategoriesEnabled = cache(async () =>
  readCategoriesEnabled(await getPayload({ config })),
)
