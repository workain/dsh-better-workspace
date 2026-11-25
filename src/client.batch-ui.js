/** Bulk writes are sequential and non-atomic: preview and explicit outcome report. MIT. */
window.__ModuleLoader__.load({
  id: 'dsh-better-workspace', chunk: 'client.batch-ui.js',
  factory: (require) => {
    const React = require('react'), E = React.createElement
    const ui = require('@deepseek-ai/dsh-client-ui-primitives')
    function BatchDialog({ plan, run, reconcile, onClose, t }) {
      const [busy, setBusy] = React.useState(false), [report, setReport] = React.useState(null), [error, setError] = React.useState('')
      const lock = React.useRef(false)
      const commit = async () => {
        if (lock.current) return
        lock.current = true; setBusy(true)
        try { setReport(await run()) }
        catch { setError(t('batch.stale')) }
        finally { setBusy(false) }
      }
      return E(ui.Modal, { open: true, title: t('batch.title'), closeLabel: t('close'),
        onClose: busy ? () => {} : onClose,
        footer: E('div', { className: 'bw-modal-actions' },
          E('button', { type: 'button', disabled: busy, onClick: onClose }, t('close')),
          report ? E('button', { type: 'button', disabled: busy, onClick: async () => {
            setBusy(true)
            try { await reconcile(); setError(t('batch.refreshed')) } catch { setError(t('batch.readError')) }
            finally { setBusy(false) }
          } }, t('batch.refresh')) : null,
          !report && !error ? E('button', { type: 'button', disabled: busy, onClick: commit }, t('confirm')) : null),
      }, E('div', { className: 'bw-modal-body' },
        E('p', null, t('batch.warning')),
        E('div', { style: { maxHeight: '50vh', overflow: 'auto' } },
          (report || plan.changes).map(row => E('div', { key: row.id },
            E('code', null, row.id), ' · ', row.before, ' → ', row.after,
            row.outcome ? E('strong', null, ' · ' + t('batch.' + row.outcome)) : null))),
        plan.changes.length === 0 ? E('p', null, t('batch.empty')) : null,
        error ? E('p', { role: 'status' }, error) : null))
    }
    return { BatchDialog }
  },
})
