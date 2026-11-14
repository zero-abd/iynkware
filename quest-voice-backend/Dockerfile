FROM node:24.22.1-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
USER node
EXPOSE 8787
STOPSIGNAL SIGTERM
CMD ["node", "--enable-source-maps", "src/server.ts"]
