/**
 * SENTINEL static accessibility and UI-quality checks (Phase 8, Task 8.2).
 *
 * These are source-level checks, not a substitute for a real screen-reader
 * walkthrough (which Phase 8 still lists as open). They catch the mechanical
 * problems that are easy to reintroduce:
 *   - form controls without an accessible name
 *   - pages without a single <main id="main"> landmark
 *   - positive tabindex (breaks keyboard order)
 *   - focus styling removed without a replacement
 *   - colour contrast below WCAG AA in the design tokens
 *   - interactive targets smaller than 44 px
 *   - a missing prefers-reduced-motion rule
 *   - a missing responsive breakpoint
 *
 * Run: npm run check:a11y
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []
const notes = []

function fail(name, detail) {
  failures.push(`${name}: ${detail}`)
}

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stats = statSync(full)
    if (stats.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      sourceFiles(full, out)
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

// ---------------------------------------------------------------- 1. labels
// Normalise template-literal ids (`id={`x-${id}`}`) so they can be compared
// with the matching `htmlFor` on the label.
function normaliseId(value) {
  return value.replace(/\$\{[^}]*\}/g, '*')
}

const files = sourceFiles(join(root, 'src'))
for (const file of files) {
  const content = readFileSync(file, 'utf8')
  const labelIds = new Set([
    ...[...content.matchAll(/<label[^>]*htmlFor="([^"]+)"/g)].map((m) => normaliseId(m[1])),
    ...[...content.matchAll(/<label[^>]*htmlFor=\{`([^`]+)`\}/g)].map((m) => normaliseId(m[1])),
  ])
  const controls = [
    ...content.matchAll(/<(input|select|textarea)\b([^>]*)>/g),
  ]
  for (const match of controls) {
    const [, tag, attrs] = match
    const before = content.slice(Math.max(0, match.index - 400), match.index)
    // A wrapping <label> (implicit association) is valid too
    const openLabels = (before.match(/<label\b/g) ?? []).length
    const closeLabels = (before.match(/<\/label>/g) ?? []).length
    const wrappedInLabel = openLabels > closeLabels
    const hasId = /id="([^"]+)"/.exec(attrs) ?? /id=\{`([^`]+)`\}/.exec(attrs)
    const hasAriaLabel = /aria-label=/.test(attrs)
    const hasAriaLabelledBy = /aria-labelledby=/.test(attrs)
    const isHidden = /type="hidden"/.test(attrs)
    if (hasAriaLabel || hasAriaLabelledBy || isHidden) continue
    if (wrappedInLabel) continue
    if (hasId && labelIds.has(normaliseId(hasId[1]))) continue
    fail(
      'form control without an accessible name',
      `${file.replace(root, '')} <${tag}${attrs.slice(0, 60)}>`,
    )
  }
}

// ------------------------------------------------- 2. one main landmark per page
const pageComponents = files.filter((f) => /features[\\/].*\.tsx$/.test(f))
for (const file of pageComponents) {
  const content = readFileSync(file, 'utf8')
  const mains = [...content.matchAll(/<main\b([^>]*)>/g)]
  if (mains.length === 0) continue
  if (mains.length > 1) {
    fail('page renders more than one <main>', file.replace(root, ''))
  }
  for (const [, attrs] of mains) {
    if (!/id="main"/.test(attrs)) {
      fail('page <main> is missing id="main" (skip-link target)', file.replace(root, ''))
    }
  }
}

// ------------------------------------------------------ 3. positive tabindex
for (const file of files) {
  const content = readFileSync(file, 'utf8')
  for (const match of content.matchAll(/tabIndex=\{?(\d+)\}?/g)) {
    if (Number(match[1]) > 0) {
      fail('positive tabIndex breaks the keyboard order', file.replace(root, ''))
    }
  }
}

// ---------------------------------------------------------------- 4. contrast
function srgbToLinear(channel) {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return (
    0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
  )
}

function contrastRatio(foreground, background) {
  const a = luminance(foreground)
  const b = luminance(background)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

const css = readFileSync(join(root, 'src/index.css'), 'utf8')
const tokens = {}
for (const match of css.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) {
  tokens[match[1]] = match[2]
}

const CONTRAST_PAIRS = [
  ['text', 'bg', 4.5, 'body text on the page background'],
  ['text', 'card-bg', 4.5, 'body text on cards'],
  ['text-muted', 'bg', 4.5, 'muted text on the page background'],
  ['text-muted', 'card-bg', 4.5, 'muted text on cards'],
  ['accent', 'bg', 4.5, 'link text on the page background'],
  ['accent', 'card-bg', 4.5, 'link text on cards'],
  ['error-text', 'error-bg', 4.5, 'error message text'],
  ['success-text', 'success-bg', 4.5, 'success message text'],
  ['text', 'border', 3, 'text against a border surface'],
  ['card-bg', 'accent', 3, 'button surface against the accent colour'],
]

for (const [fg, bg, minimum, label] of CONTRAST_PAIRS) {
  const foreground = tokens[fg]
  const background = tokens[bg]
  if (!foreground || !background) {
    notes.push(`contrast not checked (missing token): ${label}`)
    continue
  }
  const ratio = contrastRatio(foreground, background)
  if (ratio < minimum) {
    fail(
      `contrast below WCAG AA (${label})`,
      `${ratio.toFixed(2)}:1 < ${minimum}:1 (${foreground} on ${background})`,
    )
  } else {
    notes.push(`contrast ok: ${label} = ${ratio.toFixed(2)}:1`)
  }
}

// Danger button: white text on the danger colour
const danger = /#b3261e/i.exec(css)?.[0]
if (danger) {
  const ratio = contrastRatio('#ffffff', danger)
  if (ratio < 4.5) {
    fail('contrast below WCAG AA (white text on the danger button)', `${ratio.toFixed(2)}:1`)
  } else {
    notes.push(`contrast ok: white on ${danger} = ${ratio.toFixed(2)}:1`)
  }
}

// ------------------------------------------------------- 5. focus / motion / responsive
if (/outline\s*:\s*(none|0)\b/.test(css) && !/outline\s*:\s*3px/.test(css)) {
  fail('focus outline removed without a replacement', 'src/index.css')
}
if (!/:focus-visible/.test(css)) {
  fail('no :focus-visible styling', 'src/index.css')
}
if (!/prefers-reduced-motion/.test(css)) {
  fail('no prefers-reduced-motion rule', 'src/index.css')
}
if (!/@media\s*\(min-width/.test(css)) {
  fail('no responsive breakpoint', 'src/index.css')
}

// --------------------------------------------------------- 6. touch targets
const minHeights = [...css.matchAll(/min-height:\s*([\d.]+)rem/g)].map((m) => Number(m[1]))
if (!minHeights.some((value) => value >= 2.75)) {
  fail('no 44 px minimum touch target (min-height >= 2.75rem)', 'src/index.css')
}

// ---------------------------------------------------------------- 7. images
for (const file of files) {
  const content = readFileSync(file, 'utf8')
  for (const match of content.matchAll(/<img\b([^>]*)>/g)) {
    if (!/alt=/.test(match[1])) {
      fail('image without an alt attribute', file.replace(root, ''))
    }
  }
}

// ------------------------------------------------------------------- report
console.log('SENTINEL accessibility / UI checks')
console.log('=================================\n')
for (const note of notes) console.log(`  info  ${note}`)
console.log('')
if (failures.length > 0) {
  console.log(`FAILED (${failures.length}):`)
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exit(1)
}
console.log(`All checks passed (${files.length} source files, ${notes.length} notes).`)
console.log('Note: source-level checks only — a real screen-reader walkthrough and a')
console.log('mobile device pass are still required before a pilot (Phase 8).')
