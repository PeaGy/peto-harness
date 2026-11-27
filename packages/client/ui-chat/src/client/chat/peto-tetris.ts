/**
 * Peto: the running indicator of Peto Web's Chat ("Tetris" under Settings → Appearance → Working indicator), ported
 * in its self-playing form: a 6×6 board where a small bot drops Tetris pieces, clears full rows with a flash and
 * starts over when the board fills. It replaces DeepSeek's whale tail, which is DeepSeek's brand mark.
 * @module @deepseek-ai/dsh-client-ui-chat/peto-tetris
 */

const N = 6
type Cells = ReadonlyArray<readonly [number, number]>
/** The seven pieces: 1 I, 2 O, 3 T, 4 S, 5 Z, 6 J, 7 L; index 0 is unused. */
const SHAPES: readonly Cells[] = [[],
  [[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[1, 0], [0, 1], [1, 1], [2, 1]],
  [[1, 0], [2, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [1, 1], [2, 1]], [[0, 0], [0, 1], [1, 1], [2, 1]],
  [[2, 0], [0, 1], [1, 1], [2, 1]]]
/** Classic piece colors; the light palette is darker so the pieces keep contrast on white. */
const DARK = [[0, 0, 0], [60, 210, 245], [245, 205, 50], [180, 95, 250], [80, 220, 110], [250, 75, 85], [85, 130, 255],
  [255, 150, 45]] as const satisfies readonly Rgb[]
const LIGHT = [[0, 0, 0], [0, 150, 190], [200, 150, 0], [135, 55, 205], [30, 160, 65], [215, 45, 55], [45, 85, 215],
  [225, 115, 15]] as const satisfies readonly Rgb[]

const at = (x: number, y: number): number => y * N + x
const shape = (t: number): Cells => SHAPES[t] ?? []
type Rgb = readonly [number, number, number]
const rgb = (palette: readonly Rgb[], i: number): string => {
  const [r, g, b] = palette[i] ?? palette[1] ?? [0, 0, 0]
  return `rgb(${String(r)},${String(g)},${String(b)})`
}
const pick = (n: number): number => Math.floor(Math.random() * n)

function rotate(cells: Cells, turns: number): Cells {
  let out = cells.map(([x, y]) => [x, y] as [number, number])
  for (let i = 0; i < turns; i++) out = out.map(([x, y]) => [-y, x])
  const minX = Math.min(...out.map(p => p[0]))
  const minY = Math.min(...out.map(p => p[1]))
  return out.map(([x, y]) => [x - minX, y - minY] as const)
}
const width = (cells: Cells): number => Math.max(...cells.map(p => p[0])) + 1
const fits = (board: Uint8Array, cells: Cells, ox: number, oy: number): boolean => cells.every(([x, y]) => {
  const column = x + ox
  const row = y + oy
  return column >= 0 && column < N && row < N && (row < 0 || board[at(column, row)] === 0)
})
function fullRows(board: Uint8Array): number[] {
  const rows: number[] = []
  for (let y = 0; y < N; y++) {
    let full = true
    for (let x = 0; x < N; x++) if (board[at(x, y)] === 0) full = false
    if (full) rows.push(y)
  }
  return rows
}
function removeRows(board: Uint8Array, rows: readonly number[]): void {
  const keep: Uint8Array[] = []
  for (let y = 0; y < N; y++) if (!rows.includes(y)) keep.push(board.slice(y * N, y * N + N))
  board.fill(0)
  keep.reverse().forEach((row, i) => { board.set(row, (N - 1 - i) * N) })
}

/** One frame: each cell's piece (0 empty), the falling piece's cells, and the flash of rows being cleared. */
interface Frame { readonly cells: Uint8Array; readonly active: Uint8Array; readonly flash: Float32Array }

/** The self-playing board of Peto Web's "autoplay" mode. */
class Autoplay {
  private readonly board = new Uint8Array(N * N)
  private piece: { t: number; c: Cells; x: number; y: number } | undefined
  private wait = 0
  private clearing: { rows: number[]; t: number } | undefined
  private over = 0

  private score(t: number, cells: Cells, x: number): number | undefined {
    let y = -4
    while (fits(this.board, cells, x, y + 1)) y++
    if (cells.some(([, cy]) => cy + y < 0)) return undefined
    const next = this.board.slice()
    for (const [cx, cy] of cells) next[at(cx + x, cy + y)] = t
    let height = 0
    let holes = 0
    let bump = 0
    let previous = -1
    for (let column = 0; column < N; column++) {
      let h = 0
      let seen = false
      for (let row = 0; row < N; row++) {
        if (next[at(column, row)] !== 0) {
          if (!seen) h = N - row
          seen = true
        } else if (seen) holes++
      }
      height += h
      if (previous >= 0) bump += Math.abs(h - previous)
      previous = h
    }
    return fullRows(next).length * 3.4 - height * 0.5 - holes * 3.6 - bump * 0.2
  }

  private spawn(): void {
    const t = 1 + pick(7)
    let best: { s: number; c: Cells; x: number } | undefined
    for (let r = 0; r < 4; r++) {
      const c = rotate(shape(t), r)
      for (let x = 0; x <= N - width(c); x++) {
        const s = this.score(t, c, x)
        if (s !== undefined && (best === undefined || s > best.s)) best = { s, c, x }
      }
    }
    if (best === undefined) {
      this.over = 0.6
      this.piece = undefined
      return
    }
    this.piece = { t, c: best.c, x: best.x, y: -Math.max(...best.c.map(p => p[1])) - 1 }
  }

  update(dt: number): void {
    if (this.over > 0) {
      this.over -= dt
      if (this.over <= 0) {
        this.board.fill(0)
        this.spawn()
      }
      return
    }
    if (this.clearing !== undefined) {
      this.clearing.t -= dt
      if (this.clearing.t <= 0) {
        removeRows(this.board, this.clearing.rows)
        this.clearing = undefined
        this.spawn()
      }
      return
    }
    const piece = this.piece
    if (piece === undefined) {
      this.spawn()
      return
    }
    this.wait += dt
    if (this.wait < 0.11) return
    this.wait = 0
    if (fits(this.board, piece.c, piece.x, piece.y + 1)) {
      piece.y++
      return
    }
    for (const [x, y] of piece.c) if (y + piece.y >= 0) this.board[at(x + piece.x, y + piece.y)] = piece.t
    this.piece = undefined
    const rows = fullRows(this.board)
    if (rows.length > 0) this.clearing = { rows, t: 0.36 }
    else this.spawn()
  }

  render(frame: Frame): void {
    frame.cells.set(this.board)
    const piece = this.piece
    if (piece !== undefined) {
      for (const [x, y] of piece.c) {
        if (y + piece.y < 0) continue
        frame.cells[at(x + piece.x, y + piece.y)] = piece.t
        frame.active[at(x + piece.x, y + piece.y)] = 1
      }
    }
    if (this.clearing !== undefined) {
      const on = Math.sin(this.clearing.t * 28) > 0
      for (const y of this.clearing.rows) for (let x = 0; x < N; x++) frame.flash[at(x, y)] = on ? 1 : 0.35
    }
    if (this.over > 0) frame.flash.fill(0.4)
  }
}

/** Relative luminance of a CSS `rgb()`/`rgba()` color, or undefined when it cannot be read. */
function luminance(color: string): number | undefined {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(color)
  if (match === null) return undefined
  return (0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3])) / 255
}

/** How the board is drawn: animated, a still frame, or a still frame in the system's forced colors. */
export type PetoTetrisMotion = 'animate' | 'still' | 'forced'

/**
 * Draw the board on a square canvas that fills its box. The canvas's `color` (the running row's color) tints the empty
 * cells and tells light from dark: a light text color means a dark theme. `still` draws one T piece over a row of
 * bricks without a loop; `forced` draws that frame in the text color only.
 * @param canvas - canvas laid out at its final size.
 * @param motion - animate, still, or forced colors.
 * @returns a function that stops the loop and the resize watch.
 */
export function mountPetoTetris(canvas: HTMLCanvasElement, motion: PetoTetrisMotion): () => void {
  const context = canvas.getContext('2d')
  if (context === null) return () => {}
  const ctx = context
  const engine = new Autoplay()
  const frame: Frame = { cells: new Uint8Array(N * N), active: new Uint8Array(N * N), flash: new Float32Array(N * N) }
  let size = 0

  function resize(): void {
    const box = canvas.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    size = Math.max(1, Math.min(box.width, box.height))
    canvas.width = canvas.height = Math.max(1, Math.round(size * ratio))
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  }

  function draw(): void {
    const text = getComputedStyle(canvas).color
    const light = (luminance(text) ?? 0) < 0.5
    const colors = light ? LIGHT : DARK
    const cell = size / N
    const gap = Math.max(0.5, cell * 0.16)
    const side = cell - gap
    const radius = Math.min(1.2, side * 0.25)
    ctx.clearRect(0, 0, size, size)
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const k = at(x, y)
        const type = frame.cells[k] ?? 0
        const flash = frame.flash[k] ?? 0
        if (type === 0) {
          // An empty cell is a faint square, so the grid stays visible.
          ctx.fillStyle = text
          ctx.globalAlpha = motion === 'forced' ? 0.25 : light ? 0.08 : 0.07
        } else if (motion === 'forced') {
          ctx.fillStyle = text
          ctx.globalAlpha = 1
        } else if (flash > 0) {
          // Cleared rows flash through the piece colors.
          ctx.fillStyle = rgb(colors, 1 + ((x + y + Math.floor(performance.now() / 70)) % 7))
          ctx.globalAlpha = 0.45 + flash * 0.55
        } else {
          // The falling piece is a little stronger than the pieces already resting.
          ctx.fillStyle = rgb(colors, type)
          ctx.globalAlpha = frame.active[k] === 1 ? 1 : 0.85
        }
        ctx.beginPath()
        ctx.roundRect(x * cell + gap / 2, y * cell + gap / 2, side, side, radius)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }

  if (motion !== 'animate') {
    // The still frame exists before the size watch can draw it.
    for (const [x, y] of shape(3)) {
      frame.cells[at(x + 1, y + 2)] = 3
      frame.active[at(x + 1, y + 2)] = 1
    }
    for (let x = 0; x < N; x++) if (x !== 2) frame.cells[at(x, N - 1)] = 2 + (x % 5)
  }
  resize()
  const watch = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
    resize()
    draw()
  })
  watch?.observe(canvas)
  if (motion !== 'animate') {
    draw()
    return () => { watch?.disconnect() }
  }
  let last: number | undefined
  let handle = 0
  const loop = (ms: number): void => {
    const t = ms / 1000
    const dt = last === undefined ? 0 : Math.min(0.1, t - last)
    last = t
    engine.update(dt)
    frame.cells.fill(0)
    frame.active.fill(0)
    frame.flash.fill(0)
    engine.render(frame)
    draw()
    handle = requestAnimationFrame(loop)
  }
  handle = requestAnimationFrame(loop)
  return () => {
    cancelAnimationFrame(handle)
    watch?.disconnect()
  }
}
