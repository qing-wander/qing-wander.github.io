# Mixamo 自动绑骨 + 动画导出 · 文章沉淀

> 来源：<https://www.hangge.com/blog/cache/detail_5018.html>（hangge，2026-02-06）
> 原文标题：《使用Mixamo实现人物模型骨骼的自动绑定，并生成动画教程（附导入UE中使用）》
> 沉淀目的：给本站 `assets/character-views/model/` 下的人形模型走 Mixamo 绑骨→动画→替换站点 3D 角色提供可复现依据。
> 配套文档：`docs/pet-self3d-pipeline.md`（本站上一轮 PetSelfRigged.glb 的完整实战记录，含踩坑）。

---

## 1. 文章核心结论

Mixamo 是 Adobe 的在线**自动绑骨（Auto Rigging）+ 动画库**平台，免本地装软件：上传模型 → 拖拽参考点 → 自动生成骨骼 → 套用现成动画 → 导出 FBX/DAE。核心价值是**免建骨、免刷权重**，AI 自动完成；动画参数可在线调整。

前置要求（原文强调）：
- 模型最好是 **T-Pose 或 A-Pose**，且是**无骨骼、无动画的裸模型**；
- 上传后模型必须**面朝正前方**，朝向不对用左下角翻转按钮纠正；
- 平台：<https://www.mixamo.com/>，需 Adobe 账号登录。

## 2. 自动绑骨操作流程（原文步骤）

1. 登录 Mixamo → **Upload Character** 上传模型。
2. 确认朝向正前方（必要时翻转）→ **NEXT**。
3. 把参考点拖到模型的**下巴 / 手腕 / 肘部 / 髋部 / 膝盖 / 脚踝**等人体关键位置——这是 Mixamo 判断人体结构的依据 → **Next**。
4. 等待几秒到一分钟，自动生成完整人体骨骼并默认套用一个基础动作；拖拽旋转检查绑定效果，动作自然即成功 → **NEXT**。
5. 点 **DOWNLOAD**，弹窗中选 **FBX** 格式、模型姿势选 **T Pose**，下载得到「角色基础骨骼 + 绑定姿态模型」，例如 `boy.fbx`。
6. 后续可反复复用这个已绑骨角色，下载任意动画，无需重新上传。

## 3. 动画库的用法（原文步骤）

1. 在动画库搜索关键词（如 `idle`），点选卡片即在当前模型上预览；右侧可调动画参数。
2. 满意后点 **DOWNLOAD**，弹窗保持默认设置即可，得到带蒙皮的动画 FBX，如 `boy_idle.fbx`。
3. 可继续搜索其它动作（如 `run`）分别下载，形成「1 个基础骨骼模型 + N 个动画 FBX」的组合。

原文示例的 6 个动画文件：`boy_idle` / `boy_walk` / `boy_run` / `boy_jump` / `boy_falling` / `boy_landing`。

## 4. 原文附录：导入 Unreal Engine 的设置

- **基础模型**：新建角色文件夹拖入 `boy.fbx`，按默认导入配置导入。
- **动画文件**：新建 `boyAnimations` 文件夹拖入其余 FBX，**不勾选「导入网格体」**，**骨骼**指定为前面导入的角色骨骼。
- **Root Motion**：`walk` / `run` 含根位移，需勾选「启用根运动」和「强制根锁定」，避免预览时角色向前跑掉。
- **Additive**：`boy_landing` 可设为 Additive，叠加在走/跑动画上做落地缓冲，而不是打断原动作。

## 5. 与本站流水线的对应关系（不是 UE，是 Web）

本站不走 UE，走 **Mixamo → Blender → GLB → `<model-viewer>`**，桥梁是 `docs/pet-self3d-pipeline.md`：

| 文章环节 | 本站实现 | 备注 |
| --- | --- | --- |
| T/A-Pose 裸模型 | 混元 3D 图生 + trimesh 水密化 | 混元原始输出是开口曲面，必须先 `voxelized(pitch=0.013).fill().marching_cubes` 才能被 Mixamo 识别 |
| 拖参考点 Auto-Rig | `PET-TPOSE3`（41 根骨骼） | 一次绑骨，动画无限复用 |
| FBX / T Pose 下载 | Format=FBX Binary / Skin=With Skin / 30fps / Keyframe Reduction=none | 上一轮实测的下载弹窗参数 |
| 动画库搜索下载 | `Breathing Idle` / `Waving` / `Sitting Idle` | 本站取 `Idle` / `Wave` / `Sit` / `Lay` 四段 |
| UE 导入与 Root Motion | Blender 合并 + 权重转移 + glTF 导出 | Web 端靠 `model-viewer` 播 clip；Root Motion 在本站会表现为模型位移，需在 Blender 里处理/锁定 |
| Additive 落地 | 暂未使用 | 若以后加跳跃可参照文章思路 |

站点接入点：`js/ai-skins.js` 的 `SKINS[0]`（`self3d`）通过 `create3D()` 加载 `assets/skins/models/PetSelfRigged.glb`，动画名映射 `clips: { idle, thinking, answer, greet, click }`，`seq: { intro, sit, sitAfter }`。替换角色时必须让 GLB 内的 `animations[].name` 与这些 key 对齐，或同步改代码。

## 6. 本轮实战结果（新模型 male，2026-11-20 完成替换）

### 6.1 三个关键坑与解法（可复现）

1. **原始 `male.fbx` 直接上传必失败。** 报 `Sorry, unable to map your existing skeleton`。原因不是姿势（渲染确认是标准 T-pose、正面），也不是真有旧骨架（Blender 查只有 1 个 `Mesh_0`、25 万顶点、0 骨骼），而是混元 3D 输出是**单层开口曲面 + 超高面数**，Mixamo 定不了关节。
2. **水密代理必须用 OBJ，不要用 FBX。** 体素水密化（voxel remesh）后导出的 FBX，Mixamo 要么报骨架映射失败、要么视口根本加载不出网格；换成 **OBJ**（`/tmp/male_proxy.obj`，4.3MB / 2 万面）后一次性成功。这与上一轮成功的 `pet-tpose3.obj` 一致。
3. **"灰色/模糊"不是 UV 展开错误。** Mixamo 的 Auto-Rigger 视口在绑骨阶段**不加载贴图**，所有模型（含右侧已绑骨预览、动画缩略图）都以灰色 clay 显示，这是平台机制。体素化确实会丢弃原始 UV/贴图，重新展开的 UV 不烘焙贴图，所以代理是灰的；但 Mixamo 只靠几何认关节，最终权重转回原始 25 万面高模时会接回混元 3D 的完整贴图，成品不糊。

### 6.2 标记点必须手动放对

`Place markers` 步骤若直接用默认位置（挤成窄列、双臂下垂布局），Auto-Rig 会失败并退回该步骤。T-pose 下必须用 **Use Symmetry** 把 5 组标记拖到：下巴 / 两手腕 / 两肘 / 两膝 / 胯部，左右对称分布。放对后一次成功（约 40 秒）。

### 6.3 Blender 导出动画的坑

`export_animation_mode='ACTIONS'` 在本机 Blender 4.2 下若 animation 只是 `use_fake_user` 挂着，会导出**空动画数组**。解法：把每个 action 用 NLA strip 固定帧范围（`arm.animation_data.nla_tracks.new()` + `strips.new()`），再导出；并先把基础 FBX 自带的 action 删除，避免混入一个多余的 base clip。

### 6.4 流水线与产物

- 脚本：`tools/character-pipeline/mixamo_proxy_to_highpoly.py`（权重 KDTree 转移 + 左右肢体掩码 + 边平滑 + NLA 动画合并 + GLB 导出）。
- 转移结果：298,727 / 298,727 顶点全部拿到权重，33 根骨骼，视觉验证 Idle 站立 / Sit 屈膝 / Wave 挥手均自然、无拉伸断裂。
- 下载素材留在 `assets/character-views/model/male/mixamo-downloads/`：`male.fbx`（基础骨架）+ `Idle/Waving/Sitting Idle.fbx`。
- **压缩**：原始导出 51.6MB（贴图占 28.5MB），用 `@gltf-transform/cli` 的 `--compress draco --texture-compress webp` 压到 **1.78MB**，保留 3 动画 + 33 骨骼 + 3 张 WebP 贴图。注意别用 `--compress meshopt`（Blender 插件不支持、兼容性差），`optimize` 默认的 `simplify` 会减面，如需保画质可只用 draco。
- **站点替换**：`assets/skins/models/MaleRigged.glb`（1.6MB），`js/ai-skins.js` 的 `SKINS[0]` 引用改为该文件（`?v=20261120A`）；动画名 Idle/Wave/Sit 与原映射完全对齐，无需改 `clips`/`seq`。旧的 `PetSelfRigged.glb` 已从版本库移除（用户要求旧角色不要了）。

### 6.5 授权

Mixamo 素材可免费用于个人与商业**项目**，但不允许把素材本体作为素材包二次分发；本站作品集使用属正常使用。

## 8. 50K 面数简化流水线（2026-11-20 二次替换，推荐）

上一轮 50 万面高模走的"体素水密化 → 代理 Auto-Rig → 权重回灌高模"是被迫的复杂路径。**直接让混元 3D 导出 5 万面模型即可绕过整条复杂链**，这是本次验证的结论——回答了"50K 能不能省流程"：**能，省掉一大半**。

### 8.1 关键结论

- 混元 3D 的 `面数` 参数选 **50k**（页面右上角模型参数里选），导出的 GLB 自带完整 UV + 3 张贴图，顶点 34,485 / 面 50,000。
- 该模型虽仍是**开口曲面**（17,284 条边界边、非水密），但面数低 + 拓扑规整，**OBJ 上传后 Mixamo 一次 Auto-Rig 成功**——证明上一轮失败的真正门槛是"超高面数 + FBX 格式"，而非"开口曲面必须水密化"。
- **不需要**体素水密化、**不需要**补 UV、**不需要**权重回灌高模。上传的模型本身就是最终模型，Mixamo 下载的 FBX 自带它的完整权重。

### 8.2 简化后的流程

1. 混元 3D 生成 50k 模型 → 下载 `male.glb`。
2. Blender 导入 GLB → 直接 `wm.obj_export` 导出 `/tmp/male50k.obj`（保留 UV/法线，5MB）。**确认 T-pose、正面朝向**（渲染或看 bbox：Z 高 ~1.14m、双臂展开 X±0.53）。
3. Mixamo → Upload Character → 选该 OBJ → 确认朝向 → 放 5 组对称标记点 → Auto-Rig（约 40 秒一次成功）。
4. 下载基础骨架 + Idle / Wave / Sit 三段动画（Download 设置同 6.1，FBX Binary / With Skin / 30fps / none）。
   - **Wave 选双臂举高挥手**：搜索 `waving`，第 3 个卡片（双臂过头）；第 2 个是单臂挥手，别选错。
   - **Sit 是休闲盘腿坐**：搜索 `Sitting Idle`，第 2 个卡片（一腿盘起、一腿屈膝立起，能看到鞋底）；`cross legged` 搜出来的是单膝立起坐姿，不是双盘腿。
5. 用同一脚本 `mixamo_proxy_to_highpoly.py` 转换，但 `--base` 用带骨骼的动画 FBX（如 `Idle.fbx`）、`--high` 用 50k 原始 GLB。同模型对齐，KDTree 权重转移 34,485/34,485 全部命中，41 根骨骼。
6. `npx @gltf-transform/cli optimize --compress draco --texture-compress webp` → **0.87MB**（比上一轮 1.6MB 还小），保留 3 动画 + 41 骨骼 + 3 张 WebP 贴图。
7. 替换 `assets/skins/models/MaleRigged.glb`，`js/ai-skins.js` 的 `SKINS[0].file` 版本号递增（`?v=20261120B`），动画名 Idle/Wave/Sit 无需改映射。

### 8.3 验证要点（WebGL 截图受限时的替代法）

自动化浏览器抓不到 WebGL 画布，别靠截图判断模型朝向。用 Blender 读 GLB 骨骼**世界坐标**：`arm.matrix_world @ arm.pose.bones['mixamorig:Head'].head`。
- 站立：Head Z≈94、Foot Z≈9；坐下：Head Z≈39（明显下降）。
- 坐姿细节看髋/膝/踝：盘腿坐时膝盖 Z 抬高（~23）、脚收在身体前方，属正常，不是权重错误。
- 注意 `bone.head_local` 是本地坐标（不含 armature object 的 90° X 旋转），会误判躺倒；必须用世界坐标。

### 8.4 本轮产物

- 源模型：`assets/character-views/model/male/male50k.glb`（29MB，50k 原始）。
- 中间：`MaleRigged50K_raw.glb`（31MB）、`MaleRigged50K_opt.glb`（0.87MB 成品）。
- 动画素材：`assets/character-views/model/male/mixamo-downloads/` 下的 `Idle.fbx`（Breathing Idle）/ `Wave.fbx`（双臂挥手）/ `Sit.fbx`（盘腿坐）。
- 站点成品：`assets/skins/models/MaleRigged.glb`（0.87MB）。

## 7. 原文关键术语速查

`Auto Rigging` · `T Pose / A Pose` · `NEXT` · `DOWNLOAD` · `FBX Binary` · `With Skin` · `Keyframe Reduction` · `Root Motion` · `Enable Root Motion` · `Force Root Lock` · `Additive`
