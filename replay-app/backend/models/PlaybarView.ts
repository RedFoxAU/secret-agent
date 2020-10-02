import Window from '~backend/models/Window';
import Application from '~backend/Application';
import IRectangle from '~shared/interfaces/IRectangle';
import ReplayTabState from '~backend/api/ReplayTabState';
import ViewBackend from '~backend/models/ViewBackend';

export default class PlaybarView extends ViewBackend {
  private isReady: Promise<void>;
  private tabState: ReplayTabState;

  constructor(window: Window) {
    super(window, {
      sandbox: false,
      nodeIntegration: true,
      enableRemoteModule: true,
    });

    this.browserView.setAutoResize({
      width: true,
      height: false,
      horizontal: false,
      vertical: true,
    });

    const url = Application.instance.getPageUrl('playbar');
    this.isReady = this.browserView.webContents.loadURL(url);
    this.updateFrontendTicks = this.updateFrontendTicks.bind(this);
  }

  public load(tabState: ReplayTabState) {
    this.attach();

    // remove existing listeners
    if (this.tabState) this.tabState.off('tick:changes', this.updateFrontendTicks);

    this.tabState = tabState;
    this.tabState.on('tick:changes', this.updateFrontendTicks);

    this.browserView.webContents.send('ticks:load', this.tabState.getTickState());
  }

  public play() {
    this.browserView.webContents.send('start');
  }

  public async changeTickOffset(offset: number) {
    this.browserView.webContents.send('ticks:change-offset', offset);
  }

  public onTickHover(rect: IRectangle, tickValue: number) {
    if (!this.isAttached) return;
    const tick = this.tabState.ticks.find(x => x.playbarOffsetPercent === tickValue);
    if (!tick) return;

    rect.y += this.bounds.y;
    const commandLabel = tick.label;
    const commandResult =
      tick.eventType === 'command'
        ? this.tabState.commands.find(x => x.id === tick.commandId)
        : {
            duration: 0,
          };
    Application.instance.overlayManager.show(
      'command-overlay',
      this.window.browserWindow,
      rect,
      commandLabel,
      commandResult,
    );
  }

  private async updateFrontendTicks() {
    this.browserView.webContents.send('ticks:updated', this.tabState.getTickState());
  }
}