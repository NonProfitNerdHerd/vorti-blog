import React from 'react'
import { columnPresets } from './columns'
export function ColumnPicker({ value, onChange, disabled }: { value: number[]; onChange: (weights: number[]) => void; disabled?: boolean }) {
  return <div className="forms-column-presets" role="group" aria-label="Column layouts">{columnPresets.map(weights => <button key={weights.join('/')} type="button" disabled={disabled} aria-label={`${weights.join('/')} columns`} aria-pressed={weights.join('/') === value.join('/')} onClick={() => onChange(weights)}><span aria-hidden="true" style={{ gridTemplateColumns: weights.map(weight => `${weight}fr`).join(' ') }}>{weights.map((_, index) => <i key={index} />)}</span><small>{weights.join(' / ')}</small></button>)}</div>
}
