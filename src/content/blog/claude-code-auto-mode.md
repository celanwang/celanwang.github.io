---
title: "Claude Code Auto Mode：AI 编程的自动化新范式"
description: "介绍 Claude Code Auto mode 的官方机制与限制：分类器预审工具调用，被判定安全的操作自动执行，但风险并未消除；作者另就减少人工干预和沙盒隔离提出看法。"
pubDate: 2026-04-27
updatedDate: 2026-04-28
tags: [AI, Claude, 工具]
featured: false
---
**Auto mode provides a safer long-running alternative to --dangerously-skip-permissions. 自动模式提供了更安全的长期运行替代方案。**

## 前置说明

Today, we're introducing auto mode, a new permissions mode in Claude Code where Claude makes permission decisions on your behalf, with safeguards monitoring actions before they run. It's available now as a research preview on the Team plan, and coming to the Enterprise plan and API users in the coming days.

> 今天，我们引入了自动模式，这是 Claude Code 中的一种新的权限模式，Claude 可以代表你做出权限决策，并在操作运行前监控安全措施。它现在作为 Team 计划的研究预览版发布，未来几天将推向企业计划和 API 用户。

通过这种自动化模型的引入，代表着我们作为服务的开发者或者是大模型的使用者，交给大模型的使用权限越来越高，也就是我们越来越倾向于Auto的全AI Model掌管的模式。

不再过多的希望在整个AI Coding的过程中存在人工方式的过多干预。

## 工作原理

Claude Code's default permissions are purposefully conservative: every file write and bash command asks for approval. It’s a safe default, but it means you can't kick off a large task and walk away, since Claude will request frequent human approvals along the way. While some developers choose to bypass permission checks with --dangerously-skip-permissions, skipping permissions can result in dangerous and destructive outcomes and should not be used outside of isolated environments.

> Claude Code 的默认权限故意保守：每个文件写入和 bash 命令都会请求批准。这是安全的默认设置，但意味着你不能启动一个大任务然后离开，因为克劳德会在过程中频繁请求人工批准。虽然有些开发者选择通过“危险地跳权限”来绕过权限检查，但跳过权限可能导致危险和破坏性后果，不应在孤立环境之外使用。

Auto mode is a middle path that lets you run longer tasks with fewer interruptions while introducing less risk than skipping all permissions. Before each tool call runs, a classifier reviews it to [check for potentially destructive actions](https://code.claude.com/docs/en/permission-modes?utm_source=alphasignal&utm_campaign=2026-03-25&lid=ufBUuts5fBfpOfWP#what-the-classifier-blocks-by-default) like mass deleting files, sensitive data exfiltration, or malicious code execution.

> 自动模式是一种中间路线，允许你以更少的中断完成更长时间的任务，同时比跳过所有权限带来的风险更低。每次工具调用前，分类器都会审查， [检查是否有可能造成破坏性的行为](https://code.claude.com/docs/en/permission-modes?utm_source=alphasignal&utm_campaign=2026-03-25&lid=ufBUuts5fBfpOfWP#what-the-classifier-blocks-by-default) ，如大规模删除文件、敏感数据泄露或恶意代码执行。

Actions that the classifier deems as safe proceed automatically, and risky ones get blocked, redirecting Claude to take a different approach. If Claude insists on taking actions that are continually blocked, it will eventually trigger a permission prompt to the user.

> 分类器认定安全的行为会自动进行，冒险行为会被屏蔽，促使克劳德采取不同的方法。如果 Claude 坚持执行被持续屏蔽的操作，最终会触发用户的权限提示。

## 期待内容

Auto mode reduces risk compared to --dangerously-skip-permissions but doesn't eliminate it entirely, and we continue to recommend using it in isolated environments. The classifier may still allow some risky actions: for example, if user intent is ambiguous, or if Claude doesn't have enough context about your environment to know an action might create additional risk. It may also occasionally block benign actions. We’ll continue to improve the experience over time.

> 自动模式相比危险的跳权限模式降低了风险，但并不能完全消除，我们仍建议在孤立环境中使用。分类器可能仍允许一些风险操作：例如，如果用户意图模糊，或者 Claude 对你的环境缺乏足够的上下文，无法知道某个动作可能带来额外风险。有时也可能阻断无害的行为。我们会随着时间不断提升体验。

这个自动模式的实现思路可以参考OpenClaw的模式，因为自动模式的人工介入干预的环节变得越来越少，所以对于核心代码链路存在风险也是不可避免的。

因此，我们可以创建一个新的沙盒环境，用于Claude Auto Model的实现，这样可以有效的提高大模型的默认权限，同时在工程上出现的相关风险显著规避。

Auto mode may have a small impact on token consumption, cost, and latency for tool calls.

> 自动模式可能对工具调用的令牌消耗、成本和延迟产生小幅影响。

可能全自动的模式，在大模型的眼中才是最好的解决方案，也是最节省Token的解决方案。
