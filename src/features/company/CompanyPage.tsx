/**
 * /company.html 独立档案页（M2）—— 复刻 company.html 内联路由脚本：
 *   ?c=id → 单公司档案；无 / 未知 id → 全部档案列表。
 * ?c= 切换保持整页导航（与旧版 <a href="?c=…"> 行为一致，URL 态不变）。
 * SSG 直出列表态（SEO 可见全部档案入口）；带 ?c= 访问时水合后即刻切换（首帧时序与
 * 旧版「内联脚本同步渲染」同为绘制前完成）。
 */
import { useEffect, useState } from 'react';
import CompanyProfilePanel from './CompanyProfilePanel';
import { COMPANY_META, getCompany, listCompanies, type Company } from './data';

export default function CompanyPage() {
  const [visit, setVisit] = useState<{ id: string; c: Company | null }>({ id: '', c: null });

  useEffect(() => {
    const q = new URLSearchParams(location.search).get('c') || '';
    setVisit({ id: q, c: q ? getCompany(q) : null });
  }, []);

  if (visit.c) {
    return (
      <>
        <CompanyProfilePanel c={visit.c} />
        {COMPANY_META.disclaimer ? (
          <p className="cp-disclaimer" style={{ marginTop: '14px' }}>{COMPANY_META.disclaimer}</p>
        ) : null}
      </>
    );
  }

  return <CompanyList unknownId={visit.id} />;
}

function CompanyList({ unknownId }: { unknownId: string }) {
  const all = listCompanies();
  return (
    <>
      <p className="cp-list-note">
        {unknownId
          ? `没有找到「${unknownId}」的档案，以下是全部档案：`
          : '选择一家公司查看完整档案：'}
      </p>
      <div className="cp-list">
        {all.map((x) => (
          <a key={x.id} className="cp-list-card" href={'?c=' + encodeURIComponent(x.id || '')}>
            <span className="cp-list-name">{x.name}</span>
            <span className="cp-list-ind">{x.industry || ''}</span>
            <span className="cp-list-oneline">{x.oneLine || ''}</span>
            <span className="cp-list-go">查看档案 →</span>
          </a>
        ))}
      </div>
    </>
  );
}
