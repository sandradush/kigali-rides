import { createApp } from './app';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function main() {
  const { app, deps } = await createApp();

  const server = app.listen(PORT, () => {
    console.log(`kigali-rides listening on :${PORT}`);
  });

  function shutdown(signal: string) {
    console.log(`${signal} received — shutting down`);
    deps.confirmationService.shutdown();
    server.close(() => {
      deps.pool.end();
      console.log('clean shutdown');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

main().catch(err => { console.error('Failed to start:', err); process.exit(1); });
