# 万界系统管理局（System Flow）0.1.3

面向 SillyTavern 1.19.x 的独立 UI 扩展。提供多系统选择、自定义系统、任务、角色属性、积分、商城、背包和 AI 操作提议确认。

## 安装

1. 确保 GitHub 仓库是公开仓库，并在仓库根目录包含 `manifest.json`。
2. 在 SillyTavern 的「扩展」面板粘贴仓库 URL 安装。
3. 安装完成后刷新或重启 SillyTavern，确认「扩展」列表中出现「万界系统管理局（System Flow）」。
4. 打开任意聊天，聊天界面右下角会出现画笔悬浮按钮；再次点击按钮可关闭面板。

也可将整个仓库目录手动放入 `data/<用户目录>/extensions/`。`manifest.json`、`index.js` 和 `style.css` 必须直接位于该仓库目录根部，不能再套一层同名目录。

如果安装时提示目录已存在，但扩展列表没有名称，说明 `data/<用户目录>/extensions/<仓库名>/` 是残留目录。先备份其中的自定义文件，再删除该残留目录后重新安装；不要清理聊天数据、IndexedDB 或浏览器存储。

## 功能

- 预置系统选择、同时运行多个系统、随机抽取一个或两个系统。
- 自定义系统名称、规则描述和商城开关。
- 简单/正常/地狱级商城价格倍率。
- 每个聊天独立保存积分、属性点、角色资料、任务、商城商品、背包和日志。
- 任务进度、完成奖励、属性点加点、商城购买和积分扣除。
- 将当前系统状态注入 AI 上下文；识别 `<SF_ACTION>...</SF_ACTION>` 提议，并在用户确认后执行。
- 画笔悬浮入口、独立弹窗、移动端适配及蓝色赛博界面。

## AI 操作提议格式

```xml
<SF_ACTION>
{"type":"task_create","title":"找到旅店","description":"在天黑前找到落脚处","reward":{"currency":30,"attributePoints":1}}
</SF_ACTION>
```

支持 `task_create`、`task_progress`、`task_complete`、`event_notice`、`unlock_shop`。每次最多一个操作提议，必须在面板中确认。任务完成操作要求进度达到 100%。

## 0.1.3 更新

- 按 SillyTavern 1.19.x 源码修正 `MESSAGE_RECEIVED` 参数处理；事件传入的是消息索引，不再误当消息对象。
- 初始化、事件注册和挂件挂载改为幂等，避免切换聊天或重复初始化产生多个入口与监听器。
- 画笔按钮支持再次点击关闭；保留关闭按钮、遮罩和 Esc 关闭。
- 聊天标识变化时保留当前 `chatMetadata` 存档，避免聊天重命名导致数据被默认状态覆盖。
- CSS 全部限定在 `#system-flow-root` 下，避免污染酒馆或其他扩展的同名类。
- 修正 manifest 的 `homePage` 字段，声明 `minimum_client_version` 为 `1.19.0`。
- 已完成 JavaScript 语法、manifest JSON、入口路径和 CSS 作用域静态检查；尚未在真实 SillyTavern 1.19.x 浏览器会话中实机验证。

## 注意事项

- 这是可运行原型，不是正式稳定版；请先在测试聊天中验证。
- 切换聊天时，插件会读取该聊天自己的元数据存档。请勿手动复制不同聊天的 `system_flow_v1` 元数据。
- 删除聊天或清理聊天元数据可能导致对应存档丢失，重要进度请定期备份聊天。
- 商品效果、BUFF 持续时间、库存系统、套装、跨系统联动、完整回滚和导入导出尚未实现。
- 若悬浮按钮仍未出现，请提供 SillyTavern 版本及浏览器控制台报错，以便进一步适配。

## 仓库

https://github.com/jojodamuda-cloud/system
