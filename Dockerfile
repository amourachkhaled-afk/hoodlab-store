FROM node:24-alpine
WORKDIR /app
ENV PORT=4242 DATA_DIR=/data/shop.db NODE_ENV=production
COPY package.json server.js index.html ./
RUN mkdir -p /data
EXPOSE 4242
CMD ["node", "server.js"]
