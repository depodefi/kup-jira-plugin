import Resolver from '@forge/resolver';

const resolver = new Resolver();

resolver.define('getText', (req) => {
  console.log(req);

  return 'Hello world!';
});

export const handler = resolver.getDefinitions();

export { adminHandler } from './admin-resolvers';
export { kupPanelHandler } from './panel-resolvers';
export { kupReportHandler } from './report-resolvers';
