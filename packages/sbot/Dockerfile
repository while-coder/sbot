FROM node:24-alpine

EXPOSE 5500
VOLUME [ "/root/.sbot" ]

ENV TZ=Asia/Shanghai
ENV EXEC_DOCKER=true

WORKDIR /app

# 先拷贝安装脚本（让基础依赖层尽量可缓存）
COPY install_base.sh ./
RUN sed -i 's/\r$//' install_base.sh && chmod +x install_base.sh
RUN ./install_base.sh

# 单独拷贝 package.json 安装外部依赖（此层与源码解耦，代码变更不影响缓存）
COPY package.json ./
RUN npm install --omit=dev

# 再拷贝全部文件（包含 bundle 的 workspace 包，Docker COPY 会合并进 node_modules）
COPY . .

CMD [ "node", "dist/index.js" ]
