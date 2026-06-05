# 上线说明

这是一个纯静态网页，不需要先买服务器。

## 你到底需要买什么

你有两种选择：

1. 不买任何东西
直接用平台给你的免费地址上线，比如：
`https://你的项目名.vercel.app`
或
`https://你的项目名.netlify.app`

2. 只买域名，不买服务器
如果你想用自己的网址，比如：
`https://heat.yourname.com`
那你只需要买域名，不需要买服务器。

结论：
- 不需要买服务器
- 域名不是必须
- 最省事方案：`GitHub + Vercel`

## 我已经帮你做好的部分

当前目录已经可以直接当静态网站部署：

- `index.html`
- `styles.css`
- `script.js`
- `config.js`
- `vercel.json`
- `netlify.toml`

也就是说，部署平台不需要构建命令，直接发布这个目录即可。

## 你现在只需要做的事

### 方案 A：最推荐，最简单

1. 注册 GitHub 账号
2. 新建一个仓库
3. 把这个目录里的文件上传到仓库
4. 注册 Vercel
5. 用 Vercel 连接你的 GitHub 仓库
6. 点击 Deploy

完成后你会立刻拿到一个公开网址。

### 方案 B：不用 GitHub 也行

1. 注册 Netlify
2. 找到 “Add new site” 或 “Deploy manually”
3. 直接把整个目录拖上去

也能马上得到一个公开网址。

## 如果你想用自己的域名

需要额外做这两步：

1. 去买域名
常见平台：
- 阿里云万网
- 腾讯云
- Cloudflare Registrar
- Namecheap

2. 在部署平台里绑定域名
平台会告诉你怎么改 DNS。

你不需要自己买服务器，不需要自己配 nginx，不需要自己买云主机。

## 你上线后会发生什么

这个网页会在公网上可访问，但有几个现实问题你需要知道：

1. 当前页面直接请求币安公开接口
如果访问者所在网络访问不了 `fapi.binance.com`，页面数据会失败。

2. TradingView 链接上线后通常能正常跳转
但如果用户还是在某些 App 的内嵌浏览器里打开，仍可能有限制。

3. 底部的“热点事件 / 上新通知”现在还是占位
后续接接口时，建议加一个你自己的后端服务。

## 我建议你的最终路线

### 第一步
先把当前静态页上线

### 第二步
确认公网能正常打开页面

### 第三步
如果你要长期用，再做后端接口层：
- 代理币安数据
- 接热点事件
- 接上新通知

## 视频长期留存

视频列表现在不再只保存在浏览器里，而是通过 `/api/videos` 持久化。

本地开发时，视频会写入：

- `videos.json`

部署到 Vercel 后，推荐把视频列表写回 GitHub 仓库文件。需要在 Vercel 项目的 Environment Variables 里设置：

- `GITHUB_TOKEN`：GitHub fine-grained token，需要有当前仓库 Contents 读写权限
- `GITHUB_REPO`：仓库名，格式如 `你的用户名/你的仓库名`
- `GITHUB_BRANCH`：分支名，通常是 `main`
- `VIDEOS_FILE_PATH`：视频列表文件路径，默认 `videos.json`

`GITHUB_TOKEN` 建议使用 GitHub Fine-grained personal access token：

- Repository access：只选择这个项目仓库
- Permissions：`Contents` 选择 `Read and write`
- 生成后复制 token，填到 Vercel 的 `GITHUB_TOKEN`

使用方式：

- 用户打开 `video.html`，只能看公开视频列表和播放窗口
- 你打开 `video-admin.html`，直接添加 YouTube 链接
- 添加后会写入 `videos.json`，所有用户刷新 `video.html` 都能看到

## 如果你完全照着做

你现在最该做的是：

1. 注册 GitHub
2. 把这个目录上传到 GitHub 仓库
3. 注册 Vercel
4. 导入这个仓库
5. 点击 Deploy

如果你想用自己的网址，再第 6 步去买域名。

## 你现在不需要做的事

- 不需要买服务器
- 不需要买数据库
- 不需要配 Linux
- 不需要配 nginx
- 不需要买 CDN

## 我还不能替你做的事

这些必须你自己点：

- 注册 GitHub / Vercel / Netlify
- 登录平台账号
- 买域名
- 改域名 DNS
- 点击平台上的 Deploy

## 我还能继续帮你做的事

我可以继续帮你：

1. 生成一个最适合上传 GitHub 的目录版本
2. 帮你加一个更适合上线的 `README`
3. 帮你把“热点事件 / 上新通知”后端接口骨架先搭出来
4. 等你把仓库地址给我后，我帮你检查是否还缺文件
