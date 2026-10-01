# PaperDesk / Academi

React + Node.js 24 + SQLite 的独立文稿检测网站。此仓库包含当前网站的完整应用源码与检测执行器；实际账号、支付密钥、客户文稿、报告、数据库和浏览器会话不随源码发布。

## 功能

- 客户注册登录、管理员角色分流、密码重置与客服聊天。
- CDK 生成和兑换、微信/支付宝购买额度、订单查询与验签到账。
- 系统公告、客户活动、检测记录、原文/报告下载、每日检测统计。
- 浏览器自动提交与官网回执恢复、原文一致性校验、检测额度扣减及失败退款。
- 中文或不在 350–29,500 词范围内的文稿仅进行相似度检测。
- AI 检测由 ACADEMI.CX 提供；配置 UTAD 时相似度来自 Turnitin 官方下载件，官方相似度 PDF 保留原版。

## 本地运行

需要 Node.js 24、Python 3.12、Chromium/Playwright；报告排版可能需要 LibreOffice 和中文字体。

```sh
npm ci
cp .env.example .env
# 填写 .env：两个不同的长随机密钥、站点地址及授权检测账号
npm run build
npm start
```

服务首次启动自动运行 `migrations/`，创建 `data/paperdesk.sqlite`。客户数据与文件存放在 `data/`；浏览器处理回执和诊断存放在 `worker-data/`。

安装执行器依赖并启动：

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r worker/requirements.txt
npm install --no-save playwright
npx playwright install chromium
npm run worker
```

填写 ACADEMI 和 UTAD 的授权账号。可填写 `ACADEMI_EMAIL_2` / `ACADEMI_PASSWORD_2` 增加第二个 AI 账号：新 AI 任务按两个账号轮流分配，同一任务重试保留原账号，分配状态保存在 `worker-data/`，不存储密码。核对机构当前的文稿入库设置后，才设置 `UTAD_DEFAULT_POLICY_ACCEPTED=true`。此配置是对当前机构设置的确认，不会自动修改官网入库策略。每个任务使用稳定标题及回执恢复，避免不确定状态下重复上传。

生产部署使用 HTTPS 反向代理。`APP_ORIGIN` 填写实际地址；开启 `TRUST_PROXY=1` 时，代理必须覆盖 `X-Real-IP`，并禁止绕过代理直连后端。

## 支付配置

默认关闭真实支付。设置 `JIANPAY_CLIENT_NO`、`JIANPAY_KEY`，并将 `PRODUCT_PRICES` 设为各套餐的人民币分价格（`single`、`five`、`twenty`），确认商户通道后再开启 `PAYMENT_ENABLED=true`。

服务端验证支付通知/主动查单结果、订单、商户和金额后幂等增加额度。密钥不能写入前端。HTTPS 公网站点通知地址为 `/api/payment/jianpay`。

## 管理员

新数据库默认没有管理员账号。先注册你的账号，再在受控服务器上将该账号对应的 `users.role` 设置为 `admin`，随后从登录页登录。管理员密钥可用于受保护的后台 API；创建客户账号接口不会创建管理员。管理员的 CDK、公告、订单、活动、文稿下载和客服功能位于 `/admin`，仓库不提供固定管理员密码。

## Docker

```sh
docker compose up -d --build
# 自有域名和 Caddy HTTPS：
docker compose --profile https up -d --build
```

Docker 默认监听 3100；填写 `.env` 中 `APP_ORIGIN`、`DOMAIN` 和检测账号。执行器默认使用无界面 Chromium；需要有界面运行时，使用本机图形环境，并设置 `UTAD_HEADLESS=false`。备份 `data/` 与 `worker-data/`，勿删除持久卷。

## 验证

`tests/` 包含支付、额度、下载权限、任务恢复、客服、公告统计和文件限制测试。需要网站的集成测试应运行在隔离测试数据库及测试环境，避免对真实客户数据操作。源码发布不包含客户样本报告。

## 目录

- `app/`、`components/`：页面及交互。
- `server/`、`lib/`：API、鉴权、支付、SQLite 与文件存储。
- `migrations/`：数据库迁移。
- `worker/`：浏览器检测、回执验证与报告处理。
- `public/`：页面图片、字体及静态资源。
- `tests/`：验证脚本。

第三方服务临时不可用时可能失败；系统保留诊断并退款，不将未通过原文校验的报告标记为完成。
