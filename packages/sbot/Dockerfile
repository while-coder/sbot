FROM node:24-alpine

EXPOSE 5500
VOLUME [ "/root/.sbot" ]

ENV TZ=Asia/Shanghai
ENV EXEC_DOCKER=true

WORKDIR /app

COPY . .

WORKDIR /app/dist

RUN npm install --omit=dev

CMD [ "node", "dist/index.js" ]
