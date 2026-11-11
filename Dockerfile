FROM node:22-alpine
WORKDIR /app
COPY . .
RUN node build.js
ENV PORT=8787 DATA_FILE=/data/leagues.json
VOLUME /data
EXPOSE 8787
CMD ["node", "server.js"]
