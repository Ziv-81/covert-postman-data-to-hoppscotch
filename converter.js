/**
 * Postman Collection (v2.1) → Hoppscotch Collection converter.
 *
 * Direct port of the Python reference implementation.
 * Produces Hoppscotch collection v11 / REST request v17 / originalRequest v6.
 *
 * Output is an array containing a single collection object, matching the
 * format expected by Hoppscotch's "Import from Hoppscotch" feature.
 */

'use strict';

const { randomUUID } = require('crypto');

// ── Helpers ──────────────────────────────────────────────────────────────

function newRefId() {
  return randomUUID();
}

/** Convert Postman {{var}} template syntax to Hoppscotch <<var>> syntax. */
function convertVariables(text) {
  if (typeof text !== 'string' || !text) return '';
  // Use [^{}]+ (excludes both { and }) to avoid polynomial backtracking (ReDoS)
  return text.replace(/\{\{([^{}]+)\}\}/g, '<<$1>>');
}

/** Postman description can be a plain string or {content, type} object. */
function extractDescription(desc) {
  if (desc == null) return '';
  if (typeof desc === 'string') return desc;
  if (typeof desc === 'object') return desc.content || '';
  return '';
}

// ── URL ──────────────────────────────────────────────────────────────────

/** Return the endpoint (URL without query string) from a Postman URL field. */
function buildEndpoint(urlObj) {
  if (typeof urlObj === 'string') {
    return convertVariables(urlObj.split('?')[0]);
  }
  const raw = (urlObj && urlObj.raw) || '';
  return convertVariables(raw.split('?')[0]);
}

/** Extract query parameters from a Postman URL object. */
function convertParams(urlObj) {
  const params = [];
  if (urlObj && typeof urlObj === 'object') {
    for (const q of urlObj.query || []) {
      params.push({
        key: convertVariables(q.key || ''),
        value: convertVariables(q.value || ''),
        active: !q.disabled,
        description: extractDescription(q.description),
      });
    }
  }
  return params;
}

/** Extract path (URL) variables from a Postman URL object. */
function convertRequestVariables(urlObj) {
  const variables = [];
  if (urlObj && typeof urlObj === 'object') {
    for (const v of urlObj.variable || []) {
      variables.push({
        key: convertVariables(v.key || v.id || ''),
        value: convertVariables(v.value != null ? String(v.value) : ''),
        active: !v.disabled,
        description: extractDescription(v.description),
      });
    }
  }
  return variables;
}

// ── Headers ──────────────────────────────────────────────────────────────

function convertHeaders(headers) {
  if (!headers) return [];
  // Postman schema allows headers as a string (rare) — ignore
  if (typeof headers === 'string') return [];
  return headers.map((h) => ({
    key: convertVariables(h.key || ''),
    value: convertVariables(h.value || ''),
    active: !h.disabled,
    description: extractDescription(h.description),
  }));
}

// ── Auth ─────────────────────────────────────────────────────────────────

/** Convert Postman auth's [{key,value},...] array to a plain object. */
function authKv(authObj, typeName) {
  const items = authObj[typeName];
  if (!Array.isArray(items)) return {};
  return items.reduce((acc, item) => {
    if (item.key != null) acc[item.key] = item.value || '';
    return acc;
  }, {});
}

/**
 * Convert Postman auth block to Hoppscotch auth object.
 * Supports: noauth, inherit, basic, bearer, apikey, oauth2.
 * Unsupported types (oauth1, digest, hawk, ntlm, awsv4, edgegrid) → none.
 */
function convertAuth(authObj) {
  if (!authObj) return { authType: 'none', authActive: true };

  const authType = authObj.type || 'noauth';

  if (authType === 'noauth') return { authType: 'none', authActive: true };
  if (authType === 'inherit') return { authType: 'inherit', authActive: true };

  if (authType === 'basic') {
    const kv = authKv(authObj, 'basic');
    return {
      authType: 'basic',
      authActive: true,
      username: convertVariables(kv.username || ''),
      password: convertVariables(kv.password || ''),
    };
  }

  if (authType === 'bearer') {
    const kv = authKv(authObj, 'bearer');
    return {
      authType: 'bearer',
      authActive: true,
      token: convertVariables(kv.token || ''),
    };
  }

  if (authType === 'apikey') {
    const kv = authKv(authObj, 'apikey');
    return {
      authType: 'api-key',
      authActive: true,
      key: convertVariables(kv.key || ''),
      value: convertVariables(kv.value || ''),
      addTo: kv.in || 'header',
    };
  }

  if (authType === 'oauth2') {
    const kv = authKv(authObj, 'oauth2');
    return {
      authType: 'oauth-2',
      authActive: true,
      accessTokenURL: convertVariables(kv.accessTokenUrl || ''),
      authURL: convertVariables(kv.authUrl || ''),
      clientID: convertVariables(kv.clientId || ''),
      scope: convertVariables(kv.scope || ''),
      token: convertVariables(kv.accessToken || ''),
      oidcDiscoveryURL: '',
      grantTypeInfo: {
        grantType: 'AUTHORIZATION_CODE',
        authEndpoint: convertVariables(kv.authUrl || ''),
        tokenEndpoint: convertVariables(kv.accessTokenUrl || ''),
        clientID: convertVariables(kv.clientId || ''),
        clientSecret: convertVariables(kv.clientSecret || ''),
        scopes: convertVariables(kv.scope || ''),
        isPKCE: false,
        codeVerifierMethod: 'S256',
      },
    };
  }

  // oauth1, digest, hawk, ntlm, awsv4, edgegrid — not supported by Hoppscotch
  return { authType: 'none', authActive: true };
}

// ── Body ─────────────────────────────────────────────────────────────────

/**
 * Convert Postman request body to Hoppscotch body.
 * Supports mode: raw, urlencoded, formdata, graphql, file.
 */
function convertBody(bodyObj) {
  if (!bodyObj) return { contentType: null, body: null };
  if (bodyObj.disabled) return { contentType: null, body: null };

  const mode = bodyObj.mode;

  if (mode === 'raw') {
    const raw = convertVariables(bodyObj.raw || '');
    const language = (bodyObj.options?.raw?.language || 'text').toLowerCase();
    const contentTypeMap = {
      json: 'application/json',
      xml: 'application/xml',
      html: 'text/html',
      text: 'text/plain',
      javascript: 'application/javascript',
    };
    return { contentType: contentTypeMap[language] || 'text/plain', body: raw };
  }

  if (mode === 'urlencoded') {
    const entries = (bodyObj.urlencoded || [])
      .filter((item) => !item.disabled)
      .map(
        (item) =>
          `${convertVariables(item.key || '')}=${convertVariables(item.value || '')}`
      );
    return {
      contentType: 'application/x-www-form-urlencoded',
      body: entries.join('&'),
    };
  }

  if (mode === 'formdata') {
    const entries = (bodyObj.formdata || []).map((item) => ({
      key: convertVariables(item.key || ''),
      value: convertVariables(
        item.type === 'file' ? item.src || '' : item.value || ''
      ),
      active: !item.disabled,
      isFile: item.type === 'file',
    }));
    return { contentType: 'multipart/form-data', body: entries };
  }

  if (mode === 'graphql') {
    const gql = bodyObj.graphql || {};
    return {
      contentType: 'application/json',
      body: JSON.stringify({ query: gql.query || '', variables: gql.variables || '' }),
    };
  }

  if (mode === 'file') {
    // Single-file upload — Hoppscotch has no equivalent; use empty body
    return { contentType: null, body: null };
  }

  return { contentType: null, body: null };
}

// ── Scripts ──────────────────────────────────────────────────────────────

/** Extract pre-request and test scripts from Postman event array. */
function extractScripts(events) {
  let preRequest = '';
  let test = '';
  for (const event of events || []) {
    if (event.disabled) continue;
    const listen = event.listen || '';
    const execVal = event.script?.exec || [];
    const code = Array.isArray(execVal) ? execVal.join('\n') : String(execVal);
    if (listen === 'prerequest') preRequest = code;
    else if (listen === 'test') test = code;
  }
  return { preRequest, test };
}

// ── Responses ────────────────────────────────────────────────────────────

function sanitizeBody(body) {
  if (!body) return '';
  return body.replace(/\u0000/g, '');
}

function convertOriginalRequest(origReq, requestName = '') {
  if (!origReq || typeof origReq === 'string') {
    return {
      v: '6',
      name: requestName,
      method: 'GET',
      endpoint: typeof origReq === 'string' ? convertVariables(origReq) : '',
      headers: [],
      params: [],
      body: { contentType: null, body: null },
      auth: { authType: 'none', authActive: true },
      requestVariables: [],
    };
  }
  const urlObj = origReq.url || '';
  return {
    v: '6',
    name: requestName,
    method: origReq.method || 'GET',
    endpoint: buildEndpoint(urlObj),
    headers: convertHeaders(origReq.header || []),
    params: convertParams(urlObj),
    body: convertBody(origReq.body),
    auth: convertAuth(origReq.auth),
    requestVariables: convertRequestVariables(urlObj),
  };
}

function convertResponseHeaders(headers) {
  if (!headers || typeof headers === 'string') return [];
  return headers.map((h) => ({ key: h.key || '', value: h.value || '' }));
}

function convertResponses(responses, requestName = '') {
  if (!responses || !responses.length) return {};
  const result = {};
  for (const resp of responses) {
    const name = resp.name || 'Untitled Response';
    let uniqueName = name;
    let counter = 1;
    while (Object.prototype.hasOwnProperty.call(result, uniqueName)) {
      counter++;
      uniqueName = `${name} (${counter})`;
    }
    result[uniqueName] = {
      name,
      originalRequest: convertOriginalRequest(resp.originalRequest, requestName),
      status: resp.status || '',
      code: resp.code ?? null,
      headers: convertResponseHeaders(resp.header),
      body: sanitizeBody(resp.body || ''),
    };
  }
  return result;
}

// ── Request ──────────────────────────────────────────────────────────────

function convertRequest(item) {
  const request = item.request || {};
  const name = item.name || 'Untitled Request';
  const reqDesc =
    typeof request === 'object' ? extractDescription(request.description) : null;

  if (typeof request === 'string') {
    return {
      v: '17',
      name,
      method: 'GET',
      endpoint: convertVariables(request.split('?')[0]),
      headers: [],
      params: [],
      auth: { authType: 'none', authActive: true },
      body: { contentType: null, body: null },
      preRequestScript: '',
      testScript: '',
      requestVariables: [],
      responses: convertResponses(item.response || [], name),
      description: reqDesc || null,
    };
  }

  const urlObj = request.url || '';
  const { preRequest, test } = extractScripts(item.event);
  const body = convertBody(request.body);

  return {
    v: '17',
    name,
    method: request.method || 'GET',
    endpoint: buildEndpoint(urlObj),
    headers: convertHeaders(request.header || []),
    params: convertParams(urlObj),
    auth: convertAuth(request.auth),
    body,
    preRequestScript: preRequest,
    testScript: test,
    requestVariables: convertRequestVariables(urlObj),
    responses: convertResponses(item.response || [], name),
    description: reqDesc || null,
  };
}

// ── Folder / Collection ──────────────────────────────────────────────────

function isFolder(item) {
  return Object.prototype.hasOwnProperty.call(item, 'item') &&
    !Object.prototype.hasOwnProperty.call(item, 'request');
}

function convertVariablesList(variables) {
  return (variables || []).map((v) => ({
    key: v.key || v.id || '',
    value: v.value != null ? String(v.value) : '',
    active: !v.disabled,
  }));
}

function convertFolder(item) {
  const folders = [];
  const requests = [];
  for (const child of item.item || []) {
    if (isFolder(child)) folders.push(convertFolder(child));
    else requests.push(convertRequest(child));
  }
  return {
    v: 11,
    _ref_id: newRefId(),
    name: item.name || 'Untitled Folder',
    folders,
    requests,
    auth: convertAuth(item.auth),
    headers: convertHeaders(item.header || []),
    variables: convertVariablesList(item.variable),
    description: extractDescription(item.description),
  };
}

/**
 * Convert an entire Postman collection object to a Hoppscotch collection.
 *
 * @param {object} postman - Parsed Postman Collection v2/v2.1 JSON.
 * @returns {object} Hoppscotch collection object (v11).
 */
function convertCollection(postman) {
  const info = postman.info || {};
  const folders = [];
  const requests = [];

  for (const item of postman.item || []) {
    if (isFolder(item)) folders.push(convertFolder(item));
    else requests.push(convertRequest(item));
  }

  return {
    v: 11,
    _ref_id: newRefId(),
    name: info.name || 'Untitled Collection',
    folders,
    requests,
    auth: convertAuth(postman.auth),
    headers: [],
    variables: convertVariablesList(postman.variable),
    description: extractDescription(info.description),
  };
}

module.exports = {
  convertCollection,
  // Exported for testing
  convertVariables,
  convertAuth,
  convertBody,
  convertHeaders,
  convertParams,
  convertRequest,
  convertFolder,
  isFolder,
};
