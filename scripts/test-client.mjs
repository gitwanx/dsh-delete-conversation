// Plain-Node smoke test for the client half: execute the module-loader factory,
// apply it against a fake Cordis context and render the menu row element.
// Rendering the dialog is left to the real browser (it uses hooks), but this
// catches factory/apply/registration errors and missing locale keys.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const PROFILE = "C:/Users/wang'xing/.dsh/profiles/desktop";
const profileRequire = createRequire(PROFILE + '/package.json');
const React = profileRequire('react');

/** Stand-ins for the baseline primitives the real module loader provides. */
const MenuItemButton = (props) => ({ type: 'MenuItemButton', props });
const IconTrashOutlineRegular = () => null;

let factory = null;
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory: f }) {
      assert.equal(id, '@local/dsh-delete-conversation');
      factory = f;
    },
  },
};
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {} }),
  head: { appendChild() {} },
  addEventListener() {},
  removeEventListener() {},
};

const req = (name) => {
  if (name === 'react') return React;
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return { MenuItemButton, IconTrashOutlineRegular };
  throw new Error('unexpected module request: ' + name);
};

const client = await import('../client.js');
assert.equal(typeof factory, 'function');
const plugin = factory(req);
assert.equal(typeof plugin.apply, 'function');

const registrations = [];
const dictionaries = new Map();
const ctx = {
  get: () => undefined,
  effect(fn) {
    return typeof fn === 'function' ? fn() : undefined;
  },
  locale: {
    register(ns, dict) {
      dictionaries.set(ns, dict);
      return () => {};
    },
  },
  slots: {
    inject(_name, fn) {
      fn();
      return () => {};
    },
    register(options, component) {
      registrations.push({ options, component });
      return () => {};
    },
  },
};
plugin.apply(ctx);

const menu = registrations.find((r) => r.options.name === 'sidebar.workspaces.session.menu.item');
assert.ok(menu, 'menu registration');
assert.equal(menu.options.id, 'delete-conversation');
assert.equal(menu.options.order, 460);
const overlay = registrations.find((r) => r.options.name === 'shell.overlay');
assert.ok(overlay, 'overlay registration');
assert.equal(overlay.options.id, 'delete-conversation-dialog');

const dict = dictionaries.get('delete-conversation');
assert.ok(dict);
const required = [
  'menu.delete', 'dialog.title', 'dialog.body', 'dialog.hint', 'dialog.untitled',
  'dialog.cancel', 'dialog.delete', 'dialog.busy', 'dialog.done',
  'error.live', 'error.current', 'error.notFound', 'error.invalid', 'error.forbidden', 'error.generic',
];
for (const key of required) {
  assert.ok(typeof dict.zh[key] === 'string' && dict.zh[key].length > 0, 'zh missing ' + key);
  assert.ok(typeof dict.en[key] === 'string' && dict.en[key].length > 0, 'en missing ' + key);
}

let closed = false;
const element = menu.component({
  sessionId: 'session-test',
  displayTitle: 'Test title',
  useMenuOpenState: () => [false, () => { closed = true; }],
  t: (key) => 'T:' + key,
});
assert.equal(element.type, MenuItemButton);
assert.equal(element.props.danger, true);
assert.equal(element.props.separatorBefore, true);
assert.equal(element.props.icon.type, IconTrashOutlineRegular);
assert.deepEqual(element.props.children, 'T:menu.delete');
element.props.onSelect();
assert.equal(closed, true);

console.log('client smoke test passed');
