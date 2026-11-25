/* /data/* —— 站点数据公开读取（动态路由）
   ──────────────────────────────────────────────────────────────
   仓库里的 data/*.js / data/*.json 是脱敏占位副本（给 CI 和本地预览用）。
   线上 Pages 部署时，这个路由优先命中 /data/<file>，从 D1 的 site_content
   读真人数据返回；没配过的 key 回退到静态副本，保证站点不会因为漏配而白屏。

   支持的文件（见 lib/site-content.js 白名单）：
     site-data.js / company-profiles.js / school-profiles.js / people.js
     contributions.json / work-details.json / asset-manifest.json

   白名单之外的文件一律 next() 交回静态资源：这条路由是 [file] 通配，
   会一并吃掉 data/ 下所有非 JSON 快照（snake.svg 蛇图、asset-map.js
   资源映射脚本…）。之前在这里直接 404，线上表现为蛇图只剩 alt 文字、
   COS 资源映射失效。静态目录里没有的文件，next() 自己会给 404。

   缓存 5 分钟：后台改完最多 5 分钟全站生效；想立刻看可加 ?v= 时间戳。
   ────────────────────────────────────────────────────────────── */
import { isKey, keyForFile, readContent, toSnapshot, KEYS } from '../lib/site-content.js';

export async function onRequestGet(context) {
  const { request, env, params, next } = context;
  const file = params && params.file;
  const key = keyForFile(file);
  /* 不是数据快照 → 放行给静态资源（单测直接调用时没有 next，退回 404） */
  if (!key || !isKey(key)) {
    if (typeof next === 'function') return next();
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
