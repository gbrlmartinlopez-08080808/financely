import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.quire.reader',
  appName: 'Frogity',
  webDir: 'dist',
  android: { backgroundColor: '#EFEEEC' },
  plugins: {
    // Routes http(s) fetches through the native stack so saving links and word lookups
    // aren't blocked by browser CORS rules.
    CapacitorHttp: { enabled: true },
    LocalNotifications: { smallIcon: 'ic_stat_frogity', iconColor: '#111111' },
  },
};

export default config;
