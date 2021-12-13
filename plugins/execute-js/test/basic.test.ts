import { Agent, LocationStatus } from 'secret-agent';
import { Helpers } from '@secret-agent/testing';
import { ITestKoaServer } from '@secret-agent/testing/helpers';
import ExecuteJsPlugin from '@secret-agent/execute-js-plugin';
import Core from '@secret-agent/core';
import ConnectionToClient from '@secret-agent/core/server/ConnectionToClient';
import CoreServer from '@secret-agent/core/server';
import ExecuteJsCorePlugin from '../lib/CorePlugin';

let koaServer: ITestKoaServer;
let connectionToClient: ConnectionToClient;
let coreServer;
beforeAll(async () => {
  coreServer = new CoreServer();
  await coreServer.listen({ port: 0 });
  Core.use(ExecuteJsCorePlugin);
  Core.allowDynamicPluginLoading = false;
  koaServer = await Helpers.runKoaServer();
  connectionToClient = Core.addConnection();
  Helpers.onClose(() => {
    connectionToClient.disconnect();
    koaServer.close();
    coreServer.close();
  }, true);
});

afterAll(Helpers.afterAll);
afterEach(Helpers.afterEach);

test('it should run function in browser and return response', async () => {
  koaServer.get('/test1', ctx => {
    ctx.body = `<body>
<script>
    window.testRun = function() {
      return 'ItWorks';
    }
</script>
</body>`;
  });

  const userAgent =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_16_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.165 Safari/537.36';
  const agent = new Agent({
    userAgent,
    connectionToCore: {
      host: await coreServer.address,
    },
  });
  Helpers.onClose(() => agent.close(), true);
  agent.use(ExecuteJsPlugin);

  await agent.goto(`${koaServer.baseUrl}/test1`);
  await agent.activeTab.waitForLoad(LocationStatus.DomContentLoaded);
  const response = await agent.executeJs(() => {
    // @ts-ignore
    return window.testRun();
  });
  expect(response).toEqual('ItWorks');
  await agent.close();
});

test('it should run function in browser and return incr', async () => {
  koaServer.get('/test2', ctx => {
    ctx.body = `<body>
<script>
    window.testRun = function(num) {
      return num + 1;
    }
</script>
</body>`;
  });

  const userAgent =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_16_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.165 Safari/537.36';
  const agent = new Agent({
    userAgent,
    connectionToCore: {
      host: await coreServer.address,
    },
  });
  Helpers.onClose(() => agent.close(), true);
  agent.use(ExecuteJsPlugin);

  await agent.goto(`${koaServer.baseUrl}/test2`);
  await agent.activeTab.waitForLoad(LocationStatus.DomContentLoaded);
  const response = await agent.executeJs(num => {
    // @ts-ignore
    return window.testRun(num);
  }, 1);
  expect(response).toEqual(2);
  await agent.close();
});

test('it should run function in iframe', async () => {
  koaServer.get('/iframe-host', ctx => {
    ctx.body = `<body>
<h1>Iframe page</h1>
<iframe src="/iframe" id="iframe"></iframe>
<script>
    window.testFunc = function() {
      return "page";
    }
</script>
</body>`;
  });
  koaServer.get('/iframe', ctx => {
    ctx.body = `<body>
<script>
    window.testFunc = function() {
      return "iframe";
    }
</script>
</body>`;
  });

  const agent = new Agent({
    connectionToCore: {
      host: await coreServer.address,
    },
  });
  Helpers.onClose(() => agent.close());
  agent.use(ExecuteJsPlugin);

  await agent.goto(`${koaServer.baseUrl}/iframe-host`);
  await agent.waitForPaintingStable();

  const iframe = await agent.getFrameEnvironment(agent.document.querySelector('iframe'));
  await iframe.waitForLoad(LocationStatus.DomContentLoaded);

  await expect(
    iframe.executeJs(() => {
      // @ts-ignore
      return window.testFunc();
    }),
  ).resolves.toBe('iframe');
  await expect(
    agent.activeTab.executeJs(() => {
      // @ts-ignore
      return window.testFunc();
    }),
  ).resolves.toBe('page');
  await expect(
    agent.executeJs(() => {
      // @ts-ignore
      return window.testFunc();
    }),
  ).resolves.toBe('page');
  await agent.close();
});
