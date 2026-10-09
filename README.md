# 当前完整项目（2026-10-09）

网站代码位于仓库根目录，`paperdesk-search-checker/` 为内置自主查重模块。默认流程：ACADEMI.CX 生成 AI 报告，PaperDesk 检索公开来源并生成相似度报告。报告保留实际来源及非官方说明，重复片段报告最多 20 页。免费公开检索不代表全互联网覆盖。

安装：Node.js 24，运行 `npm ci`、`npm --prefix paperdesk-search-checker ci`，Python 安装 `worker/requirements.txt`。复制 `.env.example` 到 `.env` 填写私有配置后运行 `npm run build`、`npm start`，另一个进程运行 `npm run worker`。浏览器执行器另需 Playwright/Chromium 和可用中文 TrueType 字体（设置 `CJK_FONT`）。线上域名、支付商户和数据库需要自行配置；本仓库不包含客户数据、账号密码、密钥或运行记录。

验证：`npm run test:audit`；自主查重模块使用 `npm --prefix paperdesk-search-checker test`。前者使用临时数据库，无需真实扣款；后者为匹配、检索降级及来源策略回归。Docker 配置提供完整模块，目标服务器的实际构建仍需验证。

以下为项目历史部署说明，涉及旧检测来源和管理员入口的描述应以当前代码和上文为准。

# 客户测试准备（2026-09-21）

当前交付状态、启动方法与测试边界以 [CUSTOMER-TEST.md](CUSTOMER-TEST.md) 为准。下文包含历史记录，其中支付和报告排版说明部分已被新版替代。

# PaperDesk 独立部署版

普通网站架构：React 前端 + Node.js 服务端 + SQLite 数据库 + 服务器文件存储。无需 ChatGPT 登录，不依赖 Sites、Cloudflare D1 或 R2。可使用自有域名部署。

功能：邮箱注册登录、CDK 生成/兑换、任务排队、浏览器自动检测、原始 PDF 下载、保留 ACADEMI.CX 来源和“非官方重排测试版”的 PDF 重排、额度扣减与失败退还。

## 本机 / 宝塔 Node 项目

需要 Node.js 24。

1. `npm ci`，`npm run build`。
2. 复制 `.env.example` 为 `.env`，设置两个不同的随机管理员/执行器密钥。
3. 设置 `APP_ORIGIN` 为实际网站地址，例如 `https://check.your-domain.com`；本地测试用 `http://127.0.0.1:3200` 并设置 `PORT=3200`。
4. `npm start`。数据库表首次启动自动迁移，数据保存在 `data/`。
5. 宝塔/Nginx 反向代理到 `127.0.0.1:3100`，配置 HTTPS，设置上传上限 51 MB。服务端口不要直接暴露公网。
6. 若设置 `TRUST_PROXY=1`，反向代理必须覆盖 `X-Real-IP`，并限制用户绕过反向代理直连后端。

`/admin` 输入管理员密钥生成 CDK；普通用户自行注册后兑换。管理员密钥与账号密码相互独立。

浏览器执行器需要 Python、Playwright、Chromium 及中文 TrueType 字体。按 `worker/.env.example` 配置，再 `npm run worker`。已有平台检测账号的密码只保存在服务器环境中，不传给前端。

## Docker 部署（包含检测执行器）

1. 安装 Docker Compose，复制并填写 `.env`。`APP_ORIGIN=https://你的域名`，`DOMAIN=你的域名`。填入上游账号与两个不同的长随机密钥。
2. 域名 A/AAAA 解析到服务器，放行 80/443。
3. 无其他面板占用端口时：`docker compose --profile https up -d --build`。Caddy 管理 HTTPS。
4. 已有宝塔/Nginx 管理 HTTPS 时：`docker compose up -d --build`，使用面板反向代理 `127.0.0.1:3100`。
5. `docker compose logs -f worker` 查看检测任务。不要运行多个使用同一任务目录的执行器。

备份 `paperdesk-data` 卷（数据库、原文、报告）；备份前先停止 web 和 worker 以获得一致快照。`docker compose down` 保留数据，不要使用 `down -v`，除非确定要删除全部数据。

Docker 配置已编写；是否能在目标服务器运行，需要在该服务器构建验证。浏览器依赖下载需要网络。

## 支付

支付后自动增加额度已预留：验签回调校验订单、金额和币种，并通过唯一订单流水防止重复加额度。PAYMENT_ENABLED 默认 false，真实收款与支付回调均关闭。仅在确定商户并完成适配后才设为 true。

`CHECKOUT_URL` 是支付适配服务，不是微信/支付宝原生 API。服务收到 `{orderId,amount,currency,description,callbackUrl,returnUrl}` 后返回 `{url:"https://支付地址"}`。金额为人民币分；请求 `X-Signature` 是原始 JSON 的 HMAC-SHA256 十六进制签名，密钥为 `PAYMENT_SECRET`。

适配服务需先核实真实支付结果，再把 `{orderId,status:"paid",amount,currency:"CNY",timestamp:毫秒时间戳}` 带同样签名回调 `/api/payment/callback`。网站核对金额、币种、时间戳和订单，幂等增加账户检测额度。`PRODUCT_PRICES` 用于实际定价，例如键 single、five、twenty，未定价时设 0。

## 当前边界

- 尚无域名/服务器信息，因此不代表已经部署到公网。
- 邮件验证、密码找回、文稿保留期限和删除策略尚未实现，正式运营前需确定。
- AI 检测由 ACADEMI.CX 自有模型提供。相似度来源以该站原始下载件为准，未经独立认证。
- 从先前版本迁移的是代码；本版本首次使用新数据库，不自动复制旧测试账号。

## 指定样式报告

worker/restyle.py 已将早期 v3 排版改为动态模板：612×792 点页面、Lexend/Noto 字体、细分隔线、浅蓝提示区、页眉/页脚。分数、文件名、原始报告时间和字数从本次真实数据读取。每页都有 ACADEMI.CX 来源及“非官方重排测试版”。原始报告全部页保留在框架内，不遮挡正文或高亮。输出 ai-restyled.pdf、similarity-restyled.pdf 和合并 restyled.pdf。旧任务仍可下载原先的重排文件。

tests/payment-contract.mjs 使用隔离临时数据库测试支付验签与幂等到账，不调用真实支付服务。

## 2026-09-14 实测

通过前端注册、CDK 兑换并上传公开历史文本测试文稿，浏览器执行器使用已授权的真实 ACADEMI.CX 账号完成检测：AI 0%，相似度 92%。五份 PDF 均通过登录后的下载接口取回；两份重排报告逐页核验原始文字完整，来源标识与高亮已检查。文件名搜索、状态筛选、手机布局及未登录下载拦截通过。支付回调的错误签名、错误金额、并发重复及重放测试通过，真实支付仍关闭。

## JianPay 接入

设置 PAYMENT_PROVIDER=jianpay、JIANPAY_CLIENT_NO、JIANPAY_KEY 和 PRODUCT_PRICES（人民币分），商户通道确认开通后设置 PAYMENT_ENABLED=true。密钥只保存在服务端 .env，不填写到前端。JIANPAY_GATEWAY 支持官方主网关及文档备用网关。

前端可选微信/支付宝，创建订单后打开简付收银台。HTTPS 站点自动提交 /api/payment/jianpay 作为通知地址；本机 HTTP 测试不提交公网无法访问的通知地址，通过订单主动查询确认。用户停留网站时每 10 秒查询最近三个待付订单，也可逐笔点击“刷新到账”。页面关闭且未配置回调时，下次打开网站继续查询。支付成功必须经签名通知或服务端查单确认，校验商户、订单及分金额后通过唯一流水增加额度。

2026-09-14：简付签名、错误金额/商户/平台订单、非成功状态、未登录查单、并发与重复回调测试通过。更正账号后登录成功，经用户确认重置密钥并仅写入本地服务端环境。微信 0.01 元真实测试订单创建成功，平台订单号查单成功（待支付）；尚未验证真实到账。正式套餐价格未设置，不开放新套餐购买。

实测兼容：网关地址自动去除尾部斜杠；查单优先使用返回的 orderId。平台当前按 merchantOrderNo 查单曾返回签名失败。无公网回调时，用户须保持页面打开或返回订单页，触发主动查单；本地测试不代表公网部署完成。

## 当前检测通道：PaperDesk + ACADEMI.CX

设置 `SIMILARITY_PROVIDER=paperdesk` 后，相似度使用相邻 `../paperdesk-search-checker` 的自主检索引擎；自定义安装位置可设置 `PAPERDESK_CHECKER_DIR`。该目录需随项目一起部署并安装其依赖；现有 ACADEMI 账号配置继续用于 AI 查询。旧 Turnitin 报告及历史记录保留，新任务不会提交 Turnitin。

客户上传仍扣 1 次额度。中文或英语词数不在 350–29,500 范围内时跳过 AI、仅生成相似度报告。未取得任何可比对来源会失败并退款，不能当成 0%。部分来源受限时保存真实相似度和覆盖限制提示。若相似度成功而 AI 最终失败，退还额度并保留可下载的相似度报告。

新报告来源分别为 PaperDesk 与 ACADEMI.CX；相似度 PDF 最多 20 页，仅展示重复文字。收件箱“查看重复片段”显示完整匹配和来源链接；全文证据 JSON 持久保存在客户自己的检测记录中，按登录账号验证下载权限，不受临时浏览器会话过期影响。

本地与公网使用：`APP_ORIGIN=http://127.0.0.1:3200`、`TRUST_PROXY=1`，服务仅绑定回环地址，公网请求由本机 Cloudflare 隧道转发；更换临时公网域名无需改数据库或客户账号。

验证：`node --test tests/paperdesk-provider.mjs tests/academi-accounts.mjs`；真实上游报告的隔离数据库回传测试 `node tests/paperdesk-delivery.mjs work/paperdesk-integration-real`。后者检查归属隔离、证据/文件齐全、扣款及退款幂等、AI 跳过及相似度成功结果保留。
