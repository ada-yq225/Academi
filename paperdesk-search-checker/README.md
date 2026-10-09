# PaperDesk 自主查重测试版

独立实现，支持中英文文本、TXT、DOCX、文字型 PDF，定位句内匹配文字并展示来源证据。

启动：`npm install`，然后 `NODE_USE_ENV_PROXY=1 PYTHON_BIN=/path/to/python-with-pypdf npm start`。
默认 http://127.0.0.1:5020/ 。Node 24.5+ 可使用本机 HTTP(S)_PROXY；PDF提取需要Python的pypdf。

流程：选择6或12个均匀分布片段，经免费网页检索、Crossref、arXiv、Europe PMC及开放期刊会议网站发现候选，最多读取60个公开来源。所有文稿句子与全部已获取来源比对。期刊、会议候选可由Crossref发现；元数据不等于全文。没有全文而有摘要时标注“仅摘要”。可自动读取学术网页链接的开放PDF及Europe PMC开放XML全文；arXiv也包含未经同行评审的预印本，单独标记来源类型。不绕过登录、验证码或付费墙。

评分：匹配有效文字字符/全文有效文字字符，多个来源重叠去重。英文连续5词（按片段判断，支持混合稿）、中文片段连续10个token作为匹配锚点，扩展并记录原文位置。没有可读取来源时显示不可判定，不是0%。正文最多50万字符，截断状态和抓取失败单独记录。短句达不到锚点长度时不会匹配。

这是检索测试版，未建立全互联网或全学术全文索引。搜索覆盖有限、免费服务可能限流、未发现匹配不等于全文原创。第一版不能识别语义改写、翻译抄袭或扫描件OCR。引用和参考文献目前同样参与匹配，尚无自动排除。

可添加已知来源网址和自有参考文稿。可选BRAVE_API_KEY接官方搜索API；未配置则使用免费版。只向搜索服务发送选中的查询片段。

任务临时放在本机内存，完成30分钟后清理。默认只绑定127.0.0.1，未迁移生产客户数据。JSON结果包含详细高亮位置和来源。

`npm test` 验证原文定位、长网页、去重、中英文分句和私人地址拒绝。

扩大测试：`NODE_USE_ENV_PROXY=1 PYTHON_BIN=/path/to/python node scripts/expanded-benchmark.mjs`。人工构造6组文稿，出处只供事后核对，自动检索不预先注入来源。测试包含摘要、会议与期刊正文、中文期刊、物理、农业与工程及原创负例。
来源文本缓存30分钟（最多64条、800万字符）；临时429/5xx和网络超时最多重试一次；DNS解析有8秒截止。来源读取使用4个独立工作队列，慢链接不阻塞已空闲队列。

复测证据不会覆盖初轮原始文件；`node scripts/publish-benchmarks.mjs` 发布已保存的最新测试记录。页面 `/benchmarks.html` 区分初轮与复测。网页/摘要与PDF内容均保留，但逐句证据会标明实际匹配的范围，避免把摘要命中说成PDF全文命中。

## PDF 报告
检测完成后点击“下载 PDF 报告”，扩大测试页面可下载测试汇总 PDF。导出保留原文逐句高亮、实际检测分数、匹配来源链接、证据范围和获取失败统计。报告标明 PaperDesk 自主查重及非 Turnitin 官方报告。

运行环境需要 Python 和 `reportlab`；设置 `PYTHON_BIN` 可指定 Python。优先使用 `assets/fonts/ArialUnicode.ttf` 或 macOS 的 Arial Unicode 字体；否则回退到中文 CID 字体。`POST /api/report` 接受已完成的 `jobId` 或白名单测试 `sampleId`，不接受客户端传入任意分数。任务仅在内存保留约30分钟，完成后请及时下载；PDF生成临时文件会自动清理。

离线导出已有 JSON：`python3 scripts/pdf-report.py --input 检测结果.json --output 报告.pdf`。测试汇总需另外指定 `--type benchmark`。

检测详报现已默认接入原项目 `worker/restyle.py` 的 v3 报告壳。可移植副本和自主查重适配器保存在 `scripts/report-shell/`，使用原来的 Lexend/Noto 字体、Letter尺寸、封面及概览页结构。独立检索结果没有AI字段，不会生成AI结论；报告保持 PaperDesk 来源和非官方标识。基准测试汇总继续使用统计报告版式。

本地云存储可能使依赖文件成为仅云端文件。本次已在 `~/.cache/paperdesk-search-checker-runtime` 按锁文件恢复依赖；启动脚本会在该缓存存在时使用它，否则使用正常node_modules。可通过 `PAPERDESK_RUNTIME_DIR` 显式指定缓存位置。此方式不依赖云端文件读取；部署到新服务器仍先执行npm ci。

## 来源可用性与短期冷却
`/sources.html` 显示实际GET校验结果：分搜索、元数据、摘要与全文，包含逐网址3轮成功次数、耗时、大小和失败原因。可手动执行 `NODE_USE_ENV_PROXY=1 node --import ./scripts/local-runtime.mjs scripts/source-audit.mjs`，随后 `node scripts/publish-source-audit.mjs` 更新结果；不自动定时请求。

来源候选在保留渠道多样性的同时优先开放全文。失败只按具体网址冷却：访问拒绝、404、不可读、超限与重定向问题5分钟，临时网络错误30秒；到期可重试，不永久屏蔽出版商。冷却跳过会记录cachedFailure及failureKind，来源未获取不会被当作成功。Crossref公共请求单连接串行并限制速率；可设置自己愿意提供的CROSSREF_MAILTO使用官方polite入口。429/5xx尊重Retry-After，等待要求超过30秒则记录失败而不提前重试。

## 客户公网试用
2026-10-07完善浏览器会话隔离：上传检测结果及对应PDF只允许提交任务的浏览器读取，公开样本可直接预览。刷新页面会恢复当前会话已提交的任务；暂时返回HTML错误页面时显示可读提示。任务仍在内存保留约30分钟，应及时下载。测试服务器UI资产预载入内存，避免macOS在请求之间卸载小文件。

公网试用使用cloudflared映射127.0.0.1:5020；Quick Tunnel地址是临时地址，电脑须保持开机联网。运行中的防休眠进程防止空闲休眠，不替代服务器托管。

### 精简客户报告

客户查重 PDF 最多 20 页（含封面和概览），只展示已匹配的重复文字，未匹配片段不进入报告。总分始终使用完整文稿的检测结果；长文稿超过页面预算时明确标注节选数量，完整逐片段证据仍在网页和 JSON 中。来源索引及检索限制说明保留。真实论文复验为 19 页；无匹配及三倍长文稿导出也通过页数和省略检查。
