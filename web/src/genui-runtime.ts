// Bootstrapper for the GenUI runtime — sets the __macaron_* globals the
// generated-code shims re-export from at runtime, then re-exports
// GenuiPreview so the caller can render it. Split into its own module
// because the Claude bundle sets these globals at boot (see main.tsx) but
// the Codex bundle deliberately doesn't — this lets the Codex chat
// lazy-load the whole runtime the first time render_ui appears in a
// thread, keeping the default codex bundle small.
//
// Idempotent: if globals are already populated (e.g. we're inside the
// Claude bundle) we just re-export GenuiPreview without touching them.

import * as ReactNamespace from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import * as JSXDevRuntime from 'react/jsx-dev-runtime';
import * as ReactDOMNamespace from 'react-dom';
import * as MacaronUI from '@genui/ui';
import * as MacaronCharts from '@genui/ui/charts';
import * as MacaronLucide from '@genui/ui/icons';
import '@genui/ui/style.css';
import * as Motion from 'motion/react';

import './lib/uno-runtime';

const g = globalThis as unknown as Record<string, unknown>;

if (!g.__macaron_React) {
  g.__macaron_React = ReactNamespace;
  g.__macaron_JSXRuntime = JSXRuntime;
  g.__macaron_JSXDevRuntime = JSXDevRuntime;
  g.__macaron_ReactDOM = ReactDOMNamespace;
  g.__macaron_UI = MacaronUI;
  g.__macaron_Charts = MacaronCharts;
  g.__macaron_Lucide = MacaronLucide;
  g.__macaron_Motion = Motion;

}

export { GenuiPreview } from './components/GenuiPreview';
