import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.quire.reader',
  appName: 'Quire',
  webDir: 'dist',
  android: { backgroundColor: '#EFEEEC' },
  plugins: {
    // Routes http(s) fetches through the native stack so saving links and word lookups
    // aren't blocked by browser CORS rules.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
