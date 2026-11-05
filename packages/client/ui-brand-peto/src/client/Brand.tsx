import { PETO_MARK_PATH, PETO_MARK_VIEWBOX } from './mark.ts'

/** Props shared by the sidebar and home-hero mark slots. */
export interface PetoMarkProps {
  /** Requested width in pixels; the height keeps the mark's ratio. */
  size: number
  /** Host class preserving the surrounding mark geometry. */
  className?: string | undefined
}

/**
 * Render Peto's solid mark in the current text colour, so it follows the light and dark themes.
 * @param props - Host-supplied size and class.
 * @returns the decorative mark (aria-hidden; the surrounding name or headline carries the label).
 */
export function PetoMark({ size, className }: PetoMarkProps) {
  return (
    <svg
      width={size}
      height={(size * PETO_MARK_VIEWBOX.height) / PETO_MARK_VIEWBOX.width}
      className={className}
      viewBox={`0 0 ${PETO_MARK_VIEWBOX.width} ${PETO_MARK_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
      data-peto-mark=""
    >
      <path d={PETO_MARK_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}

/**
 * Render the product name for release builds, which carry no local-build label.
 * @returns the sidebar product name.
 */
export function PetoName() {
  return <span>Peto Agent</span>
}
