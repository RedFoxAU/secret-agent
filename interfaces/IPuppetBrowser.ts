import { IBoundLog } from './ILog';
import IPuppetContext from './IPuppetContext';
import IProxyConnectionOptions from './IProxyConnectionOptions';
import ICorePlugins from './ICorePlugins';
import IDevtoolsSession from './IDevtoolsSession';

export default interface IPuppetBrowser {
  id: string;
  name: string;
  fullVersion: string;
  majorVersion: number;
  onDevtoolsPanelAttached?: (devtoolsSession: IDevtoolsSession) => Promise<any>;
  newContext(
    plugins: ICorePlugins,
    logger: IBoundLog,
    proxy?: IProxyConnectionOptions,
  ): Promise<IPuppetContext>;
  close(): Promise<void>;
}
