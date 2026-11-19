# 个人形象 3D 桌宠 · 制作流水线与现状（交接文档）

> **文档定位**：本文件是「右下角 AI 助手角色 = 个人形象 3D（`self3d`）」的**制作过程 + 技术参数 + 当前状态 + 后续优化交接**的单一依据。
>
> 阅读顺序建议：先看 §0 现状表 → §6 当前状态 → §8 后续优化清单（接手者从这里开始）。
>
> 版本：v1（2026-11-19）· 状态：**已上线，皮肤已收敛为仅此一款** · 作者：陈培胜（AI 协作）
>
> 姊妹文档：`docs/ai-avatar-skins.md`（皮肤系统架构、9 款皮肤的历史演进——现已收敛）、`docs/ai-assistant-survey.md`（问答后端 RAG）

---

## 0. 一句话现状

角色是**真 3D 模型 + 真骨骼动画**（不是切图、不是 CSS 伪动画）：45k 面 / 2.8MB 的 GLB，41 根骨骼，含 **Idle（呼吸待机）/ Wave（挥手）/ Sit（盘腿坐）/ Lay（躺平，已备好但暂不启用）** 四段 Mixamo 真实动作。首访落地先挥手 → 待机 → 10 秒后盘腿坐；点击会再挥一次手。站点皮肤清单只保留这一款，其余 11 款已删除。

| 项目 | 值 |
|---|---|
| 线上 | `https://shenge-work.pages.dev`、`https://shenge-work.github.io` |
| 模型 | `assets/skins/models/PetSelfRigged.glb`（2,782,672 B ≈ 2.8MB） |
| 代码 | `js/ai-skins.js`（`SKINS` 数组 + `create3D()` + `seq` 状态机） |
| 默认皮肤 | `self3d`（唯一） |
| 渲染 | `<model-viewer>` Web Component（`assets/skins/vendor/model-viewer.min.js`，956KB，离线） |
| 关键提交 | `c7775ab` 静态版 → `9911d35` 三动作 → `9d4b3c4` 修脚 → `af2499f` 权重掩码 → `8304507` 四动作 → `1a54bd9` 关闭躺平 → `62339a6` 单皮肤 |

---

## 1. 需求演进（为什么要这么做）

角色最初只是「一张好看的 3D 人物/宠物」。最终落点是**本人形象**，因为用户反复否决了所有现成人形与宠物：

1. `three.js` 官方示例人形 → 嫌不好看；
2. 换成动物/宠物 → 嫌不好看；
3. 程序化「纸质档案精灵」→ 嫌还原度差；
4. AI 生成立绘推全身 → 嫌「5.5 头身偏高」，要更矮；再要求「不要 Q 版，完美复原」；
5. 结论：**唯一能被接受的形象 = 本人头像的写实全身 3D**，于是走「头像 → 立绘 → 图生 3D → 自动绑骨」的路线。

审美约束（接手者务必遵守，别再走回头路）：
- **不要 Q 版、不要 7 头身、不要纸片/切图**；
- 身形要比主页头像推出来的再矮一点（放到 184×216 的舞台里不违和）；
- 动作要「丝滑」，姿势要「对」（脚不能歪、膝盖不能撕裂）；
- 所有付费导出的平台一律不用。

---

## 2. 平台选型（试过的都在这，别再重复踩）

| 平台 | 结论 | 原因 |
|---|---|---|
| **腾讯混元 3D**（`3d.hunyuan.tencent.com`） | ✅ **唯一采用** | 图生 3D 质量最好，**GLB 免费导出** |
| Tripo 3D Studio | ❌ | 建模质量好，但导出弹订阅墙 |
| SupaVoxel / 3daistudio.pro / Hi3D / photo3d.org | ❌ | 导出跳 Stripe 结账 |
| HuggingFace Spaces（image-to-3D 系列） | ❌ | 后端失效或 ZeroGPU 限额拦住 |
| **Mixamo**（`mixamo.com`） | ✅ 采用 | 免费自动绑骨 + 免费动作库，**只出 FBX**（需 Adobe 登录，本项目已用 Google 账号登录） |
| Blender 4.2.9 | ✅ 采用 | 权重转移、脚部姿态修正、glTF 导出（`/tmp/blender.dmg` 挂载后 `--background --python`） |
| gltf-transform CLI | ✅ 采用 | `optimize --texture-size 512 --compress quantize`，4.05MB → 2.78MB |

---

## 3. 制作流水线（5 步，可完整复现）

### 步骤 1：把主页头像推成全身立绘

- 输入：主页 `PHOTO NO.001` 头像（戴眼镜、橙色卫衣）。
- 产出：写实风全身立绘（灰底，竖版 1330×1773 与方形 1536×1536 两版），后再改成 **T-pose** 版本（Mixamo 与图生 3D 都要求 T-pose）。
- 坑：**手插兜的姿势不是 T/A-pose**，前两次 Auto-Rig 都因此超时失败。

### 步骤 2：混元 3D 图生

- 输入方形 T-pose 立绘 → 输出 1.5M 面 / 78MB 的 GLB（尺度 ±17446，量化后会错，**不要 `--compress quantize`，用 `--compress false`**）。
- 坑：混元的下载按钮在视口外。稳定解法是从 `performance.getEntriesByType('resource')` 里捞 `hunyuan3d/default/*.glb?q-sign-algorithm=...` 的签名直链，本机 `curl` 现抓现下（签名有时效）。

### 步骤 3：水密化（Mixamo 绑骨的前置条件）

- 混元输出的模型是**单层开口曲面（non-watertight）**，Mixamo Auto-Rig 无法识别关节。
- 用 trimesh 体素重塑：`voxelized(pitch=0.013).fill().marching_cubes` → **20,060 面水密网格** `pet-tpose3.obj`。
- 结果：Mixamo Auto-Rigging 成功，角色名 **`PET-TPOSE3`（41 根骨骼）**，此后可无限复用下载任意动作。

### 步骤 4：Mixamo 下载动作（FBX）

| 动作 | Mixamo 搜索/卡位 | 文件 | 帧数 |
|---|---|---|---|
| Idle | `Breathing Idle` | `Breathing Idle.fbx` | 299（9.97s） |
| Wave | `Waving` | `Waving.fbx` | 17 |
| Sit | `Sitting Idle` 结果**第 2 张**（盘腿坐地） | `Sitting Idle.fbx` | 327 |
| Lay | `Sitting Idle` 结果**第 4 张**（躺卧） | `Sitting Idle(1).fbx` | 309 |

操作要点（视口 842×884 时，`click_xy` 用 **0–1000 归一化**坐标）：
- 结果卡列两列，行距约 200px；第 4 张（躺卧）落在 **(368, 532)**；
- 下载弹窗：Format=FBX Binary / Skin=With Skin / 30fps / Keyframe Reduction=none，`DOWNLOAD` 在 **(820, 404)**（点到 (820,361) 会命中 Skin 框、不产出文件）；
- 首次点开某张卡后，`:xxx` 标题会变成 `SITTING IDLE ON PET-TPOSE3`。

### 步骤 5：Blender 合并 + 权重转移 + 修脚 + 导出

脚本已归档到 `tools/character-pipeline/`：

```
rig_merge2.py   # 导入 FBX → 高模对齐 → 权重转移 → 左右侧掩码 → 导出 ACTIONS
sit_tune3.py    # 修 Sit 双脚朝向（以 Idle 帧为参考）+ 渲染证据；--save 存工程
export_final.py # 从 merged_sit.blend 导出 raw glb
```

核心参数：
- 骨架 `scale=(100,100,100)`（Mixamo FBX 是厘米单位）；
- bbox 高度/中心/脚底对齐后，用 `mathutils.kdtree` 做 **K=16 邻域反距离混合**权重 → **沿网格边 5 轮平滑** → **只保留前 4 个影响**；
- **左右侧肢体掩码**：顶点 x<1.0 禁止接收 `Right*` 骨骼、x>1.0 禁止接收 `Left*`，仅限名称含 `UpLeg/Leg/Foot/ToeBase/Toe_End/Arm/ForeArm/Hand/Shoulder` 的四肢骨，掩码后重新归一化；
- 导出 `export_scene.gltf(export_animation_mode='ACTIONS')`，四个 action 名 `Idle / Wave / Sit / Lay`；
- 压缩：`npx -y @gltf-transform/cli@latest optimize in.glb out.glb --texture-size 512 --compress quantize`。

**姿势修正的关键技巧**（`sit_tune3.py`）：
- 脚歪不是权重问题，是 Mixamo 该动作本身脚踝外翻 → 取**站立 Idle 帧的脚掌世界朝向**作参考，把 Sit 的 `LeftFoot/RightFoot` 世界旋转改成该朝向；
- **改完必须立刻 `keyframe_insert`**：直接改 `pb.matrix` 会被动画求值覆盖，`frame_set` 之后再读才是新值。

---

## 4. 骨架与动作清单（模型内实际内容）

| Clip | 用途 | 备注 |
|---|---|---|
| `Idle` | 待机呼吸 / 思考 / 回答时 | 循环播放，配 CSS `ai-mv-bob` 轻微上下浮动（仅站立态） |
| `Wave` | 首访打招呼、点击 | 一次播放，`finished` 事件后按 `restMode` 回位 |
| `Sit` | 待机 10 秒后自动盘腿坐地 | 双脚已修正为平贴地面、脚尖朝前 |
| `Lay` | 躺卧 | **已备好，`seq` 中未挂载，暂不启用** |

已知限制（交接者需要知道）：
- `Sit` 是 Mixamo 的**单侧折腿**坐姿，不是严格对称正盘腿；184×216 舞台下差别很小，要严格对称需手工摆髋/膝/踝（`merged_sit.blend` 可复用）。
- 模型**没有面部骨骼/形态键**：眼镜、表情都烘焙在贴图里，暂无眨眼与口型（早期 2D 版有眨眼，3D 版没有）。

---

## 5. 站点接入（代码位置）

`js/ai-skins.js`：

| 位置 | 内容 |
|---|---|
| `BASE = 'assets/skins/'` | 资源根（约 15 行） |
| `ensureModelViewer()` / `MV_URL` | 动态 import 本地 `model-viewer.min.js`（约 160 行） |
| `create3D(cfg, host, state)` | 3D 皮肤工厂，从 178 行起；`animation-crossfade-duration` 在 199 行按 `cfg.seq` 取 **620ms**（无 seq 时 280ms） |
| `finished` 监听（217–223 行） | 一次性动作播完 → 按 `restMode` 回 `Lay` / `Sit` / `Idle` |
| `cfg.seq` 状态机（230 行起） | `playClip / clearSit / toIdle / toSit / toLay / oneShot / applySeq / intro` |
| `setView(mode)` | 躺卧需要 `orientation='0deg 0deg 90deg'` + `camera-orbit='0deg 78deg 200%'`；站立恢复 `cfg.orbit` |
| `SKINS` 数组（535 行起） | **现只有一条 `self3d`**，`key='1'` |
| 菜单 | `SKINS.length < 2` 时自动隐藏 ◈ 换肤按钮、`openMenu()` 直接 return |

`self3d` 当前配置：

```js
{
  id: 'self3d', key: '1', name: '个人形象 3D',
  create: create3D({
    file: 'PetSelfRigged.glb',
    orbit: '0deg 78deg 150%', fov: '32deg', rotate: null, bob: true,
    clips: { idle: 'Idle', thinking: 'Idle', answer: 'Idle', greet: 'Wave', click: 'Wave' },
    seq:   { intro: 'Wave', sit: 'Sit', sitAfter: 10000 },
    hold: 2600
  })
}
```

舞台尺寸：184×216（`css/ai-skins.css` 中 `.ai-mv` / `.ai-stage`）。
`setState(s)` 契约：`s ∈ idle | thinking | answer | greet | click`。

---

## 6. 当前状态（2026-11-19）

**已做完并上线**
- 真 3D + 真骨骼；三段动作接入（Idle/Wave/Sit），四段动作已烘焙在模型内；
- 坐姿双脚平贴、膝盖无撕裂；动作切换 crossfade 620ms（不再硬切）；
- 首访落地挥手 → 待机 → 10 秒盘腿坐；点击再挥手；
- 皮肤收敛为单一 `self3d`，换肤入口隐藏，旧访客 localStorage 里的旧 id 自动回落；
- 删除其余 11 款皮肤及其专属资源（`generated.png` / `pet-self.png` / `preview.png` / `Robot-archive.glb` / `PaperBot.glb` / `PetSelf.glb`）；
- Cloudflare 与 GitHub Pages 双线一致（`ai-skins.js?v=20261119L`）。

**已备好但未启用**
- `Lay` 躺平动作（取景方案已验证：`orientation='0deg 0deg 90deg'` + `camera-orbit='0deg 78deg 200%'`，整身入画）；启用只需在 `seq` 加回 `lay: 'Lay', layAfter: 12000`。

**未做**
- 眨眼 / 口型（无面部骨骼）；
- 对称正盘腿；
- LOD 与按需加载（2.8MB 对首屏仍偏重，目前是 `loading="eager"`）。

---

## 7. 复现与验收命令

```bash
# 合并（需先 hdiutil attach /tmp/blender.dmg，或用已安装的 Blender）
/Volumes/Blender/Blender.app/Contents/MacOS/Blender --background --python tools/character-pipeline/rig_merge2.py

# 修坐姿脚掌 + 存工程
/Volumes/Blender/Blender.app/Contents/MacOS/Blender --background --python tools/character-pipeline/sit_tune3.py -- /tmp/f.png /tmp/s.png --save

# 导出 raw glb
/Volumes/Blender/Blender.app/Contents/MacOS/Blender --background --python tools/character-pipeline/export_final.py

# 压缩
npx -y @gltf-transform/cli@latest optimize PetSelfRigged_raw.glb PetSelfRigged.glb --texture-size 512 --compress quantize

# 本地预览（仓库根）
python3 -m http.server 8766    # 打开 http://127.0.0.1:8766/index.html
```

**验收要点（必须用真实时间等，不要用 `--virtual-time-budget`，它会加速 setTimeout 导致 10s 定时器被提前触发）**：
- 加载后先挥手（`class` 含 `ai-mv`，`animationName` 走 `Wave`）；
- 约 10s 后进入坐姿（`document.querySelector('model-viewer').className` 含 `ai-mv-sit`）；
- 点击角色 → 打开 AI 面板 + 再挥手 → 回位；
- 无 `ai-mv-lay` 出现（躺平当前关闭）。

无头单帧截图模板（仅看姿态，不看时序）：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-sandbox \
  --enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader \
  --user-data-dir=/tmp/fresh --window-size=200,232 --virtual-time-budget=12000 \
  --screenshot=out.png URL
```

---

## 8. 后续优化清单（给接手的模型，按优先级）

**P0 · 一眼可见的质感**
1. **眨眼**：无面部骨骼，最稳的做法是两套贴图（睁眼/闭眼）按随机间隔切换 UV 或 material map，或给头部加形态键（需回 Blender 加 shape key 再导出）。
2. **口型**：语音播报已在用（`docs/ai-voice-survey.md`），可做「滚动嘴部贴图」或下颌小骨骼，配合 `speechSynthesis` 的边界事件。
3. **首屏体积**：2.8MB → 目标 ≤1.2MB（减面到 20–25k、贴图 256、`meshopt` 压缩），并改 `loading="lazy"` 或首帧 poster，避免拖慢首屏。

**P1 · 姿态与动作**
4. **对称正盘腿**：在 Blender 手工摆髋/膝/踝（`merged_sit.blend` 起步），或换 Mixamo 里双手合十的 `Sitting Cross Legged`。
5. **启用躺平**：`seq` 加 `lay: 'Lay', layAfter: 12000`，并确认点击后能回落到 `lay`（`restMode==='lay'` 分支已实现）。
6. **加点微动作**：站立时的头部微转/呼吸相位随机化，避免「循环感」。
7. **坐→站过渡**：目前是 crossfade 硬过渡，加一段 `StandUp` 短动作会更自然。

**P2 · 表现力**
8. **接触阴影**：`shadow-intensity` 目前为 0，加柔和落地阴影能提升「站在页面上」的实感。
9. **鼠标跟随**：站立时让模型轻微转向鼠标（`camera-orbit` 微调），提升陪伴感。

---

## 9. 文件清单与授权

| 路径 | 说明 |
|---|---|
| `assets/skins/models/PetSelfRigged.glb` | 四动作成品（2.8MB） |
| `assets/skins/models/RobotExpressive.glb` / `Fox.glb` / `Xbot*.glb` / `Michelle.glb` / `Soldier.glb` | 仅 `assets/skins/pet-lab.html`（模型实验室页）与 docs 引用，**皮肤系统已不再加载**；确认无用后可整目录删除 |
| `assets/skins/vendor/model-viewer.min.js` | `<model-viewer>` 本体（离线） |
| `tools/character-pipeline/*.py` | 本轮三个 Blender 脚本（从 `/tmp` 归档，避免重启丢失） |
| `docs/pet-self3d-pipeline.md` | 本文件 |

授权与来源：
- **形象**：本人头像衍生，自主版权；
- **3D 生成**：腾讯混元 3D（免费额度，商用需按其条款自查）；
- **骨骼与动作**：Mixamo（Adobe 授权，个人作品集使用没问题；**动作 FBX 不要再分发或打包成素材库**）；
- **渲染**：`<model-viewer>`（Apache-2.0）；
- 原 FBX 存放在本机 `~/Downloads`（`Breathing Idle.fbx` / `Waving.fbx` / `Sitting Idle.fbx` / `Sitting Idle(1).fbx`），不入库，丢失后可用 Mixamo 角色 `PET-TPOSE3` 重下。
