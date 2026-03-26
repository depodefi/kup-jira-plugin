import Resolver from '@forge/resolver';

const resolver = new Resolver();

resolver.define('getText', (req) => {
  console.log(req);

  return 'Hello world!';
});

export const handler = resolver.getDefinitions();

const adminResolver = new Resolver();

adminResolver.define('getAdminText', (req) => {
  return 'Hello from Admin settings!';
});

export const adminHandler = adminResolver.getDefinitions();
