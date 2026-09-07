import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { WorkspaceProvider } from './chat/WorkspaceProvider';
import { ThemeProvider } from './theme/ThemeProvider';
import 'virtual:uno.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><ThemeProvider><WorkspaceProvider><App /></WorkspaceProvider></ThemeProvider></StrictMode>);
