import '@vscode/codicons/dist/codicon.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { handleHostMessage } from './store';
import './styles.css';
import { post } from './vscode';

window.addEventListener('message', event => handleHostMessage(event.data));
createRoot(document.getElementById('root')!).render(<App />);
post({ type: 'ready' });
