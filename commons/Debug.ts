import Debug from 'debug';

export function debug(prefix: string) {
  return Debug(`sa:${prefix}`);
}
