/**
 * Browser half of the delete-conversation plugin.
 *
 * It adds one "Delete conversation…" row to the Session row menu and one
 * confirmation dialog in `shell.overlay`. Confirming calls the Host route
 * registered by this package's `index.js` and reloads the page, so the row
 * disappears from the sidebar once the stored session is gone.
 *
 * The plugin is plain JavaScript: it uses React from the module loader's
 * baseline table and only theme tokens for styles.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-delete-conversation',
  factory(require) {
    const React = require('react');
    const { MenuItemButton, IconTrashOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;

    const PLUGIN_ID = '@local/dsh-delete-conversation';
    const NS = 'delete-conversation';
    const CSS_ID = PLUGIN_ID + '/delete.css';
    const ROUTE = '/dsh-delete-conversation/delete';

    const zh = {
      'menu.delete': '删除对话',
      'dialog.title': '删除这个对话？',
      'dialog.body': '「{title}」的本地会话记录会被移出会话目录，并从侧栏消失。',
      'dialog.hint': '文件会移到会话根目录旁的 sessions.trash，可手动恢复；正在运行的对话不能删除。',
      'dialog.untitled': '未命名对话',
      'dialog.cancel': '取消',
      'dialog.delete': '删除',
      'dialog.busy': '正在删除…',
      'dialog.done': '已删除，正在刷新…',
      'error.live': '这个对话还在运行或仍驻留在应用内存里。先切换到其他对话，或重启应用后再删除。',
      'error.current': '这是当前正在查看的对话。先切换到其他对话，再删除它。',
      'error.notFound': '找不到这个对话的存储记录，它可能已经被删除。',
      'error.invalid': '会话 ID 不合法。',
      'error.forbidden': '请求被本地同源检查拒绝了。',
      'error.generic': '删除失败：{message}',
    };
    const en = {
      'menu.delete': 'Delete conversation',
      'dialog.title': 'Delete this conversation?',
      'dialog.body': 'The stored log of "{title}" will be moved out of the session store and the row disappears from the sidebar.',
      'dialog.hint': 'Files move to sessions.trash beside the session root, so they can be restored by hand. A running conversation cannot be deleted.',
      'dialog.untitled': 'Untitled conversation',
      'dialog.cancel': 'Cancel',
      'dialog.delete': 'Delete',
      'dialog.busy': 'Deleting…',
      'dialog.done': 'Deleted; reloading…',
      'error.live': 'This conversation is still live or running in the app. Switch to another conversation, or restart the app first.',
      'error.current': 'This is the conversation you are viewing now. Switch to another conversation before deleting it.',
      'error.notFound': 'The stored record of this conversation was not found; it may already be deleted.',
      'error.invalid': 'That session id is not valid.',
      'error.forbidden': 'The local same-origin check rejected the request.',
      'error.generic': 'Delete failed: {message}',
    };

    /** Replace the one `{name}` placeholder used by a locale template. */
    function fill(template, name, value) {
      return String(template).replace('{' + name + '}', String(value));
    }

    const CSS = `
.dshDelConvBackdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.42);
}
.dshDelConvDialog {
  box-sizing: border-box;
  width: min(420px, 100%);
  padding: 20px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-panel);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family, inherit);
}
.dshDelConvTitle {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}
.dshDelConvBody {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--dsw-alias-label-secondary);
}
.dshDelConvHint {
  margin: 0 0 14px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
.dshDelConvError {
  margin: 0 0 14px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--dsw-static-red-400-a12, rgba(217, 63, 63, 0.12));
  color: var(--dsw-alias-state-error-primary, #d93f3f);
  font-size: 12px;
  line-height: 1.5;
}
.dshDelConvDone {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--dsw-alias-state-error-primary, #d93f3f);
}
.dshDelConvFooter {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.dshDelConvButton {
  box-sizing: border-box;
  min-width: 68px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.dshDelConvButton:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dshDelConvButton:focus-visible {
  outline: 2px solid var(--dsw-alias-label-secondary);
  outline-offset: 2px;
}
.dshDelConvButton[data-danger='true'] {
  border-color: transparent;
  background: var(--dsw-alias-state-error-primary, #d93f3f);
  color: var(--dsw-alias-label-primary-inverted, #fff);
}
.dshDelConvButton[data-danger='true']:hover {
  background: var(--dsw-alias-interactive-bg-hover-danger, #c53030);
}
.dshDelConvButton:disabled {
  opacity: 0.55;
  cursor: default;
}
`;

    /** Mount the plugin stylesheet once; return the removal cleanup. */
    function mountStyles() {
      const selector = 'style[data-plugin-css="' + CSS_ID + '"]';
      if (document.querySelector(selector) !== null) return () => {};
      const tag = document.createElement('style');
      tag.dataset.plugin = PLUGIN_ID;
      tag.dataset.pluginCss = CSS_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => tag.remove();
    }

    /** Tiny external store for the one open confirmation, shared by the dialog. */
    function createDialogStore() {
      let snapshot = null;
      const listeners = new Set();
      const emit = () => {
        for (const listener of [...listeners]) listener();
      };
      return {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        getSnapshot() {
          return snapshot;
        },
        open(request) {
          snapshot = { request, phase: 'confirm', message: null };
          emit();
        },
        set(patch) {
          if (snapshot === null) return;
          snapshot = { ...snapshot, ...patch };
          emit();
        },
        close() {
          if (snapshot === null) return;
          snapshot = null;
          emit();
        },
      };
    }

    const DIALOG = createDialogStore();

    /** Filled by `apply()`: the conversation the main view currently shows. */
    let readCurrentSessionId = () => undefined;

    /**
     * Map a Host refusal onto localized copy.
     * @param t - translator bound to this plugin's namespace.
     * @param status - HTTP status.
     * @param payload - parsed response body, possibly empty.
     */
    function errorText(t, status, payload) {
      const code = payload && typeof payload.code === 'string' ? payload.code : '';
      if (code === 'session-live') return t('error.live');
      if (code === 'not-found' || code === 'files-missing') return t('error.notFound');
      if (code === 'invalid-session-id') return t('error.invalid');
      if (code === 'forbidden-origin' || code === 'missing-header') return t('error.forbidden');
      const message = payload && payload.message ? payload.message : 'HTTP ' + status;
      return fill(t('error.generic'), 'message', message);
    }

    /** Ask the Host to delete one session, returning nothing on success. */
    async function requestDelete(t, sessionId) {
      const response = await fetch(ROUTE + '?sessionId=' + encodeURIComponent(sessionId), {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'x-dsh-delete-conversation': '1',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok || !payload || payload.ok !== true) {
        throw new Error(errorText(t, response.status, payload));
      }
    }

    /**
     * One row of the Session row menu.
     * @param props - row identity, menu-open hook and localized translator.
     */
    function DeleteConversationMenuItem({ sessionId, displayTitle, useMenuOpenState, t }) {
      const [, setMenuOpen] = useMenuOpenState();
      return h(
        MenuItemButton,
        {
          icon: h(IconTrashOutlineRegular, {}),
          danger: true,
          separatorBefore: true,
          onSelect: () => {
            setMenuOpen(false);
            DIALOG.open({
              sessionId,
              title: typeof displayTitle === 'string' ? displayTitle : '',
              current: readCurrentSessionId() === sessionId,
            });
          },
        },
        t('menu.delete'),
      );
    }

    /**
     * Confirmation dialog, mounted once in the shell overlay.
     * @param props - localized translator.
     */
    function DeleteConversationDialog({ t }) {
      const snapshot = React.useSyncExternalStore(DIALOG.subscribe, DIALOG.getSnapshot);
      const cancelRef = React.useRef(null);
      const phase = snapshot === null ? null : snapshot.phase;

      React.useEffect(() => {
        if (snapshot === null) return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape' && phase !== 'busy') {
            DIALOG.close();
          }
        };
        document.addEventListener('keydown', onKeyDown);
        const timer = setTimeout(() => {
          if (cancelRef.current !== null) cancelRef.current.focus();
        }, 0);
        return () => {
          document.removeEventListener('keydown', onKeyDown);
          clearTimeout(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [snapshot === null ? null : snapshot.request.sessionId, phase]);

      if (snapshot === null) return null;

      const { request, message } = snapshot;
      const title = request.title.length > 0 ? request.title : t('dialog.untitled');
      const blocked = request.current === true;
      const confirm = async () => {
        DIALOG.set({ phase: 'busy', message: null });
        try {
          await requestDelete(t, request.sessionId);
          DIALOG.set({ phase: 'done', message: null });
          setTimeout(() => window.location.reload(), 800);
        } catch (error) {
          DIALOG.set({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      };

      return h(
        'div',
        {
          className: 'dshDelConvBackdrop',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && phase !== 'busy') DIALOG.close();
          },
        },
        h(
          'div',
          {
            className: 'dshDelConvDialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'dshDelConvTitle',
          },
          h('h2', { id: 'dshDelConvTitle', className: 'dshDelConvTitle' }, t('dialog.title')),
          h('p', { className: 'dshDelConvBody' }, fill(t('dialog.body'), 'title', title)),
          h('p', { className: 'dshDelConvHint' }, t('dialog.hint')),
          blocked ? h('p', { className: 'dshDelConvError', role: 'alert' }, t('error.current')) : null,
          phase === 'error' && message !== null
            ? h('p', { className: 'dshDelConvError', role: 'alert' }, message)
            : null,
          phase === 'done' ? h('p', { className: 'dshDelConvDone', role: 'status' }, t('dialog.done')) : null,
          h(
            'div',
            { className: 'dshDelConvFooter' },
            h(
              'button',
              {
                ref: cancelRef,
                type: 'button',
                className: 'dshDelConvButton',
                disabled: phase === 'busy' || phase === 'done',
                onClick: () => DIALOG.close(),
              },
              t('dialog.cancel'),
            ),
            blocked
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshDelConvButton',
                    'data-danger': 'true',
                    disabled: phase === 'busy' || phase === 'done',
                    onClick: () => {
                      void confirm();
                    },
                  },
                  phase === 'busy' ? t('dialog.busy') : t('dialog.delete'),
                ),
          ),
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        readCurrentSessionId = () => {
          try {
            const service = ctx.get('uiWorkspace');
            const id = service && service.mainReference ? service.mainReference.sessionId : undefined;
            return typeof id === 'string' ? id : undefined;
          } catch {
            return undefined;
          }
        };
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'delete-conversation: dictionaries');
        ctx.effect(mountStyles, 'delete-conversation: stylesheet');
        ctx.effect(() => () => DIALOG.close(), 'delete-conversation: dialog cleanup');
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.menu.item',
              id: 'delete-conversation',
              order: 460,
              locale: NS,
            },
            DeleteConversationMenuItem,
          ),
        );
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'delete-conversation-dialog',
              order: 50,
              locale: NS,
            },
            DeleteConversationDialog,
          ),
        );
      },
    };
  },
});
