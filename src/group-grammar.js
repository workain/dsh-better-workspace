/** Shared title grammar. The checked-in client block is verified byte-for-byte by tests. MIT. */
    const splitPlainSegs = (text) => {
      const s = String(text || '')
      const schemeAt = s.indexOf('://')
      if (schemeAt === -1) return s.split('/').map(x => x.trim()).filter(Boolean)
      const cut = s.lastIndexOf('/', schemeAt)
      const segs = (cut === -1 ? '' : s.slice(0, cut)).split('/').map(x => x.trim()).filter(Boolean)
      const tail = s.slice(cut + 1).trim()
      if (tail !== '') segs.push(tail)
      return segs
    }

    /**
     * A title that QUOTES an absolute path is a sentence, not a name
     * hierarchy (v0.37.2, issue #17): the host auto-titles a new session by
     * echoing its first message verbatim, so "/Users/x/repo/file.md" used to
     * shred into one fake folder per segment. Detection stays narrow on
     * purpose — a token starts at line start / whitespace with "/" (or a
     * "C:/" drive form) and carries at least one more "/" — so plain name
     * groups ("web/前端") and relative pairs ("a/b") keep splitting.
     */
    const titleQuotesPath = (text) => {
      // A path inside a PAIRED quote span is already an opaque leaf (the
      // quote parser below keeps it verbatim), so only the unquoted remainder
      // can be mistaken for a name hierarchy. "~/.dsh/..." and "./..." are
      // paths even when they carry only one slash; drive-letter paths are
      // paths by construction. A bare "https://" is not matched (it does not
      // start with a slash).
      // Mask quotes without inventing whitespace before a slash in a group.
      const s = String(text || '').replace(/"[^"]*"|“[^”]*”/g, 'quoted')
      const re = /(?:^|\s)(?:(?:[A-Za-z]:)?\/\S+|(?:~|\.{1,2})\/\S+)/g
      let m
      while ((m = re.exec(s)) !== null) {
        const token = m[0].trim()
        if (/^[A-Za-z]:[\\/]/.test(token)) return true
        if (/^(?:~|\.{1,2})\//.test(token)) return true
        if ((token.match(/\//g) || []).length >= 2) return true
      }
      return false
    }

    /**
     * Title → hierarchy segments, QUOTE-AWARE: a PAIRED “…” (or "…") span is
     * verbatim — slashes inside quotes never split, the quotes stay part of
     * the leaf. Text outside paired spans splits through splitPlainSegs
     * (URL-tail opaque). A LONE quote character — an opener with no matching
     * closer, or a closer without an opener — is an ORDINARY character and
     * splits normally around it (0.9.1 swallowed the tail after an
     * unterminated opener; the user wants lone quotes as plain text).
     * Grouping is a pure projection, so previously shredded titles re-flow
     * on reload.
     */
    const splitTitleSegs = (title, allowGroups = true) => {
      const s = String(title || '')
      if (allowGroups === false) return s.trim() === '' ? [] : [s.trim()]
      if (titleQuotesPath(s)) return [s.trim()]
      if (!/["“]/.test(s)) return splitPlainSegs(s)
      const out = []
      let plain = ''
      let i = 0
      while (i < s.length) {
        const ch = s[i]
        if (ch === '"' || ch === '“') {
          const close = ch === '“' ? '”' : '"'
          const j = s.indexOf(close, i + 1)
          if (j === -1) { // lone opener: ordinary character, keep scanning
            plain += ch
            i += 1
            continue
          }
          const end = j + 1
          const quoted = s.slice(i, end).trim()
          // Quotes protect a slash INSIDE a leaf; they do not manufacture a
          // group out of ordinary punctuation. "受阻" in a sentence stays
          // part of the surrounding leaf (issue #19), so the pending plain
          // text is only flushed when the quoted span itself carries a slash.
          if (quoted !== '' && quoted.includes('/')) {
            for (const seg of splitPlainSegs(plain)) out.push(seg)
            plain = ''
            out.push(quoted)
          } else {
            plain += quoted
          }
          i = end
          continue
        }
        plain += ch
        i += 1
      }
      for (const seg of splitPlainSegs(plain)) out.push(seg)
      return out
    }

export { splitTitleSegs, titleQuotesPath }
