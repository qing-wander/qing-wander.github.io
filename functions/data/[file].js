/* /data/* —— 站点数据公开读取（动态路由）
   ──────────────────────────────────────────────────────────────
   仓库里的 data/*.js / data/*.json 是脱敏占位副本（给 CI 和本地预览用）。
   线上 Pages 部署时，这个路由优先命中 /data/<file>，从 D1 的 site_content
   读真人数据返回；没配过的 key 回退到静态副本，保证站点不会因为漏配而白屏。

   支持的文件（见 lib/site-content.js 白名单）：
     site-data.js / company-profiles.js / school-profiles.js / people.js
     contributions.json / work-details.json / asset-manifest.json

   缓存 5 分钟：后台改完最多 5 分钟全站生效；想立刻看可加 ?v= 时间戳。
   ────────────────────────────────────────────────────────────── */
import { isKey, keyForFile, readContent, toSnapshot, KEYS } from '../lib/site-content.js';

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const file = params && params.file;
  const key = keyForFile(file);
  if (!key || !isKey(key)) {
    return new Response('Not found', { status: 404 });
  }

  const row = await readContent(env, key).catch(() => null);

  /* 云端没配 → 回退到构建产物里的静态副本（dist/data/fallback/<file>）。
     不能直接 fetch /data/<file>，那会再次命中本路由形成死循环；
     构建脚本会把仓库里的脱敏副本复制到 data/fallback/ 子目录。 */
  if (!row) {
    const origin = new URL(request.url).origin;
    const staticRes = await fetch(origin + '/data/fallback/' + file).catch(() => null);
    if (staticRes && staticRes.ok) {
      const text = await staticRes.text();
      return respond(text, KEYS[key].file === file && KEYS[key].global ? 'application/javascript' : 'application/json');
    }
    return new Response('Data not configured', { status: 404 });
  }

  const meta = KEYS[key];
  if (meta.global && meta.file === file) {
    const js = toSnapshot(key, row.payload);
    return respond(js, 'application/javascript');
  }
  return respond(row.payload, 'application/json');
}

function respond(text, contentType) {
  return new Response(text, {
    status: 200,
    headers: {
      'Content-Type': contentType + '; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Source': 'cloud',
    },
  });
}
