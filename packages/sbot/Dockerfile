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

# 再拷贝源码（避免源码变更导致基础安装层缓存失效）
COPY . .

RUN npm install --omit=dev

CMD [ "node", "dist/index.js" ]
