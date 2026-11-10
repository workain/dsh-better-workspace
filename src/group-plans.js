/** Exact title-only plans for one explicit workspace. MIT. */
import { splitTitleSegs } from './group-grammar.js'
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
export const prefix = (parts, base) => parts.length > base.length && base.every((v, i) => parts[i] === v)
export function groupPath(value, allowRoot = true) {
  if (!Array.isArray(value) || value.length > 16 || (!allowRoot && !value.length) || value.some(s => typeof s !== 'string' || !s.trim() || s !== s.trim() || s.length > 256 || /[\u0000-\u001f\u007f]/u.test(s))) throw new Error('invalid-group')
  if (value.length && !same(splitTitleSegs([...value, 'probe-leaf'].join('/')).slice(0, -1), value)) throw new Error('unrepresentable-group')
  return value.slice()
}
export function parsed(row) { return splitTitleSegs(row.title || '', row.sourceKind === 'user') }
export function moveTitle(row, target) {
  const parts = parsed(row), leaf = row.sourceKind === 'user' ? parts.at(-1) : row.title
  if (typeof leaf !== 'string' || !leaf.trim()) throw new Error('missing-title')
  const candidates = [leaf, '“' + leaf + '”', '"' + leaf + '"']
  for (const candidate of candidates) {
    const title = [...target, candidate].join('/')
    if (title.length <= 4096 && same(splitTitleSegs(title), [...target, candidate])) return title
  }
  throw new Error('unrepresentable-title')
}
export function planRows(rows, command) {
  const target = groupPath(command.targetGroup)
  const selected = command.sessionIds && new Set(command.sessionIds)
  const source = command.sourceGroup && groupPath(command.sourceGroup, false)
  if (source && same(source, target)) throw new Error('same-group')
  if (source && target.length > source.length && source.every((v, i) => target[i] === v)) throw new Error('recursive-group')
  const report = []
  for (const row of rows) {
    if (selected ? !selected.has(row.id) : !(row.sourceKind === 'user' && prefix(parsed(row), source))) continue
    const result = { id: row.id, before: row.title ?? null, sourceKind: row.sourceKind ?? null, outcome: 'not-attempted' }
    if (row.error) { report.push({ ...result, outcome: 'excluded', reason: row.error }); continue }
    try {
      const after = source ? [...target, ...parsed(row).slice(source.length)].join('/') : moveTitle(row, target)
      if (after.length > 4096 || (source && !same(splitTitleSegs(after), [...target, ...parsed(row).slice(source.length)]))) throw new Error('unrepresentable-title')
      report.push({ ...result, after, expected: { title: row.title, sourceKind: row.sourceKind, eventSeq: row.eventSeq } })
    } catch (error) { report.push({ ...result, outcome: 'excluded', reason: error.message }) }
  }
  if (selected) for (const id of selected) if (!rows.some(row => row.id === id)) report.push({ id, before: null, outcome: 'excluded', reason: 'not-in-workspace' })
  if (source && !report.length) throw new Error('group-not-found')
  return report
}
export function groupsOf(rows) {
  const map = new Map()
  for (const row of rows) {
    if (row.error || row.sourceKind !== 'user') continue
    const parts = parsed(row)
    for (let i = 1; i < parts.length; i++) {
      const path = parts.slice(0, i), key = JSON.stringify(path)
      if (!map.has(key)) map.set(key, { path, sessionIds: [] })
      map.get(key).sessionIds.push(row.id)
    }
  }
  return [...map.values()]
}
