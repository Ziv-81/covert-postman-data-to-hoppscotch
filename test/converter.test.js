'use strict';

const {
  convertVariables,
  convertAuth,
  convertBody,
  convertHeaders,
  convertParams,
  convertRequest,
  convertFolder,
  convertCollection,
  isFolder,
} = require('../converter');

// ── Fixtures ──────────────────────────────────────────────────────────────

const MINIMAL_COLLECTION = {
  info: {
    _postman_id: 'abc123',
    name: 'Test Collection',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [],
};

const FULL_COLLECTION = {
  info: { name: 'My API', schema: '...' },
  item: [
    {
      name: 'Get Users',
      request: {
        method: 'GET',
        header: [{ key: 'Accept', value: 'application/json' }],
        url: {
          raw: 'https://api.example.com/users?page=1',
          query: [{ key: 'page', value: '1' }],
        },
      },
    },
    {
      name: 'Create User',
      request: {
        method: 'POST',
        header: [{ key: 'Content-Type', value: 'application/json' }],
        body: {
          mode: 'raw',
          raw: '{"name": "Alice"}',
          options: { raw: { language: 'json' } },
        },
        url: { raw: 'https://api.example.com/users' },
        auth: {
          type: 'bearer',
          bearer: [{ key: 'token', value: 'mytoken' }],
        },
      },
    },
    {
      name: 'Folder',
      item: [
        {
          name: 'Delete User',
          request: {
            method: 'DELETE',
            header: [],
            url: { raw: 'https://api.example.com/users/1' },
          },
        },
      ],
    },
  ],
};

// ── convertVariables ──────────────────────────────────────────────────────

describe('convertVariables', () => {
  test('converts {{var}} to <<var>>', () => {
    expect(convertVariables('{{baseUrl}}/api')).toBe('<<baseUrl>>/api');
  });

  test('converts multiple variables', () => {
    expect(convertVariables('{{a}}/{{b}}')).toBe('<<a>>/<<b>>');
  });

  test('returns empty string for non-string input', () => {
    expect(convertVariables(null)).toBe('');
    expect(convertVariables(undefined)).toBe('');
    expect(convertVariables(42)).toBe('');
  });

  test('leaves text without variables unchanged', () => {
    expect(convertVariables('https://example.com')).toBe('https://example.com');
  });
});

// ── convertAuth ───────────────────────────────────────────────────────────

describe('convertAuth', () => {
  test('null → none', () => {
    expect(convertAuth(null)).toEqual({ authType: 'none', authActive: true });
  });

  test('noauth → none', () => {
    expect(convertAuth({ type: 'noauth' })).toEqual({ authType: 'none', authActive: true });
  });

  test('inherit → inherit', () => {
    expect(convertAuth({ type: 'inherit' })).toEqual({ authType: 'inherit', authActive: true });
  });

  test('bearer auth', () => {
    const auth = convertAuth({
      type: 'bearer',
      bearer: [{ key: 'token', value: 'tok123' }],
    });
    expect(auth).toEqual({ authType: 'bearer', authActive: true, token: 'tok123' });
  });

  test('basic auth', () => {
    const auth = convertAuth({
      type: 'basic',
      basic: [
        { key: 'username', value: 'user' },
        { key: 'password', value: 'pass' },
      ],
    });
    expect(auth).toEqual({ authType: 'basic', authActive: true, username: 'user', password: 'pass' });
  });

  test('apikey auth', () => {
    const auth = convertAuth({
      type: 'apikey',
      apikey: [
        { key: 'key', value: 'X-Api-Key' },
        { key: 'value', value: 'secret' },
        { key: 'in', value: 'header' },
      ],
    });
    expect(auth.authType).toBe('api-key');
    expect(auth.key).toBe('X-Api-Key');
    expect(auth.value).toBe('secret');
    expect(auth.addTo).toBe('header');
  });

  test('oauth2 auth', () => {
    const auth = convertAuth({
      type: 'oauth2',
      oauth2: [
        { key: 'accessTokenUrl', value: 'https://auth.example.com/token' },
        { key: 'clientId', value: 'client123' },
      ],
    });
    expect(auth.authType).toBe('oauth-2');
    expect(auth.accessTokenURL).toBe('https://auth.example.com/token');
    expect(auth.clientID).toBe('client123');
  });

  test('unsupported type → none', () => {
    expect(convertAuth({ type: 'digest' })).toEqual({ authType: 'none', authActive: true });
    expect(convertAuth({ type: 'ntlm' })).toEqual({ authType: 'none', authActive: true });
  });

  test('bearer converts variables in token', () => {
    const auth = convertAuth({
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{myToken}}' }],
    });
    expect(auth.token).toBe('<<myToken>>');
  });
});

// ── convertBody ───────────────────────────────────────────────────────────

describe('convertBody', () => {
  test('null → null body', () => {
    expect(convertBody(null)).toEqual({ contentType: null, body: null });
  });

  test('disabled body → null body', () => {
    expect(convertBody({ mode: 'raw', raw: 'data', disabled: true })).toEqual({
      contentType: null,
      body: null,
    });
  });

  test('raw json', () => {
    const result = convertBody({
      mode: 'raw',
      raw: '{"x":1}',
      options: { raw: { language: 'json' } },
    });
    expect(result.contentType).toBe('application/json');
    expect(result.body).toBe('{"x":1}');
  });

  test('raw text defaults to text/plain', () => {
    const result = convertBody({ mode: 'raw', raw: 'hello' });
    expect(result.contentType).toBe('text/plain');
  });

  test('urlencoded', () => {
    const result = convertBody({
      mode: 'urlencoded',
      urlencoded: [
        { key: 'a', value: '1' },
        { key: 'b', value: '2', disabled: true },
      ],
    });
    expect(result.contentType).toBe('application/x-www-form-urlencoded');
    expect(result.body).toBe('a=1');
  });

  test('formdata', () => {
    const result = convertBody({
      mode: 'formdata',
      formdata: [{ key: 'field', value: 'val' }],
    });
    expect(result.contentType).toBe('multipart/form-data');
    expect(Array.isArray(result.body)).toBe(true);
    expect(result.body[0]).toMatchObject({ key: 'field', value: 'val' });
  });

  test('graphql', () => {
    const result = convertBody({
      mode: 'graphql',
      graphql: { query: '{ user { id } }', variables: '' },
    });
    expect(result.contentType).toBe('application/json');
    const parsed = JSON.parse(result.body);
    expect(parsed.query).toBe('{ user { id } }');
  });
});

// ── convertHeaders ────────────────────────────────────────────────────────

describe('convertHeaders', () => {
  test('empty list', () => expect(convertHeaders([])).toEqual([]));
  test('null → empty list', () => expect(convertHeaders(null)).toEqual([]));
  test('string → empty list', () => expect(convertHeaders('raw-header')).toEqual([]));

  test('maps key/value/active/description', () => {
    const result = convertHeaders([
      { key: 'X-Enabled', value: 'yes' },
      { key: 'X-Disabled', value: 'no', disabled: true },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ key: 'X-Enabled', value: 'yes', active: true });
    expect(result[1]).toMatchObject({ key: 'X-Disabled', active: false });
  });
});

// ── convertParams ─────────────────────────────────────────────────────────

describe('convertParams', () => {
  test('empty when url is a string', () => {
    expect(convertParams('https://example.com/path')).toEqual([]);
  });

  test('extracts query params', () => {
    const params = convertParams({
      query: [
        { key: 'page', value: '1' },
        { key: 'limit', value: '10', disabled: true },
      ],
    });
    expect(params).toHaveLength(2);
    expect(params[0]).toMatchObject({ key: 'page', value: '1', active: true });
    expect(params[1]).toMatchObject({ key: 'limit', active: false });
  });
});

// ── isFolder ──────────────────────────────────────────────────────────────

describe('isFolder', () => {
  test('item with sub-items and no request → folder', () => {
    expect(isFolder({ name: 'F', item: [] })).toBe(true);
  });
  test('item with request → not a folder', () => {
    expect(isFolder({ name: 'R', request: {} })).toBe(false);
  });
  test('item with both item and request → not a folder', () => {
    expect(isFolder({ name: 'X', item: [], request: {} })).toBe(false);
  });
});

// ── convertRequest ────────────────────────────────────────────────────────

describe('convertRequest', () => {
  test('GET request basic fields', () => {
    const req = convertRequest(FULL_COLLECTION.item[0]);
    expect(req.v).toBe('17');
    expect(req.name).toBe('Get Users');
    expect(req.method).toBe('GET');
    expect(req.endpoint).toBe('https://api.example.com/users');
    expect(req.params).toEqual([{ key: 'page', value: '1', active: true, description: '' }]);
  });

  test('POST request with JSON body', () => {
    const req = convertRequest(FULL_COLLECTION.item[1]);
    expect(req.method).toBe('POST');
    expect(req.body.contentType).toBe('application/json');
    expect(req.body.body).toBe('{"name": "Alice"}');
  });

  test('bearer auth on request', () => {
    const req = convertRequest(FULL_COLLECTION.item[1]);
    expect(req.auth.authType).toBe('bearer');
    expect(req.auth.token).toBe('mytoken');
  });

  test('request with URL as plain string', () => {
    const req = convertRequest({ name: 'Ping', request: 'https://example.com/ping' });
    expect(req.endpoint).toBe('https://example.com/ping');
    expect(req.method).toBe('GET');
  });
});

// ── convertFolder ─────────────────────────────────────────────────────────

describe('convertFolder', () => {
  test('converts folder item', () => {
    const folder = convertFolder(FULL_COLLECTION.item[2]);
    expect(folder.v).toBe(11);
    expect(folder.name).toBe('Folder');
    expect(folder.requests).toHaveLength(1);
    expect(folder.requests[0].name).toBe('Delete User');
    expect(folder.folders).toHaveLength(0);
    expect(typeof folder._ref_id).toBe('string');
  });
});

// ── convertCollection ─────────────────────────────────────────────────────

describe('convertCollection', () => {
  test('empty collection structure', () => {
    const result = convertCollection(MINIMAL_COLLECTION);
    expect(result.v).toBe(11);
    expect(result.name).toBe('Test Collection');
    expect(result.folders).toEqual([]);
    expect(result.requests).toEqual([]);
    expect(typeof result._ref_id).toBe('string');
  });

  test('full collection has correct request/folder counts', () => {
    const result = convertCollection(FULL_COLLECTION);
    expect(result.requests).toHaveLength(2);
    expect(result.folders).toHaveLength(1);
  });

  test('collection variables are converted', () => {
    const data = {
      ...MINIMAL_COLLECTION,
      variable: [{ key: 'baseUrl', value: 'https://api.example.com' }],
    };
    const result = convertCollection(data);
    expect(result.variables).toEqual([
      { key: 'baseUrl', value: 'https://api.example.com', active: true },
    ]);
  });

  test('collection auth is converted', () => {
    const data = {
      ...MINIMAL_COLLECTION,
      auth: { type: 'bearer', bearer: [{ key: 'token', value: 'tok' }] },
    };
    const result = convertCollection(data);
    expect(result.auth.authType).toBe('bearer');
  });

  test('each call produces a unique _ref_id', () => {
    const a = convertCollection(MINIMAL_COLLECTION);
    const b = convertCollection(MINIMAL_COLLECTION);
    expect(a._ref_id).not.toBe(b._ref_id);
  });
});
