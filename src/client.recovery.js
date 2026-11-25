/** Root recovery withdraws registrations; native owners retain their child holes. MIT. */
window.__ModuleLoader__.load({
  id: 'dsh-better-workspace', chunk: 'client.recovery.js',
  factory: (require) => {
    const React = require('react'), E = React.createElement
    const createRestoration = () => {
      const registrations = new Set()
      let disabled = false
      return {
        add(dispose) { if (disabled) dispose(); else registrations.add(dispose) },
        restore() {
          disabled = true
          for (const dispose of registrations) dispose()
          registrations.clear()
        },
        get disabled() { return disabled },
      }
    }
    class RootBoundary extends React.Component {
      constructor(props) { super(props); this.state = { failed: false, retry: 0 } }
      static getDerivedStateFromError() { return { failed: true } }
      componentDidCatch() { console.error('[dsh-better-workspace] tree render failed; recovery available') }
      render() {
        if (!this.state.failed) return E(React.Fragment, { key: this.state.retry }, this.props.children)
        const t = this.props.t
        return E('div', { role: 'alert', className: 'bw-recovery' },
          E('p', null, t('recovery.message')),
          E('button', { type: 'button', onClick: () => this.setState(s => ({ failed: false, retry: s.retry + 1 })) }, t('recovery.retry')),
          E('button', { type: 'button', onClick: this.props.restore }, t('recovery.stock')))
      }
    }
    return { createRestoration, RootBoundary }
  },
})
