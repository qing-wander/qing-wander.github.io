/**
 * /school.html 独立学校档案页（M2）—— 复刻 school.html 内联路由脚本：
 *   ?c=id → 单校档案；只有一所学校时未带参数直接展示；否则列出全部档案。
 * URL 契约与整页导航行为与旧版一致（N3）。
 */
import { useEffect, useState } from 'react';
import SchoolPanel from './SchoolPanel';
import { getSchool, listSchools, type School } from './data';

export default function SchoolPage() {
  const [visit, setVisit] = useState<{ id: string; s: School | null }>({ id: '', s: null });

  useEffect(() => {
    const q = new URLSearchParams(location.search).get('c') || '';
    const all = listSchools();
    const id = !q && all.length === 1 ? all[0]!.id : q;
    const s = id ? getSchool(id) : null;
    setVisit({ id, s });
    if (s) document.title = (s.name || '学校档案') + ' · 学校档案 | 陈培胜';
    if (typeof window !== 'undefined' && window.AssetURL) {
      /* 资产重写：SchoolPanel 首渲染后补一次（图片走 CDN） */
      window.AssetURL.rewriteDOM(document.getElementById('spPageBody') ?? undefined);
    }
  }, []);

  if (visit.s) return <SchoolPanel raw={visit.s} schoolId={visit.s.id} />;

  const all = listSchools();
  return (
    <>
      <p className="sp-list-note">
        {visit.id
          ? `没有找到「${visit.id}」的档案，以下是全部学校档案：`
          : '选择一所学校查看完整档案：'}
      </p>
      <div className="sp-list">
        {all.map((x) => (
          <a key={x.id} className="sp-list-card" href={'?c=' + encodeURIComponent(x.id || '')}>
            <span className="sp-list-name">{x.name}</span>
            <span className="sp-list-ind">{x.degree || ''} · {x.major || ''}</span>
            <span className="sp-list-oneline">{x.period || ''}</span>
            <span className="sp-list-go">查看档案 →</span>
          </a>
        ))}
      </div>
    </>
  );
}
