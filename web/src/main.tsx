import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './ui/App';
import { boot } from './sync/engine';

const theme = localStorage.getItem('frogity-theme');
if (theme) document.documentElement.dataset.theme = theme;

createRoot(document.getElementById('root')!).render(<App />);
void boot();
