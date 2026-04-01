# 公共账户课堂实验网页

这是一个适合 6 名学生、5 轮公共账户课堂实验的极简网页应用。

## 功能

- 教师端控制开始轮次、关闭轮次、重置整场实验
- 学生端选座位后匿名提交 0 到 10 的整数投入
- 每轮只公布全班总投入和每人公共回报
- 每个学生自动计算本轮得分和累计得分
- 教师端保留 5 轮汇总，方便课后复盘

## 本地运行

```powershell
node .\server.js
```

- 教师端：`http://localhost:3000/?role=teacher`
- 学生端：`http://localhost:3000/?role=student`

## Render 部署

项目已经补好了 Render 需要的文件：

- `package.json`
- `package-lock.json`
- `render.yaml`
- `.node-version`

最短步骤：

1. 把这个文件夹上传到一个 GitHub 仓库。
2. 登录 Render，选择 `New +` -> `Web Service`。
3. 连接刚才的 GitHub 仓库。
4. Render 会自动识别：
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: `Free`
5. 点击部署，得到一个在线网址。

## 说明

- 这是课堂实时应用，运行状态保存在服务器内存里。
- 如果 Render 免费服务休眠或重启，当前课堂局的数据会清空。
- 所以上课前先打开一次教师端，让服务提前唤醒。
