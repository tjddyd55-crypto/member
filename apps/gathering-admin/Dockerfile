# 빌드 컨텍스트는 저장소 루트다.
# docker build -f apps/gathering-admin/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.base.json ./
RUN npm ci --ignore-scripts
RUN npm run build -w @member/gathering-admin

FROM nginx:1.27-alpine
COPY apps/gathering-admin/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/gathering-admin/dist /usr/share/nginx/html
ENV API_UPSTREAM=http://127.0.0.1:3001
EXPOSE 80
