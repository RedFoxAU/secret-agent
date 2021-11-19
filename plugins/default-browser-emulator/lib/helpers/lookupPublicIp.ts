import * as http from 'http';
import { RequestOptions } from 'http';
import IHttpSocketAgent from '@secret-agent/interfaces/IHttpSocketAgent';
import * as https from 'https';
import * as url from 'url';
import IHttpSocketWrapper from '@secret-agent/interfaces/IHttpSocketWrapper';

export default async function lookupPublicIp(
  ipLookupServiceUrl: string = IpLookupServices.ipify,
  agent?: IHttpSocketAgent,
  proxyUrl?: string,
): Promise<string> {
  const lookupService = parse(ipLookupServiceUrl);

  const requestOptions: http.RequestOptions = {
    method: 'GET',
  };
  let socketWrapper: IHttpSocketWrapper;
  if (agent) {
    socketWrapper = await agent.createSocketConnection({
      host: lookupService.host,
      port: String(lookupService.port),
      servername: lookupService.host,
      keepAlive: false,
      isSsl: ipLookupServiceUrl.startsWith('https'),
      proxyUrl,
    });

    requestOptions.createConnection = () => socketWrapper.socket;
    requestOptions.agent = null;
  }

  try {
    return await httpGet(ipLookupServiceUrl, requestOptions);
  } finally {
    if (socketWrapper) socketWrapper.close();
  }
}

export function httpGet(requestUrl: string, requestOptions: RequestOptions): Promise<string> {
  const httpModule = requestUrl.startsWith('https') ? https : http;

  return new Promise<string>((resolve, reject) => {
    const request = httpModule.request(requestUrl, requestOptions, async res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(httpGet(res.headers.location, requestOptions));
        return;
      }

      res.on('error', reject);
      res.setEncoding('utf8');
      let result = '';
      for await (const chunk of res) {
        result += chunk;
      }
      resolve(result);
    });
    request.on('error', reject);
    request.end();
  });
}

const parsedLookupServicesByUrl = new Map<string, RequestOptions>();
function parse(requestUrl: string): RequestOptions {
  if (!parsedLookupServicesByUrl.has(requestUrl)) {
    const options = url.parse(requestUrl);
    options.port ||= requestUrl.startsWith('https') ? '443' : '80';

    parsedLookupServicesByUrl.set(requestUrl, options);
  }
  return parsedLookupServicesByUrl.get(requestUrl);
}

export const IpLookupServices = {
  ipify: 'http://api.ipify.org',
  icanhazip: 'http://icanhazip.com', // warn: using cloudflare as of 11/19/21
  aws: 'http://checkip.amazonaws.com',
  dyndns: 'http://checkip.dyndns.org',
  identMe: 'http://ident.me',
  ifconfigMe: 'http://ifconfig.me/ip',
  ipecho: 'http://ipecho.net/plain',
  ipinfo: 'http://ipinfo.io/ip',
  opendns: 'https://diagnostic.opendns.com/myip',
};
