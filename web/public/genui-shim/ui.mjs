// The same small Wind4 component namespace is used by both application hosts.
const UI = globalThis.__macaron_UI;
if (!UI) throw new Error('UI4A components must be registered before rendering');
export const { Button, Field, Card, Badge, Tabs, Disclosure } = UI;
export default UI;
