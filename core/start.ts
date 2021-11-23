import '@secret-agent/commons/SourceMapSupport';
import ICoreConfigureOptions from '@secret-agent/interfaces/ICoreConfigureOptions';
import Log from '@secret-agent/commons/Logger';
import ShutdownHandler from '@secret-agent/commons/ShutdownHandler';
import Core from '.';

const { log } = Log(module);

(async () => {
  const startOptions: ICoreConfigureOptions =
    process.argv.length > 2 ? JSON.parse(process.argv[2]) : {};

  Core.onShutdown = () => {
    log.stats('Exiting Core Process');
    ShutdownHandler.shutdown(true);
  };
  await Core.start(startOptions, !process.env.SA_TEMPORARY_CORE);
})().catch(error => {
  log.error('ERROR starting core', {
    error,
    sessionId: null,
  });
  process.exit(1);
});
