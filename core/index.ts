import ICoreConfigureOptions from '@secret-agent/interfaces/ICoreConfigureOptions';
import { LocationTrigger } from '@secret-agent/interfaces/Location';
import Log, { hasBeenLoggedSymbol } from '@secret-agent/commons/Logger';
import Resolvable from '@secret-agent/commons/Resolvable';
import {
  IBrowserEmulatorClass,
  ICorePluginClass,
  IHumanEmulatorClass,
} from '@secret-agent/interfaces/ICorePlugin';
import { PluginTypes } from '@secret-agent/interfaces/IPluginTypes';
import DefaultBrowserEmulator from '@secret-agent/default-browser-emulator';
import DefaultHumanEmulator from '@secret-agent/default-human-emulator';
import extractPlugins from '@secret-agent/plugin-utils/lib/utils/extractPlugins';
import requirePlugins from '@secret-agent/plugin-utils/lib/utils/requirePlugins';
import { IPluginClass } from '@secret-agent/interfaces/IPlugin';
import ShutdownHandler from '@secret-agent/commons/ShutdownHandler';
import ConnectionToClient from './server/ConnectionToClient';
import CoreServer from './server';
import CoreProcess from './lib/CoreProcess';
import Session from './lib/Session';
import Tab from './lib/Tab';
import GlobalPool from './lib/GlobalPool';

const { log } = Log(module);

export { GlobalPool, Tab, Session, LocationTrigger, CoreProcess };

export default class Core {
  public static server = new CoreServer();
  public static readonly connections: ConnectionToClient[] = [];
  public static pluginMap: {
    humanEmulatorsById: { [id: string]: IHumanEmulatorClass };
    browserEmulatorsById: { [id: string]: IBrowserEmulatorClass };
    corePluginsById: { [id: string]: ICorePluginClass };
  } = {
    humanEmulatorsById: {
      [DefaultHumanEmulator.id]: DefaultHumanEmulator,
    },
    browserEmulatorsById: {
      [DefaultBrowserEmulator.id]: DefaultBrowserEmulator,
    },
    corePluginsById: {},
  };

  public static onShutdown: () => void;

  public static isClosing: Promise<void>;
  public static allowDynamicPluginLoading = true;
  private static wasManuallyStarted = false;
  private static isStarting = false;

  public static addConnection(): ConnectionToClient {
    const connection = new ConnectionToClient();
    connection.on('close', () => {
      const idx = this.connections.indexOf(connection);
      if (idx >= 0) this.connections.splice(idx, 1);
      this.checkForAutoShutdown();
    });
    this.connections.push(connection);
    return connection;
  }

  public static use(PluginObject: string | ICorePluginClass | { [name: string]: IPluginClass }) {
    let Plugins: IPluginClass[];
    if (typeof PluginObject === 'string') {
      Plugins = requirePlugins(PluginObject as string);
    } else {
      Plugins = extractPlugins(PluginObject as any);
    }

    for (const Plugin of Plugins) {
      if (Plugin.type === PluginTypes.HumanEmulator) {
        this.pluginMap.humanEmulatorsById[Plugin.id] = Plugin as IHumanEmulatorClass;
      } else if (Plugin.type === PluginTypes.BrowserEmulator) {
        this.pluginMap.browserEmulatorsById[Plugin.id] = Plugin as IBrowserEmulatorClass;
      } else if (Plugin.type === PluginTypes.CorePlugin) {
        this.pluginMap.corePluginsById[Plugin.id] = Plugin;
      }
    }
  }

  public static async start(
    options: ICoreConfigureOptions = {},
    isExplicitlyStarted = true,
  ): Promise<void> {
    if (this.isStarting) return;
    const startLogId = log.info('Core.start', {
      options,
      isExplicitlyStarted,
      sessionId: null,
    });
    this.isClosing = null;
    this.isStarting = true;
    if (isExplicitlyStarted) this.wasManuallyStarted = true;

    this.registerSignals();
    const { localProxyPortStart, sessionsDir, maxConcurrentAgentsCount } = options;

    if (maxConcurrentAgentsCount !== undefined)
      GlobalPool.maxConcurrentAgentsCount = maxConcurrentAgentsCount;

    if (localProxyPortStart !== undefined)
      GlobalPool.localProxyPortStart = options.localProxyPortStart;

    if (sessionsDir !== undefined) {
      GlobalPool.sessionsDir = options.sessionsDir;
    }

    await GlobalPool.start();

    await this.server.listen({ port: options.coreServerPort });

    const host = await this.server.address;

    log.info('Core started', {
      coreHost: await Core.server.address,
      sessionId: null,
      parentLogId: startLogId,
      sessionsDir: GlobalPool.sessionsDir,
    });
    // if started as a subprocess, send back the host
    if (process.send && process.connected) {
      ShutdownHandler.exitOnSignal = true;
      process.send(host);
    }
  }

  public static async shutdown(force = false): Promise<void> {
    if (this.isClosing) return this.isClosing;

    const isClosing = new Resolvable<void>();
    this.isClosing = isClosing.promise;

    this.isStarting = false;
    const logid = log.info('Core.shutdown');
    const shutDownErrors: Error[] = [];
    try {
      await Promise.all(this.connections.map(x => x.disconnect())).catch(error =>
        shutDownErrors.push(error),
      );
      await GlobalPool.close().catch(error => shutDownErrors.push(error));
      await this.server.close(!force).catch(error => shutDownErrors.push(error));

      this.wasManuallyStarted = false;
      if (this.onShutdown) this.onShutdown();
      isClosing.resolve();
    } catch (error) {
      isClosing.reject(error);
    } finally {
      log.info('Core.shutdownComplete', {
        parentLogId: logid,
        sessionId: null,
        errors: shutDownErrors.length ? shutDownErrors : undefined,
      });
    }
    return isClosing.promise;
  }

  public static logUnhandledError(clientError: Error, fatalError = false): void {
    if (!clientError || clientError[hasBeenLoggedSymbol]) return;
    if (fatalError) {
      log.error('UnhandledError(fatal)', { clientError, sessionId: null });
    } else if (!clientError[hasBeenLoggedSymbol]) {
      log.error('UnhandledErrorOrRejection', { clientError, sessionId: null });
    }
  }

  private static checkForAutoShutdown(): void {
    if (Core.wasManuallyStarted || this.connections.some(x => x.isActive())) return;

    Core.shutdown().catch(error => {
      log.error('Core.autoShutdown', {
        error,
        sessionId: null,
      });
    });
  }

  private static registerSignals() {
    ShutdownHandler.register(() => Core.shutdown());

    if (process.env.NODE_ENV !== 'test') {
      process.on('uncaughtExceptionMonitor', async (error: Error) => {
        await Core.logUnhandledError(error, true);
        await Core.shutdown();
      });
      process.on('unhandledRejection', async (error: Error) => {
        await Core.logUnhandledError(error, false);
      });
    }
  }
}
