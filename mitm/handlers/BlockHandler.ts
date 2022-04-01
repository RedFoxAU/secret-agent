import IMitmRequestContext from '../interfaces/IMitmRequestContext';
import ResourceState from '../interfaces/ResourceState';

export default class BlockHandler {
  public static shouldBlockRequest(ctx: IMitmRequestContext): boolean {
    ctx.setState(ResourceState.BlockHandler);
    const requestSession = ctx.requestSession;
    if (!requestSession) return false;
    if (requestSession.isClosing) return false;

    const shouldBlock =
      (ctx.resourceType && requestSession.blockedResources?.types?.includes(ctx.resourceType)) ||
      requestSession.shouldBlockRequest(ctx.url.href);

    if (!shouldBlock) return false;
    ctx.didBlockResource = shouldBlock;

    let contentType = 'text/html';
    if (ctx.resourceType === 'Image') {
      contentType = `image/${ctx.url.pathname.split('.').pop()}`;
    }

    if (ctx.proxyToClientResponse) {
      if (requestSession.blockHandler(ctx)) {
        return true;
      }

      ctx.proxyToClientResponse.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      });
      ctx.proxyToClientResponse.end('');
    }
    // don't proceed
    return true;
  }
}
