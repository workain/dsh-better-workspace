import { readFileSync } from 'node:fs'
import vm from 'node:vm'
export const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
export function chunk(name, modules = {}) {
  let result
  vm.runInNewContext(source('src/client.' + name + '.js'), {
    window: { __ModuleLoader__: { load: ({ factory }) => { result = factory(id => modules[id] || {}) } } },
    console, setTimeout, clearTimeout, Map, Set, Promise, Error, Object, JSON,
  })
  return result
}
// Evaluate the actual entry's factory; expose pure helpers ONLY in this VM.
// No debug export or testing mode is shipped in the production bundle.
export function entryHelpers(operations, modules = {}) {
  let result
  const text = source('src/client.js').replace("      name: 'dsh-better-workspace',\n      // The list stays", `      helpers: { splitTitleSegs, buildTree, materializeChain, compressTree, buildSessionTree, findSessionGroup, collectSessionRows, groupsAllowedFor, diskParentMapOf, subagentRunningCounts, WorkspaceRow, HeroWorkspacePicker },\n      name: 'dsh-better-workspace',\n      // The list stays`)
    .replace('let operations, serviceFeature', 'let operations = injectedOperations, serviceFeature')
  const React = { Component: class {}, createElement: () => {} }
  vm.runInNewContext(text, { injectedOperations: operations,
    window: { __ModuleLoader__: { load: ({ factory }) => { result = factory(id => modules[id] || (id === 'react' ? React : {})) } } },
    console, setTimeout, clearTimeout, Map, Set,
  })
  return result.helpers
}
