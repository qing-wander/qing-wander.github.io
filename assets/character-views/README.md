# 个人形象 · 混元 3D 多视图素材

同一角色（5.5 头身，黑短发 / 黑框方眼镜 / 橙色连帽卫衣 / 米白长裤 / 黑面白底鞋）的独立多视图，
用于上传 **腾讯混元 3D Studio（3d.hunyuan.tencent.com）→ 添加多视图** 生成 3D 模型。

## 槽位对应（按弹窗布局）

| 混元槽位 | 文件 | 尺寸 |
|---|---|---|
| 上传顶图 | `top.png` | 1536×1536 |
| 上传左45°图 | `left45.png` | 1254×1881 |
| 上传正图 *（必填） | `front.png` | 1254×1881 |
| 上传右45°图 | `right45.png` | 1254×1881 |
| 上传左图 | `left.png` | 1254×1881 |
| 上传右图 | `right.png` | 1254×1881 |
| 上传背图 | `back.png` | 1254×1881 |
| 上传底图 | `bottom.png` | 1536×1536 |

- 生成时间：2026-11-19，seedream_5.5，以本人立绘为母版逐张参考生成；灰底、无文字、无投影。
- `bottom.png` 是纯仰视透视（鞋底占比大），若混元解析不佳可留空该槽位。
- 母版立绘（手插兜版）在用户剪贴板历史，正式版参考 `front.png` 即可。

## 重要提醒（来自上一轮制作经验，详见 docs/pet-self3d-pipeline.md）

1. 本组视图是**双臂自然下垂**姿势。混元图生 3D 可用；但后续 **Mixamo 自动绑骨必须用 T-pose**
   （双臂平举）版本，届时需另生成 T-pose 立绘再走一遍图生。
2. 混元输出为单层开口曲面（non-watertight），绑骨前需 trimesh 体素水密化
   （`voxelized(pitch=0.013).fill().marching_cubes`）。
3. 混元 GLB 免费下载；下载按钮在视口外时，从 `performance.getEntriesByType('resource')`
   捞 `hunyuan3d/default/*.glb?q-sign-algorithm=...` 签名直链现抓现下（有时效）。
