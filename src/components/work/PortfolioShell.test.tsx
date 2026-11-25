import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest'; // matcher 类型声明合并（toHaveTextContent 等）
import { render, screen, fireEvent } from '@testing-library/react';
import { PortfolioShell } from './PortfolioShell';

const baseProps = {
  meta: { title: '求职作品集 · 本站', titleEn: 'PORTFOLIO SITE', no: 'W-01' },
  detail: {
    tagline: '一个人的求职站，做成了一套可维护的内容系统',
    role: '独立完成',
    period: '2026.09 — 至今',
    status: '线上运行',
    heroMetrics: [
      { value: '2', unit: '页', label: '简历 PDF 硬约束', note: '无头 Chrome 自动量页' },
      { value: '0', unit: '依赖', label: '运行时前端库', note: '原生 JS + 静态 CSS' },
    ],
  },
  buildInfo: { dataPath: 'data/work-details.json', builtAt: '2026-11-25', engine: 'astro-ssg' as const },
};

describe('PortfolioShell（M0 管道验证组件）', () => {
  it('SSG 内容：标题 / 标语 / 指标静态渲染（无 JS 也可读）', () => {
    render(<PortfolioShell {...baseProps} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('求职作品集 · 本站');
    expect(screen.getByText('一个人的求职站，做成了一套可维护的内容系统')).toBeTruthy();
    expect(screen.getByText('简历 PDF 硬约束')).toBeTruthy();
  });

  it('岛交互：水合验证按钮点击后呈现构建信息', () => {
    render(<PortfolioShell {...baseProps} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toContain('水合验证');
    fireEvent.click(btn);
    expect(screen.getByRole('status').textContent).toContain('data/work-details.json');
  });
});
