FROM node:24

EXPOSE 5500
VOLUME [ "/root/.sbot" ]

ENV TZ=Asia/Shanghai
ENV LOG_LEVEL=INFO

WORKDIR /app

# 单独拷贝 package.json 安装外部依赖（此层与源码解耦，代码变更不影响缓存）
COPY package.json ./
RUN npm install --omit=dev && npm rebuild sqlite3 --build-from-source

# 再拷贝全部文件（包含 bundle 的 workspace 包，Docker COPY 会合并进 node_modules）
COPY . .

CMD [ "node", "dist/index.js" ]
