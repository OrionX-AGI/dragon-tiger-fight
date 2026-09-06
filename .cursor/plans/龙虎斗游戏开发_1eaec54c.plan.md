---
name: 龙虎斗游戏开发
overview: 用 Vite + React + TypeScript 开发网页版龙虎斗（先纸牌玩法后棋盘玩法，均支持同屏热座与人机对战），牌面采用 AI 生成的国风插画，最终打包为 Windows 桌面程序。
todos:
  - id: scaffold-core
    content: 搭建 Vite+React+TS 工程，实现核心规则引擎与状态机，配套单元测试
    status: completed
  - id: art-assets
    content: AI 生成国风牌面插画（16 张角色 + 牌背 + 棋盘底纹）
    status: completed
  - id: card-game
    content: 实现纸牌玩法：对局界面、热座模式、三档难度 AI
    status: completed
  - id: board-game
    content: 实现棋盘玩法：4×4 翻棋界面、非法着法拦截、热座与 AI
    status: completed
  - id: polish-package
    content: 游戏大厅、规则页、整体打磨，Tauri 打包 Windows 桌面程序
    status: completed
isProject: false
---

# 龙虎斗游戏实现方案

## 技术选型

- **前端**：Vite + React + TypeScript，界面元素（棋盘、格子、按钮）用 SVG/CSS 程序绘制
- **核心逻辑**：纯 TypeScript 模块，与界面完全解耦，用 Vitest 做规则自动化测试
- **美术**：16 张牌面 + 牌背 + 棋盘底纹由 AI 生成国风手绘插画
- **后端**：当前阶段无需后端（热座与人机均为纯前端）；在线联机为远期可选项（届时加 Node + WebSocket 服务）
- **桌面打包**：最后用 Tauri 将网页版打包为 Windows 程序

## 项目结构

```
DesktopGameCenter/
├── 龙虎斗游戏规则说明书.md      (已完成)
├── src/
│   ├── core/                  纯逻辑，无界面依赖
│   │   ├── types.ts           阵营、牌、动作等类型定义
│   │   ├── rules.ts           克制关系引擎（吃/被吃/同尽判定）
│   │   ├── cardGame.ts        纸牌玩法状态机
│   │   └── boardGame.ts       棋盘玩法状态机（翻/走/吃、禁循环、和局计数、困毙）
│   ├── ai/
│   │   ├── cardAI.ts          纸牌AI：基于剩余手牌的加权混合策略，三档难度
│   │   └── boardAI.ts         棋盘AI：期望极小极大搜索 + 估值函数，三档难度
│   ├── themes/
│   │   └── longhu.ts          主题包：牌名与图片映射（规则只认阵营+编号，皮肤可扩展）
│   ├── ui/
│   │   ├── Lobby.tsx          游戏中心大厅（选玩法、选模式、选难度）
│   │   ├── CardGame/          纸牌对局界面（选牌、扣牌、同时翻开、结算动画）
│   │   ├── BoardGame/         棋盘对局界面（4×4棋盘、合法着法高亮、非法拦截提示）
│   │   └── Rules.tsx          游戏内规则查看页
│   └── core/__tests__/        规则单元测试（穷举克制表、禁循环、胜负判定）
└── public/assets/             AI 生成的国风牌面图片
```

## 关键设计

- **规则与皮肤分离**：牌在引擎中只有 `{faction, rank}` 两个属性，名称（龙王/虎王等）与插画全部来自主题包，未来加动物皮肤零逻辑改动
- **状态机对外接口统一**：`getLegalActions(state)` / `applyAction(state, action)` / `getOutcome(state)`，热座、人机、未来联机共用同一接口
- **电子版规则自动执行**：非法着法（1 吃 8、吃暗牌、第 3 次往返）直接不可点选并提示；纸牌出牌双方提交前互不可见
- **AI 难度**：简单（随机偏好）、普通（启发式）、困难（纸牌用博弈混合策略、棋盘用深度搜索）

## 实施顺序（分五步交付，每步结束都有可运行版本）

1. 工程搭建 + 核心规则引擎 + 单元测试
2. 生成国风美术资源（16 牌面 + 牌背 + 棋盘底纹）
3. 纸牌玩法：热座 + 人机（首个完整可玩版本）
4. 棋盘玩法：热座 + 人机
5. 大厅与整体打磨，最后 Tauri 打包 Windows 桌面程序

## 需要你提供的

无需提供任何素材。每步交付后请试玩并反馈（尤其美术风格在第 2 步生成后先过目再继续）。