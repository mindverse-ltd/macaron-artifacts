import type { ComponentProps, ReactNode } from 'react';
import { Button as HeadlessButton, Field as HeadlessField, Input, Label, Description, Disclosure as HeadlessDisclosure, DisclosureButton, DisclosurePanel, Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import { Icon } from './Icon';

const variants = { primary: 'bg-accent text-accent-fg hover:bg-accent-hover', secondary: 'border border-secondary-border-rest bg-secondary text-secondary-fg hover:bg-secondary-hover hover:text-secondary-fg', ghost: 'text-muted hover:bg-surface-3 hover:text-hover-fg', danger: 'bg-danger-bg text-danger-fg hover:bg-danger-hover' };
// Generated content can contain stacked labels; retain the normal control size without clipping taller children.
const sizes = { sm: 'min-h-8 px-3 py-1.5 text-xs', md: 'min-h-9 px-4 py-1.5 text-sm' };
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export function Button({ variant = 'primary', size = 'md', className = '', type = 'button', ...props }: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  return <HeadlessButton type={type} className={`pressable interactive inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap active:scale-[0.98] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${focus} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
}

export function Field({ label, hint, className = '', ...props }: ComponentProps<'input'> & { label: string; hint?: string }) {
  return <HeadlessField className="flex flex-col gap-1.5"><Label className="text-xs font-medium text-muted">{label}</Label><Input className={`interactive w-full min-w-0 rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm text-input-fg placeholder:text-input-placeholder focus:border-input-focus focus:outline-none data-[disabled]:opacity-50 ${className}`} {...props} />{hint ? <Description className="text-xs text-muted">{hint}</Description> : null}</HeadlessField>;
}

export function Card({ className = '', ...props }: ComponentProps<'div'>) { return <div className={`@container rounded-xl bg-surface-2 p-4 ${className}`} {...props} />; }
export function Badge({ className = '', ...props }: ComponentProps<'span'>) { return <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-status px-2 py-0.5 text-xs text-status-fg ${className}`} {...props} />; }

export function Tabs({ items, value, onChange }: { items: { id: string; label: ReactNode; children: ReactNode }[]; value?: string; onChange?: (id: string) => void }) {
  const index = value === undefined ? undefined : Math.max(0, items.findIndex(item => item.id === value));
  // Native focus can leave a partially visible tab clipped; reveal the full label without changing keyboard selection.
  return <TabGroup className="min-w-0" selectedIndex={index} onChange={next => { const item = items[next]; if (item) onChange?.(item.id); }}><TabList className="scroll-x flex gap-2 rounded-lg bg-surface-2 p-1">{items.map(item => <Tab key={item.id} onFocus={event => event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })} className={`interactive h-9 shrink-0 whitespace-nowrap rounded-md px-3 text-sm text-muted data-[selected]:bg-tab-active data-[selected]:text-tab-active-fg ${focus}`}>{item.label}</Tab>)}</TabList><TabPanels className="mt-5">{items.map(item => <TabPanel key={item.id}>{item.children}</TabPanel>)}</TabPanels></TabGroup>;
}

export function Disclosure({ title, children, defaultOpen }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return <HeadlessDisclosure defaultOpen={defaultOpen}>{({ open }) => <div className="overflow-clip rounded-lg bg-surface-2"><DisclosureButton className={`interactive flex w-full items-center justify-between gap-2 rounded-lg px-4 py-3 text-left text-sm hover:bg-surface-3 hover:text-hover-fg ${focus}`}>{title}<Icon name="chevronRight" className={`size-4 shrink-0 ${open ? 'rotate-90' : ''}`} /></DisclosureButton><DisclosurePanel static hidden={!open} className="p-4 text-sm">{children}</DisclosurePanel></div>}</HeadlessDisclosure>;
}
