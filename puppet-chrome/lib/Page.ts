import Protocol from 'devtools-protocol';
import { assert } from '@secret-agent/commons/utils';
import { IPuppetPage, IPuppetPageEvents } from '@secret-agent/puppet/interfaces/IPuppetPage';
import { TypedEventEmitter } from '@secret-agent/commons/eventUtils';
import { ICookie } from '@secret-agent/core-interfaces/ICookie';
import { URL } from 'url';
import { CDPSession } from './CDPSession';
import { NetworkManager } from './NetworkManager';
import { Keyboard } from './Keyboard';
import Mouse from './Mouse';
import Touchscreen from './Touchscreen';
import FramesManager from './FramesManager';
import {
  debugError,
  exceptionDetailsToError,
  printStackTrace,
  valueFromRemoteObject,
} from './Utils';
import { BrowserContext } from './BrowserContext';
import { Worker } from './Worker';
import ConsoleAPICalledEvent = Protocol.Runtime.ConsoleAPICalledEvent;
import ExceptionThrownEvent = Protocol.Runtime.ExceptionThrownEvent;
import CookieParam = Protocol.Network.CookieParam;

export class Page extends TypedEventEmitter<IPuppetPageEvents> implements IPuppetPage {
  public keyboard: Keyboard;
  public mouse: Mouse;
  public touchscreen: Touchscreen;
  public workersById = new Map<string, Worker>();
  public readonly browserContext: BrowserContext;
  public readonly opener: Page | null;
  public networkManager: NetworkManager;
  public framesManager: FramesManager;

  public initializeNewPage?: (page: IPuppetPage) => Promise<void>;

  public cdpSession: CDPSession;
  public targetId: string;
  public isClosed = false;
  public readonly isReady: Promise<void>;

  public get mainFrame() {
    return this.framesManager.main;
  }

  public get frames() {
    return this.framesManager.activeFrames;
  }

  constructor(
    cdpSession: CDPSession,
    targetId: string,
    browserContext: BrowserContext,
    opener: Page | null,
  ) {
    super();
    this.cdpSession = cdpSession;
    this.targetId = targetId;
    this.browserContext = browserContext;
    this.keyboard = new Keyboard(cdpSession);
    this.mouse = new Mouse(cdpSession, this.keyboard);
    this.touchscreen = new Touchscreen(cdpSession, this.keyboard);
    this.networkManager = new NetworkManager(cdpSession, targetId);
    this.framesManager = new FramesManager(cdpSession);
    this.opener = opener;

    this.cdpSession.on('Runtime.exceptionThrown', this.onRuntimeException.bind(this));
    this.cdpSession.on('Inspector.targetCrashed', this.onTargetCrashed.bind(this));
    this.cdpSession.on('Runtime.consoleAPICalled', this.onRuntimeConsole.bind(this));
    this.cdpSession.on('Target.attachedToTarget', this.onAttachedToTarget.bind(this));

    this.framesManager.on('frameLifecycle', ({ frame, name }) => {
      if (name === 'load' && frame.id === this.mainFrame?.id) {
        this.emit('load');
      }
    });

    for (const event of ['frameCreated', 'frameNavigated', 'frameLifecycle'] as const) {
      this.framesManager.on(event, this.emit.bind(this, event));
    }
    for (const event of [
      'navigationResponse',
      'websocketFrame',
      'websocketHandshake',
      'resourceWillBeRequested',
    ] as const) {
      this.networkManager.on(event, this.emit.bind(this, event));
    }

    this.cdpSession.once('disconnected', this.emit.bind(this, 'close'));

    this.isReady = this.initialize();
  }

  async runInFrames<T>(script: string, isolatedEnvironment: boolean) {
    return this.framesManager.runInActiveFrames(script, isolatedEnvironment);
  }

  addNewDocumentScript(script: string, isolatedEnvironment: boolean) {
    return this.framesManager.addNewDocumentScript(script, isolatedEnvironment);
  }

  async addPageCallback(name: string, onCallback: (payload: any, frameId: string) => any) {
    return this.framesManager.addPageCallback(name, onCallback);
  }

  ///////   COOKIES ////////////////////////////////////////////////////////////////////////////////////////////////////

  public async getPageCookies(): Promise<ICookie[]> {
    const { cookies } = await this.cdpSession.send('Network.getCookies', {
      urls: [this.mainFrame.url],
    });
    return cookies.map(
      x =>
        ({
          ...x,
          expires: String(x.expires),
        } as ICookie),
    );
  }

  public async getAllCookies() {
    const cookieResponse = await this.cdpSession.send('Network.getAllCookies');
    return cookieResponse.cookies.map(
      x =>
        ({
          ...x,
          expires: String(x.expires),
        } as ICookie),
    );
  }

  public async setCookies(cookies: ICookie[], origins: string[]) {
    const originUrls = (origins ?? []).map(x => new URL(x));
    const parsedCookies: CookieParam[] = [];
    for (const cookie of cookies) {
      const cookieToSend: CookieParam = {
        ...cookie,
        expires: cookie.expires ? parseInt(cookie.expires, 10) : null,
      };
      cookieToSend.url = `http${cookie.secure ? 's' : ''}://${cookie.domain}${cookie.path}`;
      const match = originUrls.find(x => {
        return x.hostname.endsWith(cookie.domain);
      });
      if (match) cookieToSend.url = match.href;

      parsedCookies.push(cookieToSend);
    }
    return await this.cdpSession.send('Network.setCookies', {
      cookies: parsedCookies,
    });
  }

  public async getIndexedDbDatabaseNames() {
    const dbs: { frameId: string; origin: string; databases: string[] }[] = [];
    for (const { origin, frameId } of this.framesManager.getSecurityOrigins()) {
      const { databaseNames } = await this.cdpSession.send('IndexedDB.requestDatabaseNames', {
        securityOrigin: origin,
      });
      dbs.push({ origin, frameId, databases: databaseNames });
    }
    return dbs;
  }

  // some dialogs can't be handled in-page
  public handleJavascriptDialog(accept: boolean, promptText?: string) {
    return this.cdpSession.send('Page.handleJavaScriptDialog', { accept, promptText });
  }

  async setJavaScriptEnabled(enabled: boolean): Promise<void> {
    await this.cdpSession.send('Emulation.setScriptExecutionDisabled', {
      value: !enabled,
    });
  }

  runInFrame<T>(frameId: string, script: string, isolatedEnvironment: boolean): Promise<T> {
    return this.framesManager.runInFrame(frameId, script, isolatedEnvironment);
  }

  async evaluate(expression: string) {
    return this.runInFrame(this.mainFrame.id, expression, false);
  }

  /////// NAVIGATION ///////

  async navigate(url: string, options: { referrer?: string } = {}) {
    const navigationResponse = await this.cdpSession.send('Page.navigate', {
      url,
      referrer: options.referrer,
      frameId: this.mainFrame.id,
    });
    if (navigationResponse.errorText) throw new Error(navigationResponse.errorText);

    return this.framesManager.waitForFrame(navigationResponse, true);
  }

  async goBack(): Promise<void> {
    return this.navigateToHistory(-1);
  }

  async goForward(): Promise<void> {
    return this.navigateToHistory(+1);
  }

  async bringToFront(): Promise<void> {
    await this.cdpSession.send('Page.bringToFront');
  }

  async close(): Promise<void> {
    await this.framesManager.close();
    assert(
      this.cdpSession.isConnected(),
      'Protocol error: Connection closed. Most likely the page has been closed.',
    );
    await this.cdpSession.send('Page.close');
  }

  didClose() {
    this.cdpSession.removeAllListeners();
  }

  private async navigateToHistory(delta: number): Promise<void> {
    const history = await this.cdpSession.send('Page.getNavigationHistory');
    const entry = history.entries[history.currentIndex + delta];
    if (!entry) return null;
    await this.cdpSession.send('Page.navigateToHistoryEntry', { entryId: entry.id });
  }

  private async initialize(): Promise<void> {
    await Promise.all([
      this.networkManager.initialize(this.browserContext.emulation),
      this.framesManager.initialize(),
      this.cdpSession.send('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
      }),
    ]);

    if (this.opener) {
      await this.opener.isReady;
      if (this.opener.initializeNewPage) {
        await this.opener.initializeNewPage(this);
      }
    }

    await this.cdpSession.send('Runtime.runIfWaitingForDebugger');
    // after initialized, send self to emitters
    this.browserContext.emit('page', this);
  }

  private onAttachedToTarget(event: Protocol.Target.AttachedToTargetEvent) {
    const { sessionId, targetInfo, waitingForDebugger } = event;

    const cdpSession = this.cdpSession.connection.getSession(sessionId);

    if (targetInfo.type === 'service_worker') {
      const worker = new Worker(this.browserContext, cdpSession, targetInfo);
      cdpSession.on('Runtime.exceptionThrown', this.onRuntimeException.bind(this));
      worker.on('consoleLog', this.emit.bind(this, 'consoleLog'));
      this.workersById.set(targetInfo.targetId, worker);
      worker.initialize(this.networkManager).catch(debugError);
      return;
    }

    if (waitingForDebugger) {
      return cdpSession
        .send('Runtime.runIfWaitingForDebugger')
        .catch(debugError)
        .then(() =>
          // detach from page session
          this.cdpSession.send('Target.detachFromTarget', { sessionId: event.sessionId }),
        )
        .catch(debugError);
    }
  }

  private onRuntimeException(msg: ExceptionThrownEvent) {
    const error = exceptionDetailsToError(msg.exceptionDetails);
    const frameId = this.framesManager.getFrameIdForExecutionContext(
      msg.exceptionDetails.executionContextId,
    );
    this.emit('pageError', {
      frameId,
      error,
    });
  }

  private async onRuntimeConsole(event: ConsoleAPICalledEvent) {
    const { executionContextId, args, stackTrace, type, context } = event;
    const frameId = this.framesManager.getFrameIdForExecutionContext(executionContextId);

    const message = args
      .map(arg => {
        this.cdpSession.disposeObject(arg);

        return valueFromRemoteObject(arg);
      })
      .join(' ');

    const location = `//#${context ?? 'nocontext'}${printStackTrace(stackTrace)}`;

    this.emit('consoleLog', {
      frameId,
      type,
      message,
      location,
    });
  }

  private onTargetCrashed() {
    this.emit('targetCrashed', { error: new Error('Target Crashed') });
  }
}
