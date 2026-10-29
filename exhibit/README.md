# Collective 静态展示

先运行 `npm ci`；`npm test` 执行现有 63 项测试。构建固定 `SITE_BASE=./`，采用 `codex/m3-attention-calibration-fix` 源码，不编辑 Pages 发布脚本。

在仓库根目录执行 `python3 exhibit/build.py`，产物为 `exhibit-dist/`，网站路径 `/demo/focus-hiking/`。输出只依赖相对资源地址；双击 file:// 不能替代静态服务器测试。

构建器按运行目录清单组装，不重新生成模型或动画，拒绝未解析的 LFS 指针，排除源码映射和内部制作文件。每次输出带 `release-manifest.json`，逐项记录 SHA-256、体积、源提交和工作区状态。前次输出保存在本项目 `temp/builds/`，审阅完成前保留，不自动清理原始材料。

作者、原始提交与素材许可见 `ATTRIBUTION.md`、`exhibit/provenance.json` 和公开的 `exhibit/about.html`。本次没有替原项目新增开源许可证。

独立页面添加返回 Collective、来源说明、暂停与手动继续；后台暂停持续渲染与音频。山间体验同时释放摄像头，继续时重新进入准备流程。主页卡片不预取这些资源。

2026-10-29 本地浏览器检查已完成，正式发布尚未授权。整批证据保存在官网 `docs/verification/2026-10-29-collective.md` 和本地审阅包，真实设备与摄像头实测单独验收。部署流程要求源仓干净且 HEAD 已推送到 BAP-CAMP；不能把本地 dirty 构建当成已发布版本。
