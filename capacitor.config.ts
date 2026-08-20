import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chengyang.codetutor',
  appName: 'ai-code-tutor-ide',
  webDir: 'dist',
  server: {
    // Local Android reader-room development uses ws:// on the LAN.
    // Without this, Capacitor serves the WebView from an HTTPS origin
    // and WebView blocks ws:// as mixed content before construction.
    //
    // For production, move the relay to wss:// and restore HTTPS.
    androidScheme: 'http',
    cleartext: true,
  },
};

export default config;
