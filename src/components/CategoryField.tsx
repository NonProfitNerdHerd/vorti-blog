'use client'
import { RelationshipField } from '@payloadcms/ui'
import type { RelationshipFieldClientComponent } from 'payload'
import { useCategoriesEnabled } from '@design-system/payload-design-core/admin'

export const CategoryField: RelationshipFieldClientComponent = (props) =>
  useCategoriesEnabled() ? <RelationshipField {...props} /> : null
