---
title: Agent Sandbox
description: 梳理 Agent 沙箱的隔离边界与微虚拟机、用户态内核等隔离路线，比较浏览器、代码执行、完整开发环境三种能力形态，并介绍 Kubernetes Job、人工审批、RBAC 和网络策略的工程落地。
pubDate: 2026-07-03
updatedDate: 2026-07-03
tags: [AI, Agent, 安全]
featured: false
---
## 问题本质

站在 2026 年的行业节点上回望，关于 Agent 基础设施的讨论，实际上早已越过了需不需要隔离的草莽阶段，进入了深水区的架构重构。如果我们要从宏观层面重新审视并串联起整个 Agent Sandbox 的技术脉络，我想在开篇确立一个底层的核心论点：**Agent 绝非仅仅是一个更聪明的 Cron Job，而是一种前所未有的、全新的运行时负载，**这个观点也会在宏观的视角上将后面 Agent Sandbox 这个模块串联起来。

![青绿色立体线条插画：数据依次经过数据过滤、代码清理和身份检查后进入 Agent Sandbox，沙箱由多层护栏与盾牌环绕，内部标注执行运行时与隔离存储。](/blog/agent-sandbox/01.png)

传统的自动化任务，它们的输入边界是清晰的，执行路径是预设的，对 CPU、内存以及网络 I/O 的消耗也是高度可预测的。系统工程师只需要为其分配固定的资源配额，它们就会像精密的齿轮一样按部就班地运转。然而，大模型驱动的自主智能体彻底打破了这一确定性范式。

当一个 Agent 被唤醒去执行复杂的开放式任务，例如自动化排查线上集群故障、或者进行多文件的代码重构时，它的运行轨迹是高度非线性和发散的。Agent 会在执行过程中进行动态规划、自主选择并调用工具、在遇到报错时进行自我修正，甚至在涉及树搜索等多步推理时，产生难以预测的算力消耗和内存爆炸。这种从**确定性脚本**到**非确定性推理**的底层质变，决定了我们无法再用承接传统计算任务的思路来糊弄 Agent。

1. Firecrawl 在 [AI Agent Sandbox](https://www.firecrawl.dev/blog/ai-agent-sandbox) 一文中用 Johann Rehberger 的 ZombAIs 实验说明，当 Claude Computer Use 在**无沙箱**的宿主机上运行时，间接提示注入 Indirect Prompt Injection 可以让 Agent 下载并执行恶意二进制，建立 C2 连接。
2. Augment Code 的 [Agent Execution Sandbox 指南](https://www.augmentcode.com/guides/agent-execution-sandbox) 则从 OWASP AIVSS 9.4 分的解释器工具攻击出发，指出**对话模型的安全机制无法平移到 Agent 执行上下文**。

两篇文章共同指向一个结构性事实：**Agent 的安全问题，本质不是模型会不会被骗，而是被骗之后能破坏多大半径。**

这就解释了为什么 Agent Sandbox 会成为整个 AI 基础设施中最关键的一环。因为面对这样一种全新的非确定性负载，底层系统面临的挑战不再仅仅是把它跑起来，而是如何容忍它产生幻觉时的破坏力、如何控制其不可预知的执行发散、以及如何妥善托管它跨越长周期任务的持久化状态。

### ReAct 到运行时

在 2022 年提出的 ReAct 模式，让 LLM 在推理与工具调用之间交替进行。这标志着负载性质的根本变化：

| 维度 | 传统 LLM 应用 | Agent 应用 |
|-|-|-|
| 执行模型 | 请求-响应，无状态 | 多步循环，有状态 |
| 副作用 | 仅生成文本 | 写文件、跑命令、访问网络 |
| 安全边界 | Prompt 过滤 | 执行环境隔离 |
| 资源模式 | 按 Token 计费 | 按 容器/VM 存活时间计费 |
| 失败模式 | 幻觉、偏见 | 数据删除、凭证泄露、横向移动 |

Ramp 工程团队在为其金融 Agent Inspect 设计底层架构时，毅然选择了基于 Modal 的 Ephemeral VM 临时微虚拟机作为核心执行层，这一工程决策精准地切中了当前智能体落地的核心矛盾。

高阶 Agent 为了完成复杂的审查、推理与分析任务，不再满足于单纯的文本生成，而是必须拥有调用真实工程工具链，如完整的 Linux 环境、Git 客户端、各类解释器甚至数据库探针的自由；但在金融级合规与数据安全的绝对红线前，它的执行流又绝不能有任何触碰、窃取或污染核心生产数据的可能。

这种既要赋予其执行代码的完整数字肉身，又要将其物理隔离于绝对安全之境的架构妥协，绝非 Ramp 一家的孤立特例。事实上，在 AI 从对话机器向自治智能体演进的今天，任何试图让 Agent 真正动手去改变现实状态的系统，其实都不再仅仅是提示词与 API 的简单缝合，而是在隐含且必然地为大语言模型定义一个专属的**运行时环境 Runtime**。

当你赋予一个拥有无限发散可能甚至幻觉的大模型一双能够操作系统和网络的手时，你同时也被迫扮演了造物主的角色。你必须为这双手打造一个即用即毁、资源受限却又高度保真的沙箱世界。

这个运行时的隔离等级、网络出口策略、特权边界以及生命周期管理，不仅决定了 Agent 能力上限的发挥，更直接划定了整个企业级系统的安全底线与生死边界。

### 四维坐标系

Google 在 [Agent Sandbox on GKE GA](https://cloud.google.com/blog/products/containers-kubernetes/bringing-you-agent-sandbox-on-gke-and-agent-substrate) 中披露的矛盾，把问题从安全推向架构：

- **规模上探**：千万级沙箱实例、每秒数百次分配
- **时间上拉**：突发执行后长期空闲，等待人类或事件
- **控制面压力**：数百万次亚秒级工具调用会压垮标准 K8s apiserver
- **成本敏感**：空闲沙箱若持续占满 CPU/内存，云账单不可接受

因此，Agent Sandbox 必须在四个维度同时做权衡：

![四向坐标图的上、下、左、右分别标注“隔离强度”“状态保真度”“成本”和“启动延迟”，呈现沙箱设计的四项权衡。](/blog/agent-sandbox/02.png)

理解 Agent Sandbox 思想，需要把它放在这个坐标系里，而不是仅仅当作给 Agent 开个 Docker。

## 威胁模型

Augment 指南列举的真实事件，勾勒了 Agent 沙箱必须覆盖的攻击面：

| 事件 | 攻击向量 | 影响 |
|-|-|-|
| CVE-2025-58372 (Roo Code) | 提示注入 → 工作区写文件 → RCE | CVSS 8.1+ |
| CVE-2025-53773 (GitHub Copilot) | 命令注入 / 恶意仓库指令 | 本地代码执行 |
| Replit 生产库删除 | Agent 持有 live DB 访问权 | 生产数据丢失 |
| Postmark MCP BCC 注入 | MCP 工具调用被篡改 | 邮件静默外泄 |
| ZombAIs (Claude Computer Use) | 网页隐藏指令 → 下载执行恶意程序 | 宿主机沦陷 |

因此，**更聪明的模型不等于更安全。**

### 间接提示注入

随着 AI Agent 从封闭的对话框走向独立自主的执行相关操作阶段，其面临的安全威胁也发生了范式的转换。研究人员 Greshake 等人首次形式化分析了间接提示注入 Indirect Prompt Injection 这一核心漏洞，当 Agent 被授权自主读取外部网页、API 返回结果或解析不可信的文件内容时，攻击者可以预先将恶意指令隐蔽地植入这些看似无害的数据流中。

![Claude Code 沙箱逃逸流程：攻击者在 bwrap 沙箱内创建带 SessionStart 钩子的 settings.json，配置在退出后保留；受害者运行 Claude Code 时，恶意命令以完整宿主机权限执行。](/blog/agent-sandbox/03.png "图中标注 CVE-2026-25725、CVSS 7.7；settings.local.json 为只读，而默认不存在的 settings.json 没有对应的只读绑定。")

一旦这些受污染的数据被全量加载到大语言模型的上下文窗口中，模型底层无法绝对区分被动数据与主动指令的架构缺陷就会暴露，导致 Agent 在无形中被劫持，从而跨越用户的原生意图去执行攻击者的指令。

面对这种极具欺骗性的输入侧攻击，Firecrawl 在其安全研究中得出了一个极具警示意味的结论，开发者永远无法试图通过编写更严密、更聪明的 Prompt 来根除此类威胁。试图在语言模型的语义层面修补安全漏洞注定是徒劳的，唯一在逻辑与工程实践上真正可证明的防御手段是降维打击，即在物理和操作系统级别，对代码执行环境进行绝对的强制隔离。这也正是 Agent Sandbox 成为大模型基础设施刚需的底层逻辑。

然而，仅仅提供一个临时隔离的执行环境并不足以一劳永逸。Augment 在其针对 Agent 的高级威胁建模中，深刻指出了一类伴随智能体自主行动力与持久化状态而生的特有安全威胁。在长周期的复杂任务中，攻击者往往不需要立刻引发明显的系统破坏，而是利用 Agent 的正常工具调用机制，例如诱导其读取特定的恶意工作区文件、解析伪装的代码库，暗中篡改 Agent 在沙箱内部具有写权限的系统配置文件或环境变量。这种攻击极其隐蔽且致命，因为它能让被污染的执行逻辑与后门合法地存留下来，并被未来的 Agent 会话所继承，从而实现长期潜伏。

在沙箱防御的专业语境中，这种企图通过篡改运行环境元数据来打破隔离边界的行为，被精确定义为基于配置的沙箱逃逸漏洞（Configuration-Based Sandbox Escape, CBSE）。

![Claude Code、Gemini CLI 与 Codex CLI 的配置层级对比，列出组织管理、全局用户和项目配置的覆盖关系，以及各工具的自动执行机制和沙箱内配置风险。](/blog/agent-sandbox/04.png "颜色图例区分组织或企业强制、全局用户与项目范围；每栏底部蓝框是自动执行入口，红框是对应的沙箱风险。")

> 在上述这三种日常使用的 AI CLI 工具，CBSE 模式都是相似的。沙箱将操作系统与外部环境隔离开来，但允许代理程序自行配置其相关设置。而那些定义了代理程序可以执行哪些操作的配置信息，则仍然处于可访问和可修改的状态。后续的漏洞报告中详细记录了这些发现，包括完整的攻击流程、概念验证结果以及各供应商的回应。

为了彻底切断 CBSE 的攻击链路，现代企业级沙箱架构必须在设计之初就融入不可变基础设施 Immutable Infrastructure 的理念，并实施最为苛刻的最小权限原则。以 agent-sandbox 等前沿架构为例，其核心的缓解策略是确保所有关乎沙箱生命周期与安全底线的配置项，对沙箱内部的 Agent 呈现绝对的**不可写**状态。这通常意味着沙箱的基础模板、网络出口白名单、存储挂载路径以及底层资源限流策略，必须被抽离到外部控制面，通过诸如 Kubernetes 的 ConfigMap 进行声明式管理与锁定。

通过这种架构级的权限阉割，Agent 只能在预先画好的法则中活动，彻底丧失了从内部修改沙箱物理边界的可能。这种防御哲学确保了，即使 Agent 的大脑被间接提示注入完全洗脑，其所能造成的物理破坏也被严格死锁在了当前瞬态虚拟机的生命周期之内，绝无可能向外围宿主机逃逸，也无法向未来的会话蔓延。

### 沙箱能做什么、不能做什么

| 沙箱能做到 | 沙箱做不到 |
|-|-|
| 限制文件系统、网络、进程可见范围 | 阻止 Agent 在授权范围内做蠢事 |
| 超时销毁，截断无限循环 | 判断 Agent 意图是否恶意 |
| 租户间 Pod 隔离 | 防止 MCP 工具描述被污染后的编排逻辑错误 |
| 审计命令与网络连接 | 替代应用层输入校验 |

对于 Agent 沙箱约束的是**执行半径，**编排逻辑（LangChain、MCP、自定义 Harness）的安全仍需单独设计。Firecrawl 第三条最佳实践——**将外部工具输出视为不可信输入**——在 MCP 场景同样成立。

## 隔离原语与能力形态

### 按隔离原语分类

底层隔离技术的演进，始终在冷启动延迟、逃逸复杂度以及硬件，尤其是 GPU，支持之间寻找最优解。

![Agent Substrate 分层架构：Agent Runtime、Agent Harnesses 和自定义 Agent 与工具组成应用层，其下是提供 gVisor/MicroVM 沙箱隔离的 Agent Substrate、Kubernetes 与 IaaS/裸金属，旁侧列有其他 K8s 工作负载和 Blob storage。](/blog/agent-sandbox/05.jpg)

根据隔离深度的不同，目前的沙箱原核可以分为四条核心路线：

| 路线 | 代表 | 隔离边界 | 典型冷启 | 逃逸复杂度 | GPU |
|-|-|-|-|-|-|
| **微 VM** | E2B、AWS Lambda、Firecracker | 硬件虚拟化 + 独立内核 | \~125–200ms | KVM/virtio 漏洞 | 实验性 |
| **用户态内核** | gVisor、Modal | Sentry 拦截 syscall | 毫秒级 | Sentry bug + 宿主内核 bug | nvproxy 支持 |
| **加固容器** | seccomp + AppArmor + K8s | namespace + cgroup | 秒级 | 单 CVE 或过滤绕过 |  |
| **语言级** | Wasmtime、V8 Isolate | 线性内存 + capability | 亚毫秒 | 编译器/运行时 bug | 不支持 |

位于最轻量级的一端是**语言级隔离**，以 Wasmtime 和 V8 Isolate 为代表。它们通过线性内存模型和基于 Capability 的安全模型，在单一进程内划定沙箱。其最大的优势是极致的**亚毫秒级**冷启动速度，极其适合高频、极短生命周期的函数执行。然而，其逃逸复杂度高度依赖于编译器或运行时的安全性，一旦出现 V8 漏洞即可被击穿；更致命的是，它目前几乎不支持 GPU 加速，也缺乏完整的操作系统语义，无法满足复杂 Agent 的需求。

向上一步是传统的**加固容器**，即在 Kubernetes 生态中结合 seccomp 限制系统调用、AppArmor 进行强制访问控制，并依赖 namespace 和 cgroup 实现资源隔离。

```dockerfile
## Hardened Docker configuration for AI agent workloads
docker run \
  --security-opt seccomp=/etc/docker/seccomp-strict.json \
  --security-opt apparmor=docker-ai-agent \
  --security-opt no-new-privileges \
  --cap-drop ALL \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=100m \
  --memory 512m \
  --cpus 1.0 \
  --network none \
  myimage
```

虽然这能提供完整的 Linux 环境，但它的冷启动通常在**秒级**，对于强交互的 Agent 来说存在明显的上下文阻断感。更严重的是，容器与宿主机共享同一个内核，这意味着攻击者只需找到单一的内核 CVE，或利用配置疏漏绕过系统调用过滤，就能实现沙箱逃逸。因此，纯粹的加固容器越来越不被推荐用于运行不受信任的大模型生成代码。

为了解决共享内核的脆弱性，**用户态内核方案**应运而生，代表作是 Google 的 gVisor 和 Modal 平台。

```yaml
## Kubernetes RuntimeClass for gVisor
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
---
apiVersion: v1
kind: Pod
spec:
  runtimeClassName: gvisor
  containers:
  - name: agent-executor
    image: myimage
```

它们在应用与宿主内核之间插入了一个 Sentry 进程，用于拦截并重新实现所有的 Syscall 系统调用。这种设计的精妙之处在于，攻击者若想逃逸，必须连续攻破 Sentry 自身的 Bug 以及底层宿主内核的 Bug，极大地拉高了逃逸复杂度。同时，它依然保持了毫秒级的冷启动速度，并且通过类似 nvproxy 的技术实现了对 GPU 算力的有效透传，是目前企业级私有化部署的优秀选择。

而在**公有云的最前沿，微虚拟机被视为隔离**的黄金标准。以 AWS Lambda 背后的 Firecracker 以及 E2B 为代表，微 VM 利用 KVM 和 virtio 技术，为每一个沙箱提供了真正的硬件级虚拟化和独立内核。这意味着即便沙箱内的操作系统全面崩溃或被提权，宿主机依然安然无恙。要想从微 VM 逃逸，黑客必须挖掘出极其罕见且复杂的 KVM 或硬件层漏洞。更为惊艳的是，通过极致的裁剪和预热技术，现代微 VM 已经能将启动一整套操作系统的延迟压缩至 125 到 200 毫秒的惊人水平。虽然目前微 VM 对 GPU 的透传仍处于实验性阶段，通常通过网络 API 绕行或复杂的 PCIe 直通实现，但它毫无疑问是执行高危 Agent 任务的首选底座。

### 按能力形态分类

如果说隔离原语是沙箱的骨架，那么能力形态就是沙箱赋予 Agent 的肌肉与感官。根据具体任务场景的复杂度，运行时的能力形态通常演化为三个明确的层级：

![沙箱能力对比表：Browser Sandbox 用于网页抓取和表单填写（Firecrawl，Cloud Container）；Code Execution 用于数据分析和 Shell 脚本（E2B，MicroVM）；Full Dev Env 面向跨仓库的复杂编程 Agent（Docker，非特权容器或 MicroVM）。](/blog/agent-sandbox/06.png)

1. **Browser Sandbox** — 托管 Chromium，返回 Markdown/截图而非原始 HTML
2. **Code Execution Sandbox** — 远程 Python/Shell，如 E2B Code Interpreter
3. **Full Dev Environment Sandbox** — 完整仓库 + 构建链，如 Docker Sandboxes、Northflank

最基础的是**代码执行沙箱（Code Execution Sandbox）**。这是目前普及度最广的形态，例如 E2B 的 Code Interpreter。

![AI Agent 通过“write & run code”连接 E2B microVM 沙箱；沙箱内列出文件访问、进程执行、软件包安装，以及独立内核、根文件系统和网络命名空间。](/blog/agent-sandbox/07.png)

```python
## 运行前需要安装依赖：pip3 install e2b-code-interpreter>=1.0.0
from e2b_code_interpreter import Sandbox

## 使用 with 语句创建一个沙箱上下文，并设置 120 秒的超时时间
## 这样可以确保任务完成后（或超时后），沙箱会被自动清理和销毁
with Sandbox(timeout=120) as sbx:
    
    # 1. 环境准备：在隔离的沙箱（microVM）内部安装需要的 Python 库
    sbx.commands.run("pip install pandas matplotlib")
    
    # 2. 执行代码：将 Agent（大模型）生成的代码传入沙箱中运行
    execution = sbx.run_code("""
import pandas as pd
import matplotlib.pyplot as plt

## 创建一个包含月份和营收数据的 DataFrame
df = pd.DataFrame({
    "month": ["Jan", "Feb", "Mar"], 
    "revenue": [120000, 145000, 138000]
})

## 将数据保存为 CSV 文件，路径位于沙箱内部的 /home/user/ 目录下
df.to_csv("/home/user/report.csv", index=False)

## 打印数据的统计描述信息
print(df.describe())
""")
    
    # 3. 获取输出：将沙箱内部代码执行的标准输出（stdout）打印到本地控制台
    print("=== 控制台输出 (stdout) ===")
    print(execution.logs.stdout)
    
    # 4. 文件读取：从沙箱中读取刚才生成的 CSV 文件内容到宿主机
    report = sbx.files.read("/home/user/report.csv")
    
    print("=== 生成的 CSV 文件内容 ===")
    print(report)

## 当代码执行离开 with 代码块时，沙箱实例会被立即销毁，释放资源
```

它为 Agent 提供了一个远程的 Python 或 Shell 的 REPL 交互式解释器环境。Agent 可以在其中执行数学计算、使用 Pandas 清洗数据或生成图表。这种形态的重点在于即写即跑，沙箱需要具备极快的文件 I/O 响应和结果回调能力。

当 Agent 需要向外探索时，**浏览器沙箱（Browser Sandbox）**便成为了它的眼睛。不同于人类使用的常规浏览器，专为 Agent 托管的 Chromium 经过了特殊的改造。它在抓取网页后，通常不会直接向大模型返回原始的 HTML 源码，因为现代网页动辄数万行的 DOM 树不仅会瞬间耗尽上下文窗口，还极易夹带我们在上文讨论过的间接提示注入攻击。相反，高级的浏览器沙箱会在内部将页面渲染并清洗，直接向 Agent 返回提纯后的 Markdown 文本、DOM 坐标树甚至是视觉截图。这种形态不仅压缩了信息密度，更是构筑了一道天然的语义防火墙。

输入：

```python
## 安装依赖：pip3 install firecrawl-py 
from firecrawl import Firecrawl 

## 初始化 Firecrawl 客户端，需要提供 API 密钥
app = Firecrawl(api_key="fc-YOUR-API-KEY") 

## 在 Firecrawl 的隔离云环境中启动一个由 Agent 控制的浏览器会话
result = app.scrape( 
    "https://firecrawl.dev",  # 目标网页 URL
    formats=["screenshot", "markdown"], # 请求返回的格式：截图和 Markdown 格式的网页内容
    actions=[ # 定义浏览器要执行的一系列交互动作
        {"type": "write", "selector": "#search-input", "text": "quarterly report"}, # 1. 找到搜索框（通过 CSS 选择器 "#search-input"），输入 "quarterly report"
        {"type": "click", "selector": "button[type=submit]"}, # 2. 找到提交按钮（"button[type=submit]"）并点击
        {"type": "wait", "milliseconds": 2000}, # 3. 等待 2000 毫秒（2秒），让搜索结果页面加载
        {"type": "screenshot"} # 4. 页面加载完成后，再次截取屏幕
    ] 
) 

## 打印结果
print(result.screenshot)  # 打印在隔离浏览器内部拍摄的截图的 URL
print(result.markdown)    # 打印返回给 Agent 的、经过清理和格式化（Markdown）的网页文本内容
```

输出：

```markdown
=== MARKDOWN OUTPUT ===

Introducing Browser Sandbox - Let your agents interact with the web

in a secure browser environment [Read more →](https://www.firecrawl.dev/browser)

## Turn websites into LLM-ready data

Power your AI apps with clean web data from any website.

=== SCREENSHOT ===

https://storage.googleapis.com/firecrawl-scrape-media/screenshot-dfe8a924-7e10-4932...

## A hosted URL to the screenshot taken inside the isolated container

=== METADATA ===

title='Firecrawl - The Web Data API for AI' status_code=200 proxy_used='basic'

credits_used=1 concurrency_limited=False
```

> 通过上述代码的输入/输出，演示了 Agent-Sandbox 的一种典型应用场景：**安全、可编程的网页浏览自动化**。
> 
> 开发者通过几行代码，就可以让 AI 在一个完全隔离的环境里打开网页、输入文字、点击按钮、截图并提取干净的内容，而无需担心自己本地环境的安全或网络环境的限制。

而在软件工程领域，例如 SWE-agent 或 Devin 这类全自动程序员，它们需要的是**完整开发环境沙箱（Full Dev Environment Sandbox）**。以 Docker Sandboxes 或 Northflank 提供的环境为代表，这类沙箱不仅仅提供一个代码执行器，而是完整克隆了目标的 Git 仓库，预装了 Node.js、Go、Rust 等庞大的构建工具链，并开放了有限的内网通信能力。Agent 在其中可以自由地启动本地 Web 服务器进行 Debug、执行完整的集成测试甚至编译庞大的二进制文件。这种形态是沙箱技术的集大成者，它不仅考验底层隔离机制的安全性，更对长会话的状态持久化、存储挂载性能以及网络带宽控制提出了极为严苛的工程挑战。

综上所述，当前 Agent 底层基础设施的设计，本质上是针对不同的业务场景，在上述隔离原语与能力形态的矩阵中进行精准的排列组合。无论是追求极致安全的公有云微 VM 代码解释器，还是侧重全栈开发的用户态内核完整环境，它们都在共同推动着 AI 从说客向实干家的历史性跨越。

## 基建标准

随着 AI Agent 技术的快速成熟，为这些自主智能体提供运行环境的沙箱基础设施已不再是一个简单的隔离容器，而是演变成了一个极具技术深度的独立赛道。

目前都在围绕四个核心维度展开激烈的技术角逐：**隔离质量、启动速度、开发者体验以及预装工具链**。

### 安全底座

在让 Agent 真正动手执行任务时，安全性绝不能以牺牲系统的灵活性为代价。良好的沙箱必须赋予每个 Agent 独占内核和私有守护进程的权限，同时确保宿主机的绝对安全。

以 **Docker Sandboxes** 为例，它为每个沙箱分配了专用的微虚拟机和完全私有的 Docker 守护进程。这种设计的绝妙之处在于，它安全地解决了 Docker-in-Docker 的难题，满足 Agent 可以在沙箱内自由地拉取镜像、构建和运行容器，而不需要宿主机开放高危的特权模式，也无法越权访问宿主机的任何文件。

同样，**E2B** 在代码执行层面采用了 AWS Lambda 同款的 **Firecracker 微虚拟机技术**。每个沙箱都拥有独立的内核与网络命名空间，这意味着哪怕大模型生成了带有内核级漏洞利用的恶意代码，其破坏力也会被死死锁定在微 VM 内部，无法向宿主机发生逃逸。

### 响应引擎

AI Agent 的工作流通常不是单次调用，而是包含数十次连续观察、推理与执行的 Agentic Loop 循环。在这种高频交互下，沙箱的启动延迟会被急剧放大。

在每天调用 1 万次沙盒的企业级场景中，每次启动仅仅节省 123 毫秒，累加起来就能每天为系统节省超过 20 分钟的阻塞时间。因此，极致的冷启动速度成为了核心竞争力。目前，Daytona 宣称其能达到惊人的 90 毫秒极速冷启，而采用 Firecracker 的 E2B 也将完整操作系统的启动时间压缩到了约 200 毫秒。这种几乎无感的响应速度，是保证大语言模型推理链条不被基础设施卡顿打断的关键。

### 开箱即用环境

极速的启动不仅仅依赖底层的虚拟机优化，更取决于沙箱内部是否**预装了完备的工具链**。预装环境直接决定了每次调用的真实业务延迟。

如果一个沙箱启动时是一张白纸，没有 Python 或 Node.js，那么 Agent 的第一个动作必然是执行漫长的下载和包安装操作。这不仅会白白增加数秒的等待时间，还极易引入依赖冲突或网络超时等额外的故障节点。

- **面向代码的运行态**：优秀的沙箱，如 Docker Sandboxes 和 E2B 的默认镜像，会预装 Python、Go、Node.js，以及 jq、uv 和 pip 等包管理器。更重要的是，它们还会内置 Git、GitHub CLI 和 Docker CLI。行业实践证明，相比于复杂的图形界面或需要繁琐鉴权的 REST API，**干净、标准的命令行界面才是自主智能体最理想、最原生的交互工具。**
- **面向 Web 的运行态**：像 **Firecrawl 的浏览器沙箱**，则会预先初始化一个纯净的无头 Chromium 实例。Agent 被唤醒后无需等待浏览器安装与内核加载，瞬间就能开始网页 DOM 树的抓取与导航。

总而言之，一个优秀的 Agent Sandbox 必须是在硬件级隔离的安全性与毫秒级交付的灵活性之间取得完美平衡的系统。它预装了智能体所需的完整数字工具箱，让 Agent 能够即插即用、用完即毁。

如今，这个领域的竞争已经进入白热化。不仅有 E2B、Daytona 这样的垂直先行者，更吸引了 Google Cloud、Cloudflare 等云服务巨头，以及原生集成在 Kubernetes 生态中的项目和 Cursor 等智能编程平台的入局。

这不仅印证了沙箱基础设施的巨大商业价值，也标志着 AI 系统正在从云原生正式迈向 Agent 原生的新纪元。

## 落地实践

### 实践概述

基于 Agent Sandbox 是一个基于 Kubernetes 的隔离执行环境，用于安全运行 Agent 的自动化修复操作。

核心特性如下：

- **隔离执行**: 在专用的 Kubernetes Namespace 中运行操作
- **最小权限**: 通过 RBAC 实现 Least Privilege 访问控制
- **网络安全**: 通过 NetworkPolicy 限制出口流量
- **资源控制**: 自动清理、超时控制、无重试机制
- **可审计**: 完整的执行跟踪和审计日志
- **可扩展**: 支持 gVisor/Kata Containers 等运行时增强隔离

它确保了自动化运维 SRE 操作在受控、安全的环境中执行，并配备了完整的人工审批工作流。

### 整体架构

该系统的整体架构与执行流程构成了一个安全可控的自动化修复闭环。

![自动化修复流程：Agent System 提出修复建议，经 HITL 人工审批后，由 Approval Handler 通过 sandbox.Executor 分流到生产环境的 Job Executor（在沙盒命名空间创建 K8s Job）或开发环境的 Local Executor（运行本地进程）。](/blog/agent-sandbox/08.png "图中只展开“审批通过”后的执行路径，未画出审批拒绝或取消分支。")

首先，Agent 系统会基于分析生成修复操作建议，并触发创建一个 HITL 检查点以等待人工审批。当人工审批通过该提案后，Approval Handler 会接管请求，并通过 sandbox.Executor 接口将任务下发至隔离的沙盒环境中执行。

在具体的执行落地上，生产环境会通过 Job Executor 在 Kubernetes 的沙盒命名空间内创建 Job 来完成，而开发环境则通过 Local Executor 直接运行本地进程。最后，整个执行过程的状态与最终结果都会被完整记录到审计日志中，从而确保了所有自动化操作的安全隔离与可追溯性。

### 核心组件

#### 定义标准

1. Executor 接口：

定义了沙盒执行器的核心接口，支持多种后端实现。

```go
// Executor 管理隔离的修复执行
type Executor interface {
    Execute(ctx context.Context, req *ExecutionRequest) (*ExecutionResult, error)
    GetStatus(ctx context.Context, executionID string) (*ExecutionResult, error)
    Cancel(ctx context.Context, executionID string) error
}
```

在核心组件部分，首先定义了沙盒执行器的标准规范。Executor 接口是整个沙盒模块的基础，它抽象了底层具体的执行环境。无论是在生产环境的 Kubernetes 集群中，还是在本地开发环境中，上层调用者只需要通过这个接口的 Execute 方法提交任务、通过 GetStatus 查询执行状态，或者通过 Cancel 方法随时中止正在运行的任务，而不需要关心底部的具体实现细节。

1. Config 配置结构：

```go
// Config 配置沙盒Job执行器
type Config struct {
    Namespace                    string        // 沙盒命名空间
    ServiceAccount               string        // 服务账户
    DefaultImage                 string        // 默认容器镜像
    DefaultTimeout               time.Duration // 默认超时时间
    TTLSecondsAfterFinished      int32         // Job 完成后 TTL
    MaxLogBytes                  int64         // 最大日志字节数
    RuntimeClassName             string        // 运行时类名 (gVisor/Kata)
    AutomountServiceAccountToken *bool         // 是否挂载服务账户令牌
}
```

为了让沙盒环境能够灵活适配不同的集群和安全要求，系统设计了专门的配置结构。Config 结构体包含了沙盒运行所需的所有核心参数设定，比如用于隔离资源的默认命名空间、执行任务时绑定的服务账户、防止任务卡死的默认超时时间，以及控制日志大小和 Job 自动清理时间的参数。

此外，它还支持配置底层容器运行时，例如可以指定使用 gVisor 或 Kata 等安全容器来进一步提升隔离级别。

1. ExecutionRequest 执行请求：

```go
// ExecutionRequest 描述一个批准的修复操作执行请求
type ExecutionRequest struct {
    ID                string            // 执行 ID
    SessionID         string            // 会话 ID
    TaskID            string            // 任务 ID
    CheckpointID      string            // 检查点 ID
    Namespace         string            // Job 命名空间
    TargetNamespace   string            // 目标命名空间
    Image             string            // 容器镜像
    Command           []string          // 执行命令
    Args              []string          // 命令参数
    Env               map[string]string // 环境变量
    Timeout           time.Duration     // 超时时间
    ApprovedBy        string            // 审批人
    RemediationAction string            // 修复操作描述
}
```

当系统生成了一个需要执行的修复操作，并且该操作通过了人工审批后，系统会将其封装成一个标准化的执行请求。ExecutionRequest 结构体详细描述了这单次任务的所有上下文信息。它不仅包含了执行具体操作所需的容器镜像、命令行指令、运行参数和环境变量，还记录了审计追踪所需的元数据，例如是由哪个会话、哪个任务触发的，以及最终由谁批准了这次修复操作。

1. ExecutionResult 执行结果：

```go
// ExecutionResult 报告当前或终端执行状态
type ExecutionResult struct {
    ExecutionID string        // 执行 ID
    Status      Status        // 执行状态
    ExitCode    *int32        // 退出代码
    Logs        string        // 执行日志
    JobName     string        // Job 名称
    StartedAt   *time.Time    // 开始时间
    FinishedAt  *time.Time    // 完成时间
    Error       string        // 错误信息
}
```

任务在沙盒中运行结束后，或者在运行过程中被查询状态时，执行器会返回标准化的执行结果。ExecutionResult 结构体主要负责报告任务的最终命运。它记录了任务的当前状态、底层进程退出的状态码、标准输出和标准错误合并后的执行日志，以及任务开始和结束的精确时间戳。如果执行过程中出现了系统级错误或者超时，也会在这个结构体中进行记录反馈。

#### 安全模型

1. 命名空间隔离：

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: xxx-sandbox
  labels:
    app.kubernetes.io/part-of: xxx
    xxx.dev/component: sandbox
```

在安全模型的设计上，系统采用了深度防御的安全策略，确保自动化修复脚本在执行时即使出现异常或者遭受恶意篡改，也不会对宿主集群造成破坏。第一道防线是命名空间隔离。系统会通过专属的Kubernetes Namespace将所有沙盒Job与业务应用完全物理隔离。

1. RBAC 最小权限：

```bash
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: xxx-remediation
  namespace: xxx-sandbox
rules:
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "patch", "update", "delete"]
  - apiGroups: ["apps"]
    resources: ["deployments/scale"]
    verbs: ["get", "update", "patch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "delete"]
```

第二道防线是基于 RBAC 的最小权限控制。沙盒环境拥有自己独立的服务账户，并且只被授予了完成修复任务所必须的最小 API 访问权限，例如只能对特定的 Deployment 或 Pod 进行查询和有限的修改，严格防止权限越界。

1. Pod 安全上下文：

```go
SecurityContext: &corev1.PodSecurityContext{
    RunAsNonRoot: ptr.To(true),
}
```

在 Pod 级别，系统通过安全上下文强制应用了非特权运行的规则，明确要求容器必须以非 root 用户的身份启动运行，从根本上降低了容器逃逸的风险。

1. 容器安全上下文：

```go
func buildSecurityContext() *corev1.SecurityContext {
    return &corev1.SecurityContext{
        RunAsNonRoot:             ptr.To(true),
        AllowPrivilegeEscalation: ptr.To(false),
        Privileged:               ptr.To(false),
        Capabilities: &corev1.Capabilities{
            Drop: []corev1.Capability{"ALL"},
        },
    }
}
```

在更细粒度的容器级别，安全上下文进一步锁死了潜在的安全漏洞。系统明确禁用了特权模式，关闭了权限提升的可能，并且极其严格地剥离了所有 Linux 内核能力。这意味着即使修复脚本内部存在恶意逻辑，也无法调用底层的系统级特权功能。

1. 网络策略：

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: xxx-sandbox-egress
  namespace: xxx-sandbox
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - ipBlock:
            cidr: <dns.cidr>
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    - to:
        - ipBlock:
            cidr: <apiServer.cidr>
      ports:
        - protocol: TCP
          port: 443
```

为了防止恶意脚本外发数据或者横向探测集群内部网络，系统部署了严格的网络策略。沙盒 Pod 的网络出口被极大程度地限制，通常仅允许向 DNS 服务器发起解析请求，以及向 Kubernetes API 服务器发起必需的控制流请求，切断了其他所有的外部网络访问途径。

1. Job 执行保护

```go
BackoffLimit:            ptr.To[int32](0),     // 不重试
TTLSecondsAfterFinished: ptr.To(cfg.TTLSecondsAfterFinished),  // 自动清理
ActiveDeadlineSeconds:   ptr.To(activeDeadline),  // 超时控制
RestartPolicy:           corev1.RestartPolicyNever,  // 不重启
```

最后一道防线是针对 Job 生命周期的执行保护机制。为了防止异常任务无休止地消耗集群资源，系统明确关闭了失败重试机制，设定了严格的活跃超时时间，并且配置了在任务完成后自动清理资源的 TTL 策略，确保沙盒环境始终保持干净和轻量。

### 实现细节

1. Job Executor (生产环境)：

```go
// JobExecutor 运行短生命周期的Kubernetes Job来执行修复操作
type JobExecutor struct {
    client       kubernetes.Interface
    cfg          sandbox.Config
    logger       *slog.Logger
    pollInterval time.Duration
    getLogs      podLogsGetter

    mu        sync.RWMutex
    cancelled map[string]*sandbox.ExecutionResult
}

// Execute 创建一个Job并等待终端执行结果
func (e *JobExecutor) Execute(ctx context.Context, req *sandbox.ExecutionRequest) (*sandbox.ExecutionResult, error) {
    if e == nil || e.client == nil {
        return nil, fmt.Errorf("kubernetes client is required")
    }

    job, err := buildJob(e.cfg, req)
    if err != nil {
        return nil, err
    }

    e.logger.Info("sandbox job created", "job", job.Name, "namespace", job.Namespace, "execution_id", req.ID)
    if _, err := e.client.BatchV1().Jobs(job.Namespace).Create(ctx, job, metav1.CreateOptions{}); err != nil {
        return nil, fmt.Errorf("create job %s/%s: %w", job.Namespace, job.Name, err)
    }

    result, err := e.waitForTerminalResult(ctx, req.ID, job.Namespace, job.Name)
    if err != nil {
        return nil, err
    }
    e.logTerminalResult(result)
    return result, nil
}
```

在具体的代码实现层面，系统提供了两套不同的执行器后端。第一种是专门为生产环境设计的 Job Executor。它直接与 Kubernetes API 交互，每当接收到一个执行请求时，就会在集群指定的沙盒命名空间内动态创建一个短生命周期的 Job 资源。它会持续监听这个 Job 的状态，直到任务成功完成、失败或超时，随后拉取 Pod 的标准输出日志并封装成结果返回。这种方式充分利用了 Kubernetes 的原生调度和隔离能力。

1. Job Builder (Job 构建器)：

```go
// buildJob 构建一个Kubernetes Job
func buildJob(cfg sandbox.Config, req *sandbox.ExecutionRequest) (*batchv1.Job, error) {
    if req == nil {
        return nil, fmt.Errorf("execution request is required")
    }
    if req.ID == "" {
        return nil, fmt.Errorf("execution id is required")
    }
    if len(req.Command) == 0 {
        return nil, fmt.Errorf("command is required")
    }

    cfg = sandbox.NormalizeConfig(cfg)
    namespace := req.Namespace
    if namespace == "" {
        namespace = cfg.Namespace
    }

    job := &batchv1.Job{
        ObjectMeta: metav1.ObjectMeta{
            Name:        sandbox.JobName(req.ID),
            Namespace:   namespace,
            Labels:      labels,
            Annotations: annotations,
        },
        Spec: batchv1.JobSpec{
            BackoffLimit:            ptr.To[int32](0),
            TTLSecondsAfterFinished: ptr.To(cfg.TTLSecondsAfterFinished),
            ActiveDeadlineSeconds:   ptr.To(activeDeadline),
            Template: corev1.PodTemplateSpec{
                Spec: corev1.PodSpec{
                    ServiceAccountName:           cfg.ServiceAccount,
                    AutomountServiceAccountToken: cfg.AutomountServiceAccountToken,
                    RestartPolicy:                corev1.RestartPolicyNever,
                    Containers: []corev1.Container{
                        {
                            Name:            "executor",
                            Image:           image,
                            Command:         req.Command,
                            Args:            req.Args,
                            Env:             env,
                            SecurityContext: buildSecurityContext(),
                        },
                    },
                    SecurityContext: &corev1.PodSecurityContext{
                        RunAsNonRoot: ptr.To(true),
                    },
                },
            },
        },
    }

    // 可选：支持 gVisor/Kata 运行时
    if cfg.RuntimeClassName != "" {
        job.Spec.Template.Spec.RuntimeClassName = ptr.To(cfg.RuntimeClassName)
    }

    return job, nil
}
```

为了配合 Job Executor 的工作，系统提供了一个专门的构建器函数用来组装 Kubernetes Job 对象。这个构建器的核心职责就是将前面提到的系统安全配置项以及单次任务的请求参数，完美地翻译成一个符合 Kubernetes 规范的 Job 清单对象。它会负责将镜像、命令、环境变量正确地注入到容器定义中，并且严格附加所有的 Pod 和容器级别的安全上下文设定。

1. Local Executor (开发环境)：

```go
// Executor 运行沙盒请求在本地主机进程上进行开发
type Executor struct {
    cfg     sandbox.Config
    mu      sync.RWMutex
    results map[string]*sandbox.ExecutionResult
    procs   map[string]*exec.Cmd
}

// Execute 运行命令本地并记录结果
func (e *Executor) Execute(ctx context.Context, req *sandbox.ExecutionRequest) (*sandbox.ExecutionResult, error) {
    if req == nil {
        return nil, fmt.Errorf("execution request is required")
    }

    timeout := req.Timeout
    if timeout <= 0 {
        timeout = e.cfg.DefaultTimeout
    }
    cmdCtx, cancel := context.WithTimeout(ctx, timeout)
    defer cancel()

    cmd := exec.CommandContext(cmdCtx, req.Command[0], sandbox.CommandArgs(req)...)
    var output bytes.Buffer
    cmd.Stdout = &output
    cmd.Stderr = &output

    startedAt := time.Now().UTC()
    result := &sandbox.ExecutionResult{
        ExecutionID: req.ID,
        Status:      sandbox.StatusRunning,
        JobName:     sandbox.JobName(req.ID),
        StartedAt:   &startedAt,
    }
    e.remember(req.ID, result, cmd)

    err := cmd.Run()
    finishedAt := time.Now().UTC()

    result.Logs = sandbox.TruncateLogs(output.String(), e.cfg.MaxLogBytes)
    result.FinishedAt = &finishedAt
    result.ExitCode = exitCodeFromErr(err)

    switch {
    case errors.Is(cmdCtx.Err(), context.DeadlineExceeded):
        result.Status = sandbox.StatusTimedOut
        result.Error = cmdCtx.Err().Error()
    case err == nil:
        result.Status = sandbox.StatusSucceeded
    case errors.Is(ctx.Err(), context.Canceled):
        result.Status = sandbox.StatusCancelled
        result.Error = ctx.Err().Error()
    default:
        result.Status = sandbox.StatusFailed
        result.Error = err.Error()
    }

    e.remember(req.ID, result, nil)
    return sandbox.CloneResult(result), nil
}
```

第二种执行器是专门为了方便开发和本地测试而设计的 Local Executor。在没有 Kubernetes 集群环境的情况下，这个执行器会绕过容器编排层，直接调用宿主操作系统的底层接口，以本地子进程的方式运行修复命令。它同样会接管标准输出和错误流来捕获执行日志，并通过上下文机制实现了与生产环境一致的超时熔断和状态追踪功能。

1. Backend Factory (后端工厂)：

```go
// NewExecutorFromConfig 从配置中选择沙盒后端
func NewExecutorFromConfig(cfg sandbox.Config, client kubernetes.Interface, logger *slog.Logger) (sandbox.Executor, error) {
    switch os.Getenv("SANDBOX_BACKEND") {
    case "", "job":
        if client == nil {
            return nil, fmt.Errorf("kubernetes client is required for job backend")
        }
        return job.NewJobExecutor(client, cfg, logger), nil
    case "local":
        return local.NewExecutor(cfg), nil
    default:
        return nil, fmt.Errorf("unsupported sandbox backend %q", os.Getenv("SANDBOX_BACKEND"))
    }
}
```

为了将生产环境和开发环境的底层实现对上层业务代码透明化，系统引入了后端工厂模式。工厂函数会读取系统的环境变量配置，如果在环境中检测到配置为 local，就会实例化本地进程执行器；而默认情况下或者显式配置为 job 时，则会实例化基于 Kubernetes 的执行器。这种设计使得系统在不同环境间的切换变得极其简单和无缝。

### 后续实现

该自动化修复系统构建了一个从方案生成、HITL 人工审批到安全隔离执行的完整闭环架构。系统核心通过统一的 Executor 接口抽象了底层运行环境，利用工厂模式在开发环境的本地进程执行与生产环境的 Kubernetes Job 执行之间实现无缝切换。为确保修复操作的安全可控，系统部署了深度的防御策略，包括专属沙盒命名空间隔离、严格限制的 RBAC 最小权限、强制非特权运行且剥离所有 Linux 内核能力的容器安全上下文、仅放行 DNS 和 API 服务器通信的严格网络策略，以及禁止重试并自动清理资源的 Job 生命周期控制机制。

1. 统一接口抽象：复用现有的 Executor 接口，新增 CloudProvider 接口实现多云支持。
2. 支持多云平台：

   - AWS ECS/Fargate
   - 阿里云 ECI
   - Azure ACI
   - GCP Cloud Run Jobs
3. 混合部署：通过环境变量 SANDBOX_BACKEND 灵活切换后端 (local/job/cloud)。

面向未来的架构演进，该系统在计算层可平滑向 Serverless 容器形态升级，利用其轻量级虚拟机底座获取物理级强隔离与秒级按需拉起的弹性优势；而在状态流转层面，系统计划通过解耦并引入统一的对象存储抽象层，让无论是本地开发产生的文件，还是云端沙箱生成的排查日志与修复脚本等易失性产物，都能以标准化的接口完成无缝的回传、同步与持久化留存，从而在保持计算节点完全无状态的同时，优雅地解决跨环境文件互通与共存的难题。

## 迈向 Agent 原生设施

站在整个技术演进的十字路口，可以清晰地看到，Agent Sandbox 已经褪去了早期仅仅作为代码执行器的简单外衣，演变成为支撑大语言模型走向物理世界的核心基础设施。

![Agent 修复系统架构：Agent System 经 HITL 审批、Approval Handler 和 Backend Factory，按 SANDBOX_BACKEND 分流到本地、K8s Job 或 Cloud Provider，最终汇入 S3/COS/OSS 统一对象存储；Job 分支另列非 root、移除所有 Capabilities、最小权限 RBAC 和 NetworkPolicy。](/blog/agent-sandbox/09.png "cloud 分支与统一对象存储在图中标为“未来演进”；云分支示例为 AWS Fargate 和阿里云 ECI。")

从传统的 Kubernetes 命名空间隔离，到探索 Serverless 容器与微虚拟机的多云架构，安全与性能的边界正在被不断重塑。对于复杂的线上运维自动化与代码工程而言，系统不再仅仅满足于防御间接提示注入或基于配置的沙箱逃逸，而是要在亚毫秒级的冷启动、海量的状态并发以及极致的物理隔离之间寻找最优解。

未来，随着统一存储抽象层与多云编排引擎的深入融合，沙箱的计算节点将彻底走向无状态化与极速弹性。这不仅是底层技术架构的一次深度重构，更是为真正具备自治能力的 AI 智能体打造的一个高度保真、绝对安全且跨环境无缝流转的数字运行环境。当我们彻底摒弃传统 Cron Job 的思维，真正将 Agent 视为一种全新的非确定性计算负载来设计底层系统时，这种以沙箱为核心的运行时基础设施，必将成为下一代企业级智能化落地的绝对基石。

## 参考内容

| **参考来源** | **文献类型** | **核心关注点** | **关键技术与特性** | **核心价值与应用场景** |
|-|-|-|-|-|
| [Firecrawl Blog](https://www.firecrawl.dev/blog/ai-agent-sandbox)  
AI Agent Sandbox: How to Safely Run Autonomous Agents | 最佳实践指南 | Agent 沙箱的安全原则与隔离必要性 | 最小权限原则、严格的多级超时机制、网络出口过滤、无 root 权限容器、只读挂载。 | 防止 Agent 因幻觉或提示词注入 Prompt Injection 导致破坏宿主机、数据泄露及云资源滥用。主要面向 Web 自动化与外部工具调用场景。 |
| [Augment Code](https://www.augmentcode.com/guides/agent-execution-sandbox)  
What Is an Agent Execution Sandbox? | 技术架构指南 | AI 代码生成的生产级安全隔离策略 | 硬件级隔 MicroVMs、用户态内核、语言级沙箱 WASM/V8、基于 cgroup 的资源限制CPU/内存/PID 防御 Fork 炸弹、临时只读文件系统。 | 限制不受信任的 AI 生成代码在运行时的权限，防止逃逸攻击。确保代码生成、测试和执行在生产环境下的绝对安全。 |
| [ArXiv 2605.22781](https://arxiv.org/abs/2605.22781)  
DeltaBox: Scaling Stateful AI Agents... | 学术论文 | 毫秒级沙箱状态快照与回滚技术（优化状态型 Agent 扩展性） | DeltaState 基于增量的状态变更 、DeltaFS 写时复制的文件系统层切换、DeltaCR 增量进程转储、基于 Firecracker 的底层微型虚拟机。 | 将沙箱的检查点 Checkpoint 和回滚 Rollback 延迟从秒级骤降至毫秒级，打破大规模状态探索，如 MCTS 树搜索、强化学习的性能瓶颈。 |
| [Agent-Sandbox](https://github.com/agent-sandbox/agent-sandbox)  
agent-sandbox/agent-sandbox | 开源项目 | 企业级、云原生的开源 Agent 运行时沙箱 | 完全兼容 E2B 协议及 SDK、提供 MCP 模型上下文协议 服务端集成、基于 Kubernetes 的云原生架构、多租户与多会话隔离。 | 提供可私有化部署的商业沙箱替代方案。支持代码执行、浏览器自动化和终端控制，Agent 可通过 MCP 自动管理沙箱的全生命周期。 |
| [Google Cloud Blog](https://cloud.google.com/blog/products/containers-kubernetes/bringing-you-agent-sandbox-on-gke-and-agent-substrate)  
Bringing you Agent Sandbox on GKE | 云厂商发布 | 超大规模、高密度的 AI 智能体云基础设施 | GKE Agent Sandbox 基于 gVisor 的强安全隔离、Agent Substrate 专为高密度并发设计的开源调度面、Pod 快照与温水池技术。 | 解决百万级 Agent 并发导致的控制面瘫痪与算力浪费问题。实现闲置状态瞬间挂起，激活时 200 毫秒内极速恢复，消除冷启动，专为企业级超大规模 Agent 部署设计。 |
