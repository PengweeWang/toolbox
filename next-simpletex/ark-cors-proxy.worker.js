/**
 * Ark CORS Proxy - Cloudflare Worker
 *
 * 用途：只代理火山方舟的 GET /api/v3/models，解决浏览器跨域问题。
 *
 * 部署方式（二选一）：
 * 1. 控制台：Cloudflare Dashboard -> Workers & Pages -> Create -> Worker
 *    把本文件内容粘贴进去，Deploy。
 * 2. Wrangler：
 *    npm i -g wrangler
 *    wrangler login
 *    wrangler deploy ark-cors-proxy.worker.js --name ark-cors-proxy
 *
 * 部署后把 next-simpletex/app.js 里的：
 *   const MODEL_LIST_PROXY = 'https://proxy.corsfix.com/?';
 * 改成你自己的 Worker 地址：
 *   const MODEL_LIST_PROXY = 'https://ark-cors-proxy.<你的子域>.workers.dev/?';
 *
 * 支持两种调用方式：
 *   https://<worker>/?https://ark.cn-beijing.volces.com/api/v3/models
 *   https://<worker>/?url=https%3A%2F%2Fark.cn-beijing.volces.com%2Fapi%2Fv3%2Fmodels
 */

// 建议改成你实际部署页面的域名，例如 ['https://pengweewang.github.io']
// 设为 ['*'] 表示允许任意来源（仍然是受限代理，只放行下面的 Ark 模型列表接口）
const ALLOWED_ORIGINS = ['*'];

// 只允许代理这个主机的这个接口，避免 Worker 变成任意请求的开放代理
const ALLOWED_TARGET_HOST = 'ark.cn-beijing.volces.com';
const ALLOWED_TARGET_PATH = '/api/v3/models';

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';

    if (!isOriginAllowed(origin)) {
      return jsonResponse({ error: 'origin_not_allowed' }, 403, origin);
    }

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'GET') {
      return jsonResponse({ error: 'method_not_allowed' }, 405, origin);
    }

    const target = parseTargetUrl(request.url);
    if (!target) {
      return jsonResponse({
        error: 'missing_target',
        message: '用法：/?https://ark.cn-beijing.volces.com/api/v3/models'
      }, 400, origin);
    }

    if (!isTargetAllowed(target)) {
      return jsonResponse({ error: 'target_not_allowed' }, 403, origin);
    }

    // 只透传必要的请求头，避免把浏览器信息、Cookie 等带到上游
    const upstreamHeaders = new Headers();
    const authorization = request.headers.get('Authorization');
    if (authorization) upstreamHeaders.set('Authorization', authorization);
    const accept = request.headers.get('Accept');
    if (accept) upstreamHeaders.set('Accept', accept);

    let upstream;
    try {
      upstream = await fetch(target, {
        method: 'GET',
        headers: upstreamHeaders,
        redirect: 'follow'
      });
    } catch (error) {
      return jsonResponse({
        error: 'upstream_unreachable',
        message: error.message
      }, 502, origin);
    }

    // 不跨用户共享缓存：模型列表与该 API Key 的权限有关
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete('set-cookie');
    responseHeaders.set('Cache-Control', 'no-store');
    for (const [key, value] of Object.entries(corsHeaders(origin))) {
      responseHeaders.set(key, value);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  }
};

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes('*')
    ? '*'
    : (ALLOWED_ORIGINS.includes(origin) ? origin : 'null');

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function isOriginAllowed(origin) {
  return ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin);
}

function parseTargetUrl(requestUrl) {
  const url = new URL(requestUrl);

  // ?url=<encoded>
  const urlParam = url.searchParams.get('url');
  if (urlParam) return urlParam;

  // ?https://...
  let raw = url.search.replace(/^\?/, '');
  if (!raw) {
    // /https://...
    raw = url.pathname.replace(/^\//, '');
  }

  try {
    raw = decodeURIComponent(raw);
  } catch (error) {
    // 保持原样
  }

  return /^https?:\/\//i.test(raw) ? raw : '';
}

function isTargetAllowed(target) {
  try {
    const url = new URL(target);
    return url.protocol === 'https:'
      && url.hostname === ALLOWED_TARGET_HOST
      && url.pathname === ALLOWED_TARGET_PATH;
  } catch (error) {
    return false;
  }
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
