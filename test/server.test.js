'use strict';

const request = require('supertest');
const app = require('../server');

const VALID_COLLECTION = {
  info: { name: 'My API', schema: '...' },
  item: [
    {
      name: 'Get Users',
      request: {
        method: 'GET',
        header: [],
        url: { raw: 'https://api.example.com/users' },
      },
    },
    {
      name: 'Folder',
      item: [
        {
          name: 'Create User',
          request: {
            method: 'POST',
            header: [],
            url: { raw: 'https://api.example.com/users' },
            body: {
              mode: 'raw',
              raw: '{"name":"Bob"}',
              options: { raw: { language: 'json' } },
            },
          },
        },
      ],
    },
  ],
};

// ── GET / ─────────────────────────────────────────────────────────────────

describe('GET /', () => {
  test('returns 200 and HTML page', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Postman');
  });
});

// ── POST /convert ─────────────────────────────────────────────────────────

describe('POST /convert', () => {
  test('400 when no file sent', async () => {
    const res = await request(app).post('/convert');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No file/i);
  });

  test('400 for non-JSON file extension', async () => {
    const res = await request(app)
      .post('/convert')
      .attach('file', Buffer.from('{}'), { filename: 'collection.xml', contentType: 'text/xml' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JSON/i);
  });

  test('422 for invalid JSON content', async () => {
    const res = await request(app)
      .post('/convert')
      .attach('file', Buffer.from('not json'), { filename: 'collection.json' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Invalid JSON/i);
  });

  test('422 for valid JSON that is not a Postman collection', async () => {
    const res = await request(app)
      .post('/convert')
      .attach('file', Buffer.from(JSON.stringify({ foo: 'bar' })), { filename: 'collection.json' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Postman/i);
  });

  test('200 with downloadable JSON for a valid collection', async () => {
    const res = await request(app)
      .post('/convert')
      .attach('file', Buffer.from(JSON.stringify(VALID_COLLECTION)), { filename: 'my_api.json' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toMatch(/hoppscotch/);

    const output = JSON.parse(res.text);
    expect(Array.isArray(output)).toBe(true);
    expect(output).toHaveLength(1);
    const collection = output[0];
    expect(collection.name).toBe('My API');
    expect(collection.requests).toHaveLength(1);
    expect(collection.folders).toHaveLength(1);
  });

  test('output filename is derived from uploaded filename', async () => {
    const res = await request(app)
      .post('/convert')
      .attach('file', Buffer.from(JSON.stringify(VALID_COLLECTION)), { filename: 'my_collection.json' });

    expect(res.headers['content-disposition']).toContain('my_collection_hoppscotch.json');
  });

  test('unicode filename is returned via filename* without header errors', async () => {
    const res = await request(app)
      .post('/convert')
      .attach('file', Buffer.from(JSON.stringify(VALID_COLLECTION)), {
        filename: 'CGTrust 2.0.0 文化部退輔會.postman_collection.json',
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect(res.headers['content-disposition']).toContain('%E6%96%87%E5%8C%96%E9%83%A8');
  });

  test('variables ({{var}}) are converted to <<var>> in endpoint', async () => {
    const col = {
      info: { name: 'VarTest', schema: '' },
      item: [
        {
          name: 'VarReq',
          request: {
            method: 'GET',
            header: [],
            url: { raw: '{{baseUrl}}/path' },
          },
        },
      ],
    };
    const res = await request(app)
      .post('/convert')
      .attach('file', Buffer.from(JSON.stringify(col)), { filename: 'vars.json' });

    expect(res.status).toBe(200);
    const [collection] = JSON.parse(res.text);
    expect(collection.requests[0].endpoint).toBe('<<baseUrl>>/path');
  });
});
