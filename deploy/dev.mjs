process.env.NODE_ENV = 'development';
process.env.NEXT_TELEMETRY_DISABLED = '1';
process.env.SMA_CENTER_SELF_HOSTED = '1';
process.env.SMA_CENTER_DATA_DIR ||= new URL('../.sma-center-data/', import.meta.url).pathname;
await import('./server.mjs');
