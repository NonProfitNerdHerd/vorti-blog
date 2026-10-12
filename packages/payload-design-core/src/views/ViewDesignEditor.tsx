'use client'
import type { ReactNode } from 'react'
import { UnifiedBlockInspector } from '../builder/UnifiedBlockInspector'
import { InspectorDevice } from '../builder/InspectorControls'
import type { BlockPresentation } from '../blocks/presentation'
import type { Viewport } from '../content/model'
import type { ViewConfig } from './model'

/** The same inspector and responsive state used by document blocks. */
export function ViewDesignEditor({
  value,
  onChange,
  viewport,
  onDeviceChange,
  disabled,
  renderBackgroundMedia,
  tab,
}: {
  value: ViewConfig['design']
  onChange: (value: NonNullable<ViewConfig['design']>) => void
  viewport: Viewport
  onDeviceChange: (device: Viewport) => void
  disabled?: boolean
  tab?: 'layout' | 'style' | 'advanced'
  renderBackgroundMedia?: (
    value: BlockPresentation['background'],
    change: (value: NonNullable<BlockPresentation['background']>) => void,
  ) => ReactNode
}) {
  return (
    <InspectorDevice.Provider value={{ viewport, change: onDeviceChange }}>
      <UnifiedBlockInspector
        node={{ id: 'saved-view-design', kind: 'group', label: 'View appearance', ...value }}
        onChange={(patch) => onChange({ ...value, ...patch })}
        disabled={disabled}
        showFields={false}
        activeTab={tab}
        hideHeader={!!tab}
        renderBackgroundMedia={renderBackgroundMedia}
      />
    </InspectorDevice.Provider>
  )
}
