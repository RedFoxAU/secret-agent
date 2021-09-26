import { Helpers } from '@secret-agent/testing';
import { XPathResult } from '@secret-agent/interfaces/AwaitedDom';
import { ITestKoaServer } from '@secret-agent/testing/helpers';
import { FrameEnvironment, LocationStatus } from '@secret-agent/client';
import Dialog from '@secret-agent/client/lib/Dialog';
import { Handler } from '../index';

let koaServer: ITestKoaServer;
let handler: Handler;
beforeAll(async () => {
  handler = new Handler();
  Helpers.onClose(() => handler.close(), true);
  koaServer = await Helpers.runKoaServer();
});
afterAll(Helpers.afterAll);
afterEach(Helpers.afterEach);

describe('basic Document tests', () => {
  it('runs goto', async () => {
    const agent = await openBrowser('/');
    const url = await agent.document.location.host;
    const html = await agent.document.body.outerHTML;
    const linkText = await agent.document.querySelector('a').textContent;
    expect(html).toMatch('Example Domain');
    expect(linkText).toBe('More information...');
    expect(url).toBe(koaServer.baseHost);
  });

  it('can iterate over multiple querySelectorElements', async () => {
    koaServer.get('/page', ctx => {
      ctx.body = `
        <body>
          <a href="#page1">Click Me</a>
          <a href="#page2">Click Me</a>
          <a href="#page3">Click Me</a>
        </body>
      `;
    });
    const agent = await openBrowser(`/page`);
    const links = await agent.document.querySelectorAll('a');

    for (const link of links) {
      await agent.interact({ click: link, waitForElementVisible: link });
      await agent.waitForLocation('change');
    }
    const finalUrl = await agent.url;
    expect(finalUrl).toBe(`${koaServer.baseUrl}/page#page3`);
  });

  it('can refresh an element list', async () => {
    koaServer.get('/refresh', ctx => {
      ctx.body = `
        <body>
          <a href="javascript:void(0);" onclick="clicker()">Click Me</a>

          <script>
          function clicker() {
            const elem = document.createElement('A');
            document.querySelector('a').after(elem)
          }
          </script>
        </body>
      `;
    });
    const agent = await openBrowser(`/refresh`);
    const links = agent.document.querySelectorAll('a');
    const links1 = await links;
    expect([...links1]).toHaveLength(1);
    expect([...(await links1.values())]).toHaveLength(1);
    await agent.click([...(await links1.values())][0]);

    expect([...(await links)]).toHaveLength(2);
    expect([...(await links1)]).toHaveLength(1);
    expect([...(await links1.values())]).toHaveLength(1);
  });

  it('must call await on a NodeList to re-iterate', async () => {
    koaServer.get('/reiterate', ctx => {
      ctx.body = `
        <body>
          <ul>
            <li>1</li>
            <li>2</li>
            <li>3</li>
          </ul>
          <a href="javascript:void(0)" onclick="clicker()">link</a>
          <script>
            function clicker() {
              document.querySelector('ul').append('<li>4</li>');
            }
          </script>
        </body>
      `;
    });
    const agent = await openBrowser(`/reiterate`);
    const ul = await agent.document.querySelector('ul');
    const lis = await ul.getElementsByTagName('li');
    expect(Array.from(lis)).toHaveLength(3);

    const link = await agent.document.querySelector('a');
    await agent.click(link);
    try {
      // should throw
      for (const child of lis) {
        expect(child).not.toBeTruthy();
      }
    } catch (error) {
      // eslint-disable-next-line jest/no-try-expect
      expect(String(error)).toMatch(/Please add an await/);
    }
  });

  it('can re-await an element to refresh the underlying nodePointer ids', async () => {
    koaServer.get('/refresh-element', ctx => {
      ctx.body = `
        <body>
          <a id="first" href="javascript:void(0);" onclick="clicker()">Click Me</a>

          <script>
          function clicker() {
            const elem = document.createElement('A');
            elem.setAttribute('id', 'number2');
            document.body.prepend(elem)
          }
          </script>
        </body>
      `;
    });
    const agent = await openBrowser('/refresh-element');
    await agent.waitForPaintingStable();
    const lastChild = await agent.document.body.firstElementChild;
    expect(await lastChild.getAttribute('id')).toBe('first');
    await agent.click(lastChild);

    const refreshedChild = await lastChild;
    expect(await refreshedChild.getAttribute('id')).toBe('first');

    const updatedChild = await agent.document.body.firstElementChild;
    expect(await updatedChild.getAttribute('id')).toBe('number2');
  });

  it('should be able to access a NodeList by index', async () => {
    koaServer.get('/index', ctx => {
      ctx.body = `
        <body>
          <ul>
            <li>1</li>
            <li>2</li>
            <li>3</li>
          </ul>
        </body>
      `;
    });
    const agent = await openBrowser(`/index`);

    const element2Text = await agent.document.querySelectorAll('li')[1].textContent;
    expect(element2Text).toBe('2');
  });

  it('can execute xpath', async () => {
    koaServer.get('/xpath', ctx => {
      ctx.body = `
        <body>
          <h2>Here I am</h2>
          <ul>
            <li>1</li>
            <li>2</li>
            <li>3</li>
          </ul>
          <h2>Also me</h2>
        </body>
      `;
    });
    const agent = await openBrowser(`/xpath`);

    const headings = await agent.document.evaluate(
      '/html/body//h2',
      agent.document,
      null,
      XPathResult.ANY_TYPE,
      null,
    );
    const nextHeading = headings.iterateNext();
    expect(await nextHeading.textContent).toBe('Here I am');
    const heading2 = headings.iterateNext();
    expect(await heading2.textContent).toBe('Also me');
  });

  it('can wait for xpath elements', async () => {
    koaServer.get('/xpath-wait', ctx => {
      ctx.body = `
        <body>
          <h2 style="display: none">Here I am not</h2>
          <h2>Also me</h2>
          <script>
          setTimeout(() => {
              const h2 = document.querySelector('h2');
              h2.style.display = '';
              h2.textContent = 'Here I am'
          }, 500)
</script>
        </body>
      `;
    });
    const agent = await openBrowser(`/xpath-wait`);

    const headings = agent.document.evaluate(
      '/html/body//h2',
      agent.document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    );
    await agent.waitForElement(headings.singleNodeValue, { waitForVisible: true });
    await expect(headings.singleNodeValue.textContent).resolves.toBe('Here I am');
  });

  it("returns null for elements that don't exist", async () => {
    const agent = await openBrowser(`/`);
    const { document } = agent;
    const element = await document.querySelector('#this-element-aint-there');
    expect(element).toBe(null);
  });

  it("returns null for xpath elements that don't exist", async () => {
    const agent = await openBrowser(`/`);
    const { document } = agent;
    const element = await document.evaluate(
      '//div[@id="this-element-aint-there"]',
      agent.document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
    expect(element).toBe(null);
  });

  it('returns null while iterating nodes', async () => {
    koaServer.get('/xpath-nodes', ctx => {
      ctx.body = `
        <body>
          <div id="div1">Div 1</div>
          <div id="div2">Div 2</div>
          <div id="div3">Div 3</div>
        </body>
      `;
    });
    const agent = await openBrowser(`/xpath-nodes`);
    const { document } = agent;
    const iterator = await document.evaluate(
      '//div',
      agent.document,
      null,
      XPathResult.ORDERED_NODE_ITERATOR_TYPE,
      null,
    );
    await expect(iterator.iterateNext()).resolves.toBeTruthy();
    await expect(iterator.iterateNext()).resolves.toBeTruthy();
    await expect(iterator.iterateNext()).resolves.toBeTruthy();
    await expect(iterator.iterateNext()).resolves.toBe(null);
  });

  it('can determine if an element is visible', async () => {
    koaServer.get('/isVisible', ctx => {
      ctx.body = `
        <body>
          <div id="elem-1">Element 1</div>
          <div style="visibility: hidden">
            <div id="elem-2">Visibility none</div>
          </div>
          <div style="visibility: visible">
            <div id="elem-3">Visibility visible</div>
          </div>
          <div style="display:none" id="elem-4">No display</div>
          <div style="opacity: 0" id="elem-5">Opacity 0</div>
          <div style="opacity: 0.1" id="elem-6">Opacity 0.1</div>
          <div style="position: relative; width: 100px">
            <div id="elem-7" style="position: absolute; left: 0; width: 20px; top; 0; height:20px;">Showing Element</div>
            <div id="elem-8" style="position: absolute; left: 20px; width: 20px; top; 0; height:20px;">Showing Element</div>
            <div style="position: absolute; left: 21px; width: 10px; top; 0; height:20px;">Overlay Element</div>
          </div>
        </body>
      `;
    });
    const agent = await openBrowser(`/isVisible`);
    const { document } = agent;
    await expect(
      agent.getComputedVisibility(document.querySelector('#elem-1')),
    ).resolves.toMatchObject({
      isVisible: true,
    });
    // visibility
    await expect(
      agent.getComputedVisibility(document.querySelector('#elem-2')),
    ).resolves.toMatchObject({
      isVisible: false,
      hasCssVisibility: false,
    });
    await expect(
      agent.getComputedVisibility(document.querySelector('#elem-3')),
    ).resolves.toMatchObject({
      isVisible: true,
    });
    // layout
    await expect(
      agent.getComputedVisibility(document.querySelector('#elem-4')),
    ).resolves.toMatchObject({
      isVisible: false,
      hasDimensions: false,
    });
    // opacity
    await expect(
      agent.getComputedVisibility(document.querySelector('#elem-5')),
    ).resolves.toMatchObject({
      isVisible: false,
      hasCssOpacity: false,
    });
    await expect(
      agent.getComputedVisibility(document.querySelector('#elem-6')),
    ).resolves.toMatchObject({
      isVisible: true,
    });
    // overlay
    await expect(
      agent.getComputedVisibility(document.querySelector('#elem-7')),
    ).resolves.toMatchObject({
      isVisible: true,
      isUnobstructedByOtherElements: true,
    });
    await expect(
      agent.getComputedVisibility(document.querySelector('#elem-8')),
    ).resolves.toMatchObject({
      isVisible: false,
      isUnobstructedByOtherElements: false,
    });
  });

  it('can get computed styles', async () => {
    koaServer.get('/computedStyle', ctx => {
      ctx.body = `<body>
          <div style="opacity: 0" id="elem-1">Opacity 0</div>
          <div style="opacity: 0.1" id="elem-2">Opacity 0.1</div>
        </body>`;
    });
    const agent = await openBrowser(`/computedStyle`);
    const { document } = agent;
    const elem1Style = agent.activeTab.getComputedStyle(document.querySelector('#elem-1'));
    const opacity = await elem1Style.getPropertyValue('opacity');
    expect(opacity).toBe('0');

    const elem2Style = agent.activeTab.getComputedStyle(document.querySelector('#elem-2'));
    const opacity2 = await elem2Style.getPropertyValue('opacity');
    expect(opacity2).toBe('0.1');
  });

  it('can get a data url of a canvas', async () => {
    koaServer.get('/canvas', ctx => {
      ctx.body = `
        <body>
          <label>This is a canvas</label>
          <canvas id="canvas"></canvas>
          <script>
            const c = document.getElementById("canvas");
            const ctx = c.getContext("2d");
            ctx.moveTo(0, 0);
            ctx.lineTo(200, 100);
            ctx.stroke();
          </script>
        </body>
      `;
    });
    const agent = await openBrowser(`/canvas`);
    const { document } = agent;
    const dataUrl = await document.querySelector('canvas').toDataURL();
    expect(dataUrl).toMatch(/data:image\/png.+/);
  });

  it('can dismiss dialogs', async () => {
    koaServer.get('/dialog', ctx => {
      ctx.body = `
        <body>
          <h1>Dialog page</h1>
          <script type="text/javascript">
           setTimeout(() => confirm('Do you want to do this'), 500);
          </script>
        </body>
      `;
    });
    const agent = await openBrowser(`/dialog`);
    const { document } = agent;
    const dialogPromise = new Promise<Dialog>(resolve => agent.activeTab.on('dialog', resolve));
    await expect(dialogPromise).resolves.toBeTruthy();
    const dialog = await dialogPromise;
    await (await dialog).dismiss(true);
    // test that we don't hang here
    await expect(document.querySelector('h1').textContent).resolves.toBeTruthy();
  });

  it('can get a dataset attribute', async () => {
    koaServer.get('/dataset', ctx => {
      ctx.body = `
        <body>
          <div id="main" data-id="1" data-name="name">This is a div</div>
        </body>
      `;
    });
    const agent = await openBrowser(`/dataset`);
    const { document } = agent;
    const dataset = await document.querySelector('#main').dataset;
    expect(dataset).toEqual({ id: '1', name: 'name' });
  });

  it('allows you to run shadow dom query selectors', async () => {
    koaServer.get('/shadow', ctx => {
      ctx.body = `
        <body>
          <header id="header"></header>
          <script>
            const header = document.getElementById('header');
            const shadowRoot = header.attachShadow({ mode: 'closed' });
            shadowRoot.innerHTML = \`<div>
             <h1>Hello Shadow DOM</h1>
             <ul>
              <li>1</li>
              <li>2</li>
              <li>3</li>
             </ul>
            </div>\`;
          </script>
        </body>
      `;
    });
    const agent = await openBrowser(`/shadow`);
    const { document } = agent;
    const shadowRoot = document.querySelector('#header').shadowRoot;
    const h1Text = await shadowRoot.querySelector('h1').textContent;
    expect(h1Text).toBe('Hello Shadow DOM');

    const lis = await shadowRoot.querySelectorAll('li').length;
    expect(lis).toBe(3);
  });

  it('allows selectors in iframes', async () => {
    koaServer.get('/iframePage', ctx => {
      ctx.body = `
        <body>
        <h1>Iframe Page</h1>
<iframe src="/subFrame"></iframe>
        </body>
      `;
    });
    koaServer.get('/subFrame', ctx => {
      ctx.body = `
        <body>
        <h1>Subframe Page</h1>
<div>This is content inside the frame</div>
        </body>
      `;
    });

    const agent = await openBrowser(`/iframePage`);

    const outerH1 = await agent.document.querySelector('h1').textContent;
    expect(outerH1).toBe('Iframe Page');

    let innerFrame: FrameEnvironment;
    for (const frame of await agent.activeTab.frameEnvironments) {
      await frame.waitForLoad(LocationStatus.DomContentLoaded);
      const url = await frame.url;
      if (url.endsWith('/subFrame')) {
        innerFrame = frame;
        break;
      }
    }

    const innerH1 = await innerFrame.document.querySelector('h1').textContent;
    expect(innerH1).toBe('Subframe Page');

    await agent.close();
  });

  it('can find the Frame object for an iframe', async () => {
    koaServer.get('/iframePage2', ctx => {
      ctx.body = `
        <body>
        <h1>Iframe Page</h1>
<iframe src="/subFrame1" name="frame1"></iframe>
<iframe src="/subFrame2" id="frame2"></iframe>
        </body>
      `;
    });
    koaServer.get('/subFrame1', ctx => {
      ctx.body = `<body><h1>Subframe Page 1</h1></body>`;
    });
    koaServer.get('/subFrame2', ctx => {
      ctx.body = `<body><h1>Subframe Page 2</h1>
<iframe src="/subFrame1" id="nested"></iframe>
</body>`;
    });

    const agent = await openBrowser(`/iframePage2`);

    const frameElement2 = agent.document.querySelector('#frame2');
    await agent.waitForElement(frameElement2);
    const frame2Env = await agent.activeTab.getFrameEnvironment(frameElement2);

    expect(frame2Env).toBeTruthy();
    await frame2Env.waitForLoad(LocationStatus.AllContentLoaded);
    await expect(frame2Env.document.querySelector('h1').textContent).resolves.toBe(
      'Subframe Page 2',
    );

    const nestedFrameElement = frame2Env.document.querySelector('iframe');
    const nestedFrameEnv = await frame2Env.getFrameEnvironment(nestedFrameElement);
    expect(nestedFrameEnv).toBeTruthy();

    await nestedFrameEnv.waitForLoad(LocationStatus.AllContentLoaded);
    await expect(nestedFrameEnv.document.body.innerHTML).resolves.toBe('<h1>Subframe Page 1</h1>');

    await agent.close();
  }, 130e3);
});

async function openBrowser(path: string) {
  const agent = await handler.createAgent();
  Helpers.needsClosing.push(agent);
  await agent.goto(`${koaServer.baseUrl}${path}`);
  await agent.waitForPaintingStable();
  return agent;
}
