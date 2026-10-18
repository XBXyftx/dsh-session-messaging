/**
 * Browser half: a sidebar entry and its panel for session-messaging settings,
 * update check, and author links. Built as a ModuleLoader factory (see the
 * dsh plugin UI template); the Host half carries the service and tools.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-messaging',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'session-messaging'
    const PANEL_ID = 'session-messaging'
    const PACKAGE_NAME = 'dsh-session-messaging'
    const FALLBACK_VERSION = '0.3.0'
    const NPM_URL = 'https://www.npmjs.com/package/dsh-session-messaging'
    const GITHUB_URL = 'https://github.com/XBXyftx/dsh-session-messaging'
    const BLOG_URL = 'https://xbxyftx.top'

    const zh = {
      'panel.label': '跨会话消息',
      'page.title': '跨会话消息',
      'page.subtitle': '让同一 Host 内的多个用户会话互相发消息、协调任务与写入范围。',
      'setting.title': '允许跨工作目录消息',
      'setting.desc': '开启后，不同工作目录的顶层会话也能互相发现和发送消息。',
      'setting.unavailable': '设置服务当前不可用，无法在线修改。',
      'setting.loading': '正在读取配置…',
      'setting.saveFailed': '保存失败，请重试。',
      'update.title': '版本更新',
      'update.checking': '正在检查更新…',
      'update.upToDate': '已是最新版本',
      'update.available': '发现新版本',
      'update.failed': '更新检查失败',
      'update.button': '检查更新',
      'author.title': '作者',
      'author.desc': '由 XBXyftx 开发，MIT 开源。',
      'links.npm': 'npm',
      'links.github': 'GitHub',
      'links.blog': '作者博客',
    }
    const en = {
      'panel.label': 'Session Messaging',
      'page.title': 'Session Messaging',
      'page.subtitle': 'Let user-launched sessions in the same Host message each other, coordinate tasks, and declare write scopes.',
      'setting.title': 'Allow cross-directory messages',
      'setting.desc': 'When on, top-level sessions in different working directories can discover and message each other.',
      'setting.unavailable': 'The settings service is unavailable; this value cannot be edited here.',
      'setting.loading': 'Reading configuration…',
      'setting.saveFailed': 'Saving failed. Try again.',
      'update.title': 'Updates',
      'update.checking': 'Checking for updates…',
      'update.upToDate': 'Up to date',
      'update.available': 'Update available',
      'update.failed': 'Update check failed',
      'update.button': 'Check for updates',
      'author.title': 'Author',
      'author.desc': 'Built by XBXyftx. MIT licensed.',
      'links.npm': 'npm',
      'links.github': 'GitHub',
      'links.blog': 'Blog',
    }

    const color = {
      text: 'var(--dsw-alias-label-primary)',
      secondary: 'var(--dsw-alias-label-secondary)',
      border: 'var(--dsw-alias-border-l1)',
      surface: 'var(--dsw-alias-bg-layer-1)',
      accent: 'var(--dsw-alias-brand-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
    }
    const pageStyle = {
      display: 'flex', flexDirection: 'column', gap: 16, width: '100%',
      maxWidth: 760, margin: '0 auto', padding: '28px 32px', boxSizing: 'border-box',
      color: color.text, overflowY: 'auto',
    }
    const cardStyle = {
      display: 'flex', flexDirection: 'column', gap: 14,
      background: color.surface, border: `1px solid ${color.border}`,
      borderRadius: 12, padding: 18,
    }
    const rowStyle = { display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'space-between' }
    const titleStyle = { fontSize: 15, fontWeight: 600, margin: 0, color: color.text }
    const descStyle = { fontSize: 13, lineHeight: 1.5, margin: '6px 0 0', color: color.secondary }
    const linkStyle = { color: color.accent, textDecoration: 'none', fontSize: 13 }
    const buttonStyle = {
      appearance: 'none', border: `1px solid ${color.border}`, borderRadius: 8,
      background: 'transparent', color: color.text, padding: '6px 12px',
      fontSize: 13, cursor: 'pointer',
    }

    function Icon({ size = 16 }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round',
        strokeLinejoin: 'round', 'aria-hidden': true, style: { display: 'block' },
      },
      h('path', { d: 'M4 6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8l-4 3z' }),
      h('path', { d: 'M9 13h9a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2l-3 2v-2h-4a2 2 0 0 1-2-2z' }))
    }

    function compareVersions(a, b) {
      const pa = String(a).split('-')[0].split('.').map(Number)
      const pb = String(b).split('-')[0].split('.').map(Number)
      for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
        const x = pa[i] ?? 0
        const y = pb[i] ?? 0
        if (x !== y) return x - y
      }
      return 0
    }

    function Panel({ t, form, loadCurrentVersion }) {
      const snapshot = React.useSyncExternalStore(
        React.useCallback(listener => form.subscribe(listener), [form]),
        React.useCallback(() => form.getSnapshot(), [form]),
        React.useCallback(() => form.getSnapshot(), [form]),
      )
      const [saving, setSaving] = React.useState(false)
      const [saveFailed, setSaveFailed] = React.useState(false)
      const [currentVersion, setCurrentVersion] = React.useState(FALLBACK_VERSION)
      const [update, setUpdate] = React.useState({ status: 'checking', latest: undefined })
      const ready = snapshot.status === 'ready'
      const enabled = (snapshot.value && snapshot.value.sameDirectoryOnly) === true

      const check = React.useCallback(async () => {
        setUpdate(previous => ({ ...previous, status: 'checking' }))
        try {
          const response = await fetch('https://registry.npmjs.org/dsh-session-messaging/latest')
          if (!response.ok) throw new Error(String(response.status))
          const data = await response.json()
          setUpdate({ status: 'done', latest: typeof data.version === 'string' ? data.version : undefined })
        } catch (_error) {
          setUpdate({ status: 'failed', latest: undefined })
        }
      }, [])

      React.useEffect(() => {
        let cancelled = false
        void loadCurrentVersion().then(version => { if (!cancelled) setCurrentVersion(version) })
        void check()
        return () => { cancelled = true }
      }, [check, loadCurrentVersion])

      const toggle = async () => {
        if (!ready || saving) return
        setSaving(true)
        setSaveFailed(false)
        try {
          const accepted = await form.set('sameDirectoryOnly', !enabled)
          if (!accepted) setSaveFailed(true)
        } catch (_error) {
          setSaveFailed(true)
        } finally {
          setSaving(false)
        }
      }

      const newer = update.status === 'done' && update.latest !== undefined
        && compareVersions(update.latest, currentVersion) > 0

      const settingHint = snapshot.status === 'loading'
        ? t('setting.loading')
        : snapshot.status === 'unavailable'
          ? t('setting.unavailable')
          : saveFailed ? t('setting.saveFailed') : t('setting.desc')

      return h('div', { style: pageStyle },
        h('div', null,
          h('h1', { style: { fontSize: 22, fontWeight: 650, margin: 0 } }, t('page.title')),
          h('p', { style: { ...descStyle, fontSize: 14, marginTop: 6 } }, t('page.subtitle')),
        ),
        h('section', { style: cardStyle },
          h('div', { style: rowStyle },
            h('div', null,
              h('h2', { style: titleStyle }, t('setting.title')),
              h('p', { style: { ...descStyle, color: saveFailed ? color.error : color.secondary } }, settingHint),
            ),
            h('input', {
              type: 'checkbox', checked: enabled, disabled: !ready || saving,
              onChange: () => { void toggle() }, 'aria-label': t('setting.title'),
              style: { width: 18, height: 18, accentColor: color.accent, cursor: ready ? 'pointer' : 'default' },
            }),
          ),
        ),
        h('section', { style: cardStyle },
          h('div', { style: rowStyle },
            h('div', null,
              h('h2', { style: titleStyle }, t('update.title')),
              h('p', { style: descStyle },
                update.status === 'checking' ? t('update.checking')
                  : update.status === 'failed' ? t('update.failed')
                    : newer ? `${t('update.available')} · v${update.latest}`
                      : `${t('update.upToDate')} · v${currentVersion}`),
            ),
            h('button', { type: 'button', style: buttonStyle, onClick: () => { void check() }, disabled: update.status === 'checking' },
              t('update.button')),
          ),
          newer ? h('a', { href: NPM_URL, target: '_blank', rel: 'noreferrer', style: linkStyle }, t('links.npm') + ' · v' + update.latest) : null,
        ),
        h('section', { style: cardStyle },
          h('div', { style: rowStyle },
            h('div', null,
              h('h2', { style: titleStyle }, t('author.title')),
              h('p', { style: descStyle }, t('author.desc')),
            ),
            h('div', { style: { display: 'flex', gap: 14 } },
              h('a', { href: NPM_URL, target: '_blank', rel: 'noreferrer', style: linkStyle }, t('links.npm')),
              h('a', { href: GITHUB_URL, target: '_blank', rel: 'noreferrer', style: linkStyle }, t('links.github')),
              h('a', { href: BLOG_URL, target: '_blank', rel: 'noreferrer', style: linkStyle }, t('links.blog')),
            ),
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale', 'configForms', 'remote', 'remote.pluginManager'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-messaging: locale')
        const form = ctx.configForms.get(PANEL_ID)

        const currentVersion = () => ctx.remote.pluginManager.listBundles()
          .then(rows => {
            const rowsArray = Array.isArray(rows) ? rows : []
            const own = rowsArray.find(row => row && row.name === PACKAGE_NAME)
            return own && typeof own.version === 'string' ? own.version : FALLBACK_VERSION
          })
          .catch(() => FALLBACK_VERSION)

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID, locale: NS,
          inject: () => ({ t, form, loadCurrentVersion: currentVersion }),
        }, Panel))

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 5,
          label: () => t('panel.label'), locale: NS,
        }, Icon))
      },
    }
  },
})
