import { useId, type ComponentProps, type ReactNode } from 'react';
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';

export function Button({ variant = 'primary', size = 'md', className = '', type = 'button', ...props }: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  return <button type={type} className={`ui4a-button ui4a-button-${variant} ui4a-button-${size} ${className}`} {...props} />;
}

export function Field({ label, hint, id, className = '', ...props }: ComponentProps<'input'> & { label: string; hint?: string }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return <div className="ui4a-field"><label htmlFor={inputId}>{label}</label><input id={inputId} aria-describedby={hint ? `${inputId}-hint` : undefined} className={className} {...props} />{hint ? <span id={`${inputId}-hint`} className="text-xs text-muted">{hint}</span> : null}</div>;
}

export function Card({ className = '', ...props }: ComponentProps<'div'>) { return <div className={`ui4a-card ${className}`} {...props} />; }
export function Badge({ className = '', ...props }: ComponentProps<'span'>) { return <span className={`ui4a-badge ${className}`} {...props} />; }

export function Tabs({ items, value, onChange }: { items: { id: string; label: ReactNode; children: ReactNode }[]; value?: string; onChange?: (id: string) => void }) {
  const index = value === undefined ? undefined : Math.max(0, items.findIndex(item => item.id === value));
  return <TabGroup selectedIndex={index} onChange={next => { const item = items[next]; if (item) onChange?.(item.id); }}><TabList className="ui4a-tabs">{items.map(item => <Tab key={item.id} className="ui4a-tab">{item.label}</Tab>)}</TabList><TabPanels className="pt-3">{items.map(item => <TabPanel key={item.id}>{item.children}</TabPanel>)}</TabPanels></TabGroup>;
}

export function Disclosure({ title, children, defaultOpen }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return <details className="ui4a-disclosure" open={defaultOpen}><summary>{title}</summary><div className="px-3 pb-3">{children}</div></details>;
}
