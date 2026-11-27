/** Peto: the running Chat status icon, Peto Web's self-playing Tetris board in place of DeepSeek's whale tail. */
import { useEffect, useRef, useState } from 'react'
import { mountPetoTetris, type PetoTetrisMotion } from './peto-tetris.ts'
import tetrisCss from './RunningPetoTetris.module.css'

const REDUCED = '(prefers-reduced-motion: reduce)'
const FORCED = '(forced-colors: active)'

/** Read the motion the system allows: forced colors and reduced motion both stop the board. */
function readMotion(): PetoTetrisMotion {
  if (typeof matchMedia === 'undefined') return 'animate'
  if (matchMedia(FORCED).matches) return 'forced'
  return matchMedia(REDUCED).matches ? 'still' : 'animate'
}

/**
 * Render the decorative running icon in a 20px footprint, where upstream's whale tail took 14px.
 * @returns a canvas that plays Tetris, or holds a still frame while the system asks for less motion or forced colors.
 */
export function RunningPetoTetris() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [motion, setMotion] = useState(readMotion)
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return undefined
    const queries = [matchMedia(REDUCED), matchMedia(FORCED)]
    const update = (): void => { setMotion(readMotion()) }
    for (const query of queries) query.addEventListener('change', update)
    return () => { for (const query of queries) query.removeEventListener('change', update) }
  }, [])
  useEffect(() => {
    const node = canvas.current
    return node === null ? undefined : mountPetoTetris(node, motion)
  }, [motion])
  return (
    <span className={tetrisCss.icon} aria-hidden="true" data-peto-running-icon={motion}>
      <canvas ref={canvas} className={tetrisCss.board} />
    </span>
  )
}
