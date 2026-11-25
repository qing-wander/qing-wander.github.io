import { useState } from 'react';

/**
 * 作品案例页 · M0 管道验证壳（docs/react-refactor-plan.md §6-M0）
 *
 * 定位：验证「Astro SSG → React 组件 → 岛水合」全链路能与 pages-build.sh 混排产物协同工作；
 * 完整案例内容迁移在 M2 进行（本组件届时按 work-details.json 全字段重构）。
 *
 * 可移植边界：本文件属于 components 层，禁止 import astro 模块（eslint 强制），
 * 数据一律通过 props 注入，保证可在纯 Vite SPA 备选方案下无改动复用。
 */

export interface HeroMetric {
  value: string;
  unit: string;
  label: string;
  note: string;
}

export interface PortfolioShellProps {
  /** works 元数据（site-data.json） */
  meta: { title: string; titleEn: string; no: string };
  /** work-details.json 的 portfolio 条目（摘要子集） */
  detail: {
    tagline: string;
    role: string;
    period: string;
    status: string;
    heroMetrics: HeroMetric[];
  };
  /** 构建期注入：数据源校验信息（M0 管道验证用） */
  buildInfo: { dataPath: string; builtAt: string; engine: 'astro-ssg' };
}

export function PortfolioShell({ meta, detail, buildInfo }: PortfolioShellProps) {
  const [hydrated, setHydrated] = useState(false);
  return (
    <main className="pf-shell">
      <header className="pf-head">
        <p className="pf-no">{meta.no} · CASE STUDY</p>
        <h1 className="pf-title">
          {meta.title} <span className="pf-title-en">{meta.titleEn}</span>
        </h1>
        <p className="pf-tagline">{detail.tagline}</p>
        <p className="pf-meta">
          {detail.role} · {detail.period} · {detail.status}
        </p>
      </header>

      <section className="pf-metrics" aria-label="核心指标">
        {detail.heroMetrics.map((m) => (
          <div className="pf-metric" key={m.label}>
            <p className="pf-metric-value">
              {m.value}
              <span className="pf-metric-unit">{m.unit}</span>
            </p>
            <p className="pf-metric-label">{m.label}</p>
            <p className="pf-metric-note">{m.note}</p>
          </div>
        ))}
      </section>

      {/* 岛水合验证：SSG 输出的静态 HTML 中此按钮无效，水合成功后才可交互 */}
      <section className="pf-verify">
        <button
          type="button"
          className="pf-verify-btn"
          onClick={() => setHydrated(true)}
        >
          {hydrated ? '✓ 反应已水合' : '水合验证（点击）'}
        </button>
        {hydrated && (
          <p className="pf-verify-info" role="status">
            数据源 {buildInfo.dataPath} · {buildInfo.engine} · 构建于 {buildInfo.builtAt}
          </p>
        )}
        {!hydrated && (
          <noscript>
            <p>本页交互能力需要 JavaScript；静态内容由服务端渲染，无需脚本即可阅读。</p>
          </noscript>
        )}
      </section>
    </main>
  );
}

export default PortfolioShell;
