import { createRoot } from 'react-dom/client';
import './styles/base.css';
import './styles/fonts.css';
import './styles/reader.css';
import './styles/ui.css';
import './styles/overlays.css';
import App from './App';

/** Lay the interface out ~8% smaller than the device width (everything scales together). */
const UI_SCALE = 0.92;
function fitViewport() {
  const sw = screen.width || window.innerWidth;
  const w = sw < 700 ? Math.round(sw / UI_SCALE) : 0;
  const meta = document.querySelector('meta[name="viewport"]');
  meta?.setAttribute('content', w ? `width=${w}, viewport-fit=cover, user-scalable=no, interactive-widget=resizes-content` : 'width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no, interactive-widget=resizes-content');
}
fitViewport();
let rt = 0;
window.addEventListener('orientationchange', () => setTimeout(fitViewport, 250));
window.addEventListener('resize', () => {
  clearTimeout(rt);
  rt = window.setTimeout(() => {
    const m = document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '';
    const want = Math.round((screen.width || window.innerWidth) / UI_SCALE);
    if (!m.includes(`width=${want}`) && (screen.width || 0) < 700) fitViewport();
  }, 300);
});

createRoot(document.getElementById('root')!).render(<App />);
