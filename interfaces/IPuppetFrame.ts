import { NavigationReason } from './INavigation';
import ITypedEventEmitter from './ITypedEventEmitter';

export interface IPuppetFrame extends ITypedEventEmitter<IPuppetFrameEvents> {
  id: string;
  parentId?: string;
  name?: string;
  url: string;
  activeLoader: IPuppetNavigationLoader;
  navigationReason?: string;
  disposition?: string;
  securityOrigin: string;
  isDefaultUrl: boolean;
  isAttached: boolean;
  resolveNodeId(backendNodeId: number): Promise<string>;
  waitForLifecycleEvent(
    event: keyof ILifecycleEvents,
    loaderId?: string,
    timeoutMs?: number,
  ): Promise<void>;
  waitForLoader(loaderId?: string, timeoutMs?: number): Promise<Error | undefined>;
  canEvaluate(isolatedFromWebPageEnvironment: boolean): boolean;
  getFrameElementNodeId(): Promise<string>;
  evaluate<T>(
    expression: string,
    isolateFromWebPageEnvironment?: boolean,
    options?: { shouldAwaitExpression?: boolean; retriesWaitingForLoad?: number },
  ): Promise<T>;
  evaluateOnNode<T>(nodeId: string, expression: string): Promise<T>;
  setFileInputFiles(nodeId: string, filePaths: string[]): Promise<void>;
  toJSON(): object;
}

export interface IPuppetNavigationLoader {
  id: string;
  isNavigationComplete: boolean;
  lifecycle: ILifecycleEvents;
  url: string;
}

export interface ILifecycleEvents {
  DOMContentLoaded?: Date;
  load?: Date;
  init?: Date;
}

export interface IPuppetFrameManagerEvents {
  'frame-created': { frame: IPuppetFrame; loaderId: string };
}
export interface IPuppetFrameEvents {
  'frame-lifecycle': { frame: IPuppetFrame; name: string; loader: IPuppetNavigationLoader };
  'frame-navigated': { frame: IPuppetFrame; navigatedInDocument?: boolean; loaderId: string };
  'frame-requested-navigation': {
    frame: IPuppetFrame;
    url: string;
    reason: NavigationReason;
  };
  'frame-loader-created': {
    frame: IPuppetFrame;
    loaderId: string;
  };
}
