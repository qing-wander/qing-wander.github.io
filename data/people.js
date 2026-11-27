/* 本文件由 data/people.json 自动生成，请勿手动编辑。
   生成方式：python3 scripts/sync_people.py
   作用：页脚「推荐的人」只有一份名单，避免 JSON / JS 两份数据漂移。 */
window.PEOPLE = {
  "meta": {
    "_note": "页脚「推荐的人」名单。只收录本人知情并同意展示的人；每条必须有具体推荐理由（不能只写名字）。改完运行 python3 scripts/sync_people.py 重建快照。注意 .fp-reason 是单行省略，理由的前 14 字要带出最强看点，全文靠 hover/title 呈现；名单为空时该模块自动隐藏。",
    "limit": 24,
    "footerCount": 4,
    "example": {
      "name": "示例：李某某",
      "role": "AI 产品经理 · 某公司",
      "site": "https://example.com",
      "initial": "L",
      "reason": "一起做过 Agent 落地，他对提示词工程的拆解很值得看",
      "tags": [
        "Agent",
        "RAG"
      ]
    }
  },
  "people": []
};
